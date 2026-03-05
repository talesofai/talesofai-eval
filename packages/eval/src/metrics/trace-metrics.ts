import type {
  ArtifactRef,
  EvalResult,
  EvalTrace,
  ToolCallRecord,
  TraceMetrics,
  TraceMetricsSummary,
} from "../types.ts";
import { isRecord } from "../utils/type-guards.ts";

type ComputeTraceMetricsOptions = {
  debug?: boolean;
};

type NormalizedToolOutput = {
  structuredContent: Record<string, unknown> | null;
  explicitError: boolean;
  taskStatus: string | null;
  artifacts: Array<{
    uuid: string;
    url: string;
    modality: string;
    status?: string;
  }>;
};

const URL_REGEX = /https?:\/\/\S+/gi;
const URL_TRAILING_CHARS_REGEX = /[.,;:!?)}\]"'”’]+$/u;

const UUID_ALNUM_BOUNDARY = "[^A-Za-z0-9]";

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseJsonString(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasStructuredPayloadFields(value: Record<string, unknown>): boolean {
  return (
    "task_status" in value ||
    "artifacts" in value ||
    "err_msg" in value
  );
}

function hasStructuredFields(value: Record<string, unknown>): boolean {
  return hasStructuredPayloadFields(value) || "isError" in value;
}

function extractStructuredContent(
  value: unknown,
): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractStructuredContent(item);
      if (nested) {
        return nested;
      }
    }
    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const direct = value["structuredContent"];
  if (isRecord(direct)) {
    return direct;
  }

  if (hasStructuredPayloadFields(value)) {
    return value;
  }

  const content = value["content"];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!isRecord(item)) {
        continue;
      }

      if (isRecord(item["structuredContent"])) {
        return item["structuredContent"];
      }

      const text = item["text"];
      if (typeof text === "string") {
        const parsed = parseJsonString(text);
        const nested = extractStructuredContent(parsed);
        if (nested) {
          return nested;
        }
      }
    }
  }

  const text = value["text"];
  if (typeof text === "string") {
    const parsed = parseJsonString(text);
    const nested = extractStructuredContent(parsed);
    if (nested) {
      return nested;
    }
  }

  if (hasStructuredFields(value)) {
    return value;
  }

  return null;
}

function normalizeTaskStatus(value: unknown): string | null {
  const status = normalizeString(value);
  return status ? status.toUpperCase() : null;
}

function normalizeArtifacts(artifactsValue: unknown): Array<{
  uuid: string;
  url: string;
  modality: string;
  status?: string;
}> {
  if (!Array.isArray(artifactsValue)) {
    return [];
  }

  const artifacts: Array<{
    uuid: string;
    url: string;
    modality: string;
    status?: string;
  }> = [];

  for (const item of artifactsValue) {
    if (!isRecord(item)) {
      continue;
    }

    const uuid = normalizeString(item["uuid"]) ?? "";
    const url = normalizeString(item["url"]) ?? "";
    if (uuid.length === 0 && url.length === 0) {
      continue;
    }

    const modality =
      normalizeString(item["modality"])?.toUpperCase() ?? "UNKNOWN";
    const status = normalizeString(item["status"])?.toUpperCase();

    artifacts.push({
      uuid,
      url,
      modality,
      ...(status ? { status } : {}),
    });
  }

  return artifacts;
}

export function parseToolOutput(output: unknown): NormalizedToolOutput {
  const root = typeof output === "string" ? parseJsonString(output) : output;
  const rootRecord = isRecord(root) ? root : null;
  const structured = extractStructuredContent(root);

  const structuredIsError = structured?.["isError"] === true;
  const rootIsError = rootRecord?.["isError"] === true;
  const errMsg = normalizeString(structured?.["err_msg"]);

  const taskStatus = normalizeTaskStatus(structured?.["task_status"]);
  const artifacts = normalizeArtifacts(structured?.["artifacts"]);

  const explicitError = structuredIsError || rootIsError || Boolean(errMsg);

  return {
    structuredContent: structured,
    explicitError,
    taskStatus,
    artifacts,
  };
}

