import { parseToolOutput } from "../metrics/trace-metrics.ts";
import type { EvalResult, EvalTrace, Span, TimingSummary, ToolCallRecord } from "../types.ts";
import { isRecord } from "../utils/type-guards.ts";
import {
  resolveMetrics,
  runDetailText,
  runJudgeText,
  runStatusText,
  truncateText,
} from "./render.ts";

export type CaseRowView = {
  case_id: string;
  status_text: string;
  status_class: "pass" | "fail" | "err";
  judge_text: string;
  judge_class: "" | "pass" | "fail";
  detail_text: string;
  duration_ms: number;
  duration_text: string;
  tokens_total: number;
  tokens_text: string;
};

export type ToolCallMediaView = {
  type: "image" | "video";
  url: string;
  uuid: string;
  modality: string;
  status?: string;
};

export type ToolCallView = {
  tool_call_id: string;
  name: string;
  duration_ms: number;
  arguments: Record<string, unknown>;
  arguments_preview: string;
  arguments_pretty: string;
  output_pretty: string;
  media: ToolCallMediaView[];
};

export type AssistantToolCallPreview = {
  name: string;
  arguments_preview: string;
};

export type ConversationItemView =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      tool_calls?: AssistantToolCallPreview[];
    }
  | {
      role: "tool";
      tool_call_id: string;
      tool?: {
        name: string;
        arguments_preview: string;
        media: ToolCallMediaView[];
      };
    };

export type CaseMetricsView = {
  tool_calls_total: number;
  tool_error_calls_total: number;
  tool_retry_calls_total: number;
  picture_count: number;
  video_count: number;
  artifact_count: number;
};

const ARG_PREVIEW_LIMIT = 3;
const ARG_PREVIEW_STR_MAX = 20;
const VIDEO_EXT_REGEX = /\.(mp4|mov|webm)($|\?)/i;

const safeParseJson = (raw: string): unknown | null => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const formatJsonBlock = (value: unknown): string => {
  if (value === undefined) {
    return "";
  }
  const json = JSON.stringify(value, null, 2);
  return json ?? "";
};

const formatArgsPreview = (args: Record<string, unknown>): string => {
  const entries = Object.entries(args).slice(0, ARG_PREVIEW_LIMIT);
  const preview = entries
    .map(([key, value]) => {
      let display: string;
      if (typeof value === "string") {
        display =
          value.length > ARG_PREVIEW_STR_MAX
            ? truncateText(value, ARG_PREVIEW_STR_MAX)
            : value;
      } else if (value === null || value === undefined) {
        display = "-";
      } else if (typeof value === "object") {
        display = "{...}";
      } else {
        display = String(value);
      }
      return `${key}=${display}`;
    })
    .join(", ");
  const more = Object.keys(args).length > ARG_PREVIEW_LIMIT ? ", ..." : "";
  return preview + more;
};

const formatToolOutput = (output: unknown): string => {
  if (typeof output === "string") {
    const parsed = safeParseJson(output);
    if (parsed !== null) {
      return formatJsonBlock(parsed);
    }
    return output;
  }
  return formatJsonBlock(output);
};

const resolveMediaType = (
  modality: string | null,
  url: string,
): "image" | "video" => {
  if (modality?.toUpperCase() === "VIDEO") {
    return "video";
  }
  return VIDEO_EXT_REGEX.test(url) ? "video" : "image";
};

const extractToolMedia = (output: unknown): ToolCallMediaView[] => {
  const parsed = parseToolOutput(output);
  const media: ToolCallMediaView[] = [];
  const seen = new Set<string>();

  for (const artifact of parsed.artifacts) {
    if (!artifact.url || seen.has(artifact.url)) {
      continue;
    }
    seen.add(artifact.url);
    media.push({
      type: resolveMediaType(artifact.modality, artifact.url),
      url: artifact.url,
      uuid: artifact.uuid,
      modality: artifact.modality,
      ...(artifact.status ? { status: artifact.status } : {}),
    });
  }

  const root = typeof output === "string" ? safeParseJson(output) : output;
  if (isRecord(root)) {
    const url = normalizeString(root["url"]);
    if (url && !seen.has(url)) {
      const modality = normalizeString(root["modality"])?.toUpperCase();
      const uuid = normalizeString(root["uuid"]) ?? "";
      media.push({
        type: resolveMediaType(modality ?? null, url),
        url,
        uuid,
        modality: modality ?? (VIDEO_EXT_REGEX.test(url) ? "VIDEO" : "PICTURE"),
      });
    }
  }

  return media;
};

export function buildToolCallViews(calls: ToolCallRecord[]): ToolCallView[] {
  return calls.map((call, index) => ({
    tool_call_id: call.tool_call_id ?? `legacy-tool-call-${index}`,
    name: call.name,
    duration_ms: call.duration_ms,
    arguments: call.arguments,
    arguments_preview: formatArgsPreview(call.arguments),
    arguments_pretty: formatJsonBlock(call.arguments),
    output_pretty: formatToolOutput(call.output),
    media: extractToolMedia(call.output),
  }));
}