function incrementCounter(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

export function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",");
  return `{${body}}`;
}

function collectStringValues(value: unknown, bucket: string[]): void {
  if (typeof value === "string") {
    bucket.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, bucket);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const nested of Object.values(value)) {
    collectStringValues(nested, bucket);
  }
}

function collectArgumentStrings(
  argumentsValue: Record<string, unknown>,
): string[] {
  const allValues: string[] = [];
  collectStringValues(argumentsValue, allValues);

  const prioritized: string[] = [];
  const imageUrl = argumentsValue["image_url"];
  if (typeof imageUrl === "string") {
    prioritized.push(imageUrl);
  }

  for (const value of allValues) {
    if (!prioritized.includes(value)) {
      prioritized.push(value);
    }
  }

  return prioritized;
}

function matchUrlRef(text: string, artifactUrl: string): boolean {
  if (artifactUrl.length === 0) {
    return false;
  }

  return text === artifactUrl || text.includes(artifactUrl);
}

function containsUuidBoundaryFriendly(text: string, uuid: string): boolean {
  if (uuid.length === 0 || !text.includes(uuid)) {
    return false;
  }

  const escaped = uuid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(
    `(^|${UUID_ALNUM_BOUNDARY})${escaped}($|${UUID_ALNUM_BOUNDARY})`,
  );
  return matcher.test(text);
}

function matchesArtifactRef(text: string, artifact: ArtifactRef): boolean {
  if (matchUrlRef(text, artifact.url)) {
    return true;
  }

  return containsUuidBoundaryFriendly(text, artifact.uuid);
}

function normalizeUrlCandidate(url: string): string {
  const withoutTrail = url.replace(URL_TRAILING_CHARS_REGEX, "");
  return withoutTrail.trim();
}

function extractUrlsFromText(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) {
    return [];
  }

  const normalized: string[] = [];
  for (const candidate of matches) {
    const url = normalizeUrlCandidate(candidate);
    if (url.length === 0) {
      continue;
    }

    if (!normalized.includes(url)) {
      normalized.push(url);
    }
  }

  return normalized;
}

function roundMetric(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }

  return roundMetric(numerator / denominator);
}

function toStableMetrics(metrics: TraceMetrics): TraceMetrics {
  if (!metrics.debug) {
    return metrics;
  }

  const { debug: _debug, ...stable } = metrics;
  return stable;
}

function toolNameOf(call: ToolCallRecord): string {
  return call.name;
}

export function computeTraceMetrics(
  trace: EvalTrace,
  options?: ComputeTraceMetricsOptions,
): TraceMetrics {
  const debug = options?.debug ?? false;

  const toolCallsByName: Record<string, number> = {};
  const toolErrorCallsByName: Record<string, number> = {};
  const artifactsByModality: Record<string, number> = {};
  const artifactsSuccessByModality: Record<string, number> = {};
  const bindingsByToTool: Record<string, number> = {};

  let toolErrorCallsTotal = 0;
  let toolRetryCallsTotal = 0;
  let artifactsTotal = 0;
  let artifactsSuccessTotal = 0;
  let bindingsTotal = 0;
  let makeVideoCallsTotal = 0;
  let makeVideoBoundCallsTotal = 0;

  const parsedOutputs = trace.tools_called.map((call) =>
    parseToolOutput(call.output),
  );

  for (let index = 0; index < trace.tools_called.length; index++) {
    const call = trace.tools_called[index];
    if (!call) {
      continue;
    }

    incrementCounter(toolCallsByName, toolNameOf(call));

    const parsed = parsedOutputs[index];
    if (parsed?.explicitError) {
      toolErrorCallsTotal += 1;
      incrementCounter(toolErrorCallsByName, toolNameOf(call));
    }

    if (call.name === "make_video_v1") {
      makeVideoCallsTotal += 1;
    }

    if (index > 0) {
      const previousCall = trace.tools_called[index - 1];
      const previousParsed = parsedOutputs[index - 1];

      if (
        previousCall &&
        previousParsed?.explicitError === true &&
        previousCall.name === call.name &&
        stableStringify(previousCall.arguments) ===
          stableStringify(call.arguments)
      ) {
        toolRetryCallsTotal += 1;
      }
    }
  }

  const allArtifacts: ArtifactRef[] = [];
  const successfulArtifacts: ArtifactRef[] = [];

  for (let index = 0; index < trace.tools_called.length; index++) {
    const call = trace.tools_called[index];
    const parsed = parsedOutputs[index];
    if (!call || !parsed) {
      continue;
    }

    for (const artifact of parsed.artifacts) {
      artifactsTotal += 1;
      incrementCounter(artifactsByModality, artifact.modality);

      const artifactRef: ArtifactRef = {
        uuid: artifact.uuid,
        url: artifact.url,
        modality: artifact.modality,
        ...(artifact.status ? { status: artifact.status } : {}),
        tool_name: call.name,
        tool_index: index,
      };

      allArtifacts.push(artifactRef);

      const isSuccess =
        artifact.status === "SUCCESS" || parsed.taskStatus === "SUCCESS";

      if (isSuccess) {
        artifactsSuccessTotal += 1;
        incrementCounter(artifactsSuccessByModality, artifact.modality);
        successfulArtifacts.push(artifactRef);
      }
    }
  }

  for (let index = 0; index < trace.tools_called.length; index++) {
    const call = trace.tools_called[index];
    if (!call) {
      continue;
    }

    const argsStrings = collectArgumentStrings(call.arguments);
    if (argsStrings.length === 0) {
      continue;
    }

    let callBound = false;
    let makeVideoBound = false;

    for (const artifact of successfulArtifacts) {
      if (artifact.tool_index >= index) {
        continue;
      }

      const matched = argsStrings.some((argValue) =>
        matchesArtifactRef(argValue, artifact),
      );
      if (!matched) {
        continue;
      }

      callBound = true;
      if (call.name === "make_video_v1" && artifact.modality === "PICTURE") {
        makeVideoBound = true;
      }

      if (callBound && (call.name !== "make_video_v1" || makeVideoBound)) {
        break;
      }
    }

    if (callBound) {
      bindingsTotal += 1;
      incrementCounter(bindingsByToTool, call.name);
    }

    if (makeVideoBound) {
      makeVideoBoundCallsTotal += 1;
    }
  }

  const finalResponse = trace.final_response ?? "";
  const deliveryUrls = extractUrlsFromText(finalResponse);
  const artifactUrls = successfulArtifacts
    .map((artifact) => artifact.url)
    .filter((url) => url.length > 0);

  const normalizedArtifactUrls = new Set(
    artifactUrls.map((url) => normalizeUrlCandidate(url)),
  );

  let deliveryContainsArtifactUrl = deliveryUrls.some((url) =>
    normalizedArtifactUrls.has(normalizeUrlCandidate(url)),
  );

  if (!deliveryContainsArtifactUrl && finalResponse.length > 0) {
    deliveryContainsArtifactUrl = artifactUrls.some((artifactUrl) =>
      finalResponse.includes(artifactUrl),
    );
  }

  const hasPicture = (artifactsSuccessByModality["PICTURE"] ?? 0) > 0;
  const hasVideo = (artifactsSuccessByModality["VIDEO"] ?? 0) > 0;
  const hasPictureToVideoBinding = makeVideoBoundCallsTotal > 0;
  const deliveredAnyArtifact = deliveryContainsArtifactUrl;

  const progressImageOnly = hasPicture ? (deliveredAnyArtifact ? 1 : 0.5) : 0;

  const shouldReportImageToVideoProgress =
    makeVideoCallsTotal > 0 || hasVideo || hasPictureToVideoBinding;
  const progressImageToVideo = shouldReportImageToVideoProgress
    ? roundMetric(
        [
          hasPicture,
          hasVideo,
          hasPictureToVideoBinding,
          deliveredAnyArtifact,
        ].filter(Boolean).length / 4,
      )
    : null;

  const metrics: TraceMetrics = {
    tool_calls_total: trace.tools_called.length,
    tool_calls_by_name: toolCallsByName,

    tool_error_calls_total: toolErrorCallsTotal,
    tool_error_calls_by_name: toolErrorCallsByName,

    tool_retry_calls_total: toolRetryCallsTotal,

    tool_duration_ms_total: trace.tools_called.reduce(
      (total, call) => total + call.duration_ms,
      0,
    ),

    artifacts_total: artifactsTotal,
    artifacts_by_modality: artifactsByModality,
    artifacts_success_total: artifactsSuccessTotal,
    artifacts_success_by_modality: artifactsSuccessByModality,

    bindings_total: bindingsTotal,
    bindings_by_to_tool: bindingsByToTool,

    make_video_calls_total: makeVideoCallsTotal,
    make_video_bound_calls_total: makeVideoBoundCallsTotal,

    delivery_contains_artifact_url: deliveryContainsArtifactUrl,

    milestones: {
      has_picture: hasPicture,
      has_video: hasVideo,
      has_picture_to_video_binding: hasPictureToVideoBinding,
      delivered_any_artifact: deliveredAnyArtifact,
      progress_image_only: progressImageOnly,
      progress_image_to_video: progressImageToVideo,
    },
  };

  if (debug) {
    metrics.debug = {
      artifacts: allArtifacts,
      delivered_urls: deliveryUrls,
    };
  }

  return metrics;
}