export function buildConversationView(
  trace: EvalTrace,
  tools: ToolCallView[],
): ConversationItemView[] {
  const toolMap = new Map(
    tools
      .filter((tool) => !tool.tool_call_id.startsWith("legacy-tool-call-"))
      .map((tool) => [tool.tool_call_id, tool]),
  );
  const legacyToolsQueue = tools.filter((tool) =>
    tool.tool_call_id.startsWith("legacy-tool-call-"),
  );
  const items: ConversationItemView[] = [];

  for (const message of trace.conversation) {
    if (message.role === "system") {
      continue;
    }

    if (message.role === "user") {
      items.push({ role: "user", content: message.content });
      continue;
    }

    if (message.role === "assistant") {
      const toolCalls = message.tool_calls?.map((call) => {
        const parsed = safeParseJson(call.function.arguments);
        const argsPreview = isRecord(parsed) ? formatArgsPreview(parsed) : "";
        return { name: call.function.name, arguments_preview: argsPreview };
      });

      items.push({
        role: "assistant",
        content: message.content ?? "",
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    if (message.role === "tool") {
      const tool =
        toolMap.get(message.tool_call_id) ?? legacyToolsQueue.shift();
      items.push({
        role: "tool",
        tool_call_id: message.tool_call_id,
        ...(tool
          ? {
              tool: {
                name: tool.name,
                arguments_preview: tool.arguments_preview,
                media: tool.media,
              },
            }
          : {}),
      });
    }
  }

  return items;
}

export function buildCaseRowView(result: EvalResult): CaseRowView {
  const status = runStatusText(result);
  const judge = runJudgeText(result);
  const detail = runDetailText(result, { truncate: false });
  const judgeDimension = result.dimensions.find(
    (dimension) => dimension.dimension === "llm_judge",
  );

  return {
    case_id: result.case_id,
    status_text: status.text,
    status_class: result.error ? "err" : result.passed ? "pass" : "fail",
    judge_text: judge.text,
    judge_class: judgeDimension
      ? judgeDimension.passed
        ? "pass"
        : "fail"
      : "",
    detail_text: detail.text,
    duration_ms: result.trace.duration_ms,
    duration_text: `${(result.trace.duration_ms / 1000).toFixed(1)}s`,
    tokens_total: result.trace.usage.total_tokens,
    tokens_text: `${result.trace.usage.total_tokens} tok`,
  };
}

export function buildCaseMetricsView(result: EvalResult): CaseMetricsView {
  const metrics = resolveMetrics(result);
  const pictureCount = metrics.artifacts_by_modality["PICTURE"] ?? 0;
  const videoCount = metrics.artifacts_by_modality["VIDEO"] ?? 0;

  return {
    tool_calls_total: metrics.tool_calls_total,
    tool_error_calls_total: metrics.tool_error_calls_total,
    tool_retry_calls_total: metrics.tool_retry_calls_total,
    picture_count: pictureCount,
    video_count: videoCount,
    artifact_count: metrics.artifacts_total,
  };
}

export type SpanView = {
  name: string;
  kind: string;
  duration_ms: number;
  duration_text: string;
  depth: number;
  attributes?: Span["attributes"];
};

export type TimingSummaryView = TimingSummary;

export function buildSpanViews(spans: Span[] | undefined): SpanView[] {
  if (!spans) return [];

  return spans.map((span) => {
    const depth = span.parent ? 1 : 0;
    return {
      name: span.name,
      kind: span.kind,
      duration_ms: span.duration_ms,
      duration_text:
        span.duration_ms < 1000
          ? `${span.duration_ms}ms`
          : `${(span.duration_ms / 1000).toFixed(2)}s`,
      depth,
      attributes: span.attributes,
    };
  });
}

export function buildTimingSummary(
  spans: Span[] | undefined,
): TimingSummaryView | null {
  if (!spans || spans.length === 0) return null;

  const summary: TimingSummary = {
    mcp_connect_ms: 0,
    mcp_list_tools_ms: 0,
    llm_total_ms: 0,
    llm_first_token_ms: null,
    tool_total_ms: 0,
    turns_count: 0,
  };

  for (const span of spans) {
    switch (span.kind) {
      case "mcp_connect":
        summary.mcp_connect_ms += span.duration_ms;
        break;
      case "mcp_list_tools":
        summary.mcp_list_tools_ms += span.duration_ms;
        break;
      case "llm_turn":
        summary.llm_total_ms += span.duration_ms;
        summary.turns_count++;
        if (
          span.attributes?.first_token_ms !== undefined &&
          summary.llm_first_token_ms === null
        ) {
          summary.llm_first_token_ms = span.attributes.first_token_ms;
        }
        break;
      case "tool_call":
        summary.tool_total_ms += span.duration_ms;
        break;
    }
  }

  return summary;
}