export function stripTraceMetricsDebug(metrics: TraceMetrics): TraceMetrics {
  return toStableMetrics(metrics);
}

export function summarizeTraceMetrics(
  results: EvalResult[],
): TraceMetricsSummary {
  const metricsList = results
    .map((result) => result.metrics ?? computeTraceMetrics(result.trace))
    .map((metrics) => toStableMetrics(metrics));

  const total = metricsList.length;
  const artifactsByModality: Record<string, number> = {};

  let sumToolCalls = 0;
  let sumToolErrors = 0;
  let sumToolRetries = 0;
  let sumMakeVideoCalls = 0;
  let sumMakeVideoBoundCalls = 0;

  let milestoneHasPicture = 0;
  let milestoneHasVideo = 0;
  let milestoneDelivered = 0;

  let bindingNumerator = 0;
  let bindingDenominator = 0;

  for (const metrics of metricsList) {
    sumToolCalls += metrics.tool_calls_total;
    sumToolErrors += metrics.tool_error_calls_total;
    sumToolRetries += metrics.tool_retry_calls_total;

    sumMakeVideoCalls += metrics.make_video_calls_total;
    sumMakeVideoBoundCalls += metrics.make_video_bound_calls_total;

    if (metrics.milestones.has_picture) {
      milestoneHasPicture += 1;
    }

    if (metrics.milestones.has_video) {
      milestoneHasVideo += 1;
    }

    if (metrics.milestones.delivered_any_artifact) {
      milestoneDelivered += 1;
    }

    if (metrics.make_video_calls_total > 0) {
      bindingDenominator += 1;
      if (metrics.milestones.has_picture_to_video_binding) {
        bindingNumerator += 1;
      }
    }

    for (const [modality, count] of Object.entries(
      metrics.artifacts_by_modality,
    )) {
      artifactsByModality[modality] =
        (artifactsByModality[modality] ?? 0) + count;
    }
  }

  return {
    avg_tool_calls_total: total > 0 ? roundMetric(sumToolCalls / total) : 0,
    avg_tool_error_calls_total:
      total > 0 ? roundMetric(sumToolErrors / total) : 0,
    avg_tool_retry_calls_total:
      total > 0 ? roundMetric(sumToolRetries / total) : 0,
    make_video_binding_rate: rate(sumMakeVideoBoundCalls, sumMakeVideoCalls),
    artifacts_by_modality: artifactsByModality,
    picture_rate: total > 0 ? roundMetric(milestoneHasPicture / total) : 0,
    video_rate: total > 0 ? roundMetric(milestoneHasVideo / total) : 0,
    binding_rate: rate(bindingNumerator, bindingDenominator),
    delivery_rate: total > 0 ? roundMetric(milestoneDelivered / total) : 0,
  };
}
