import pc from "picocolors";
import { computeTraceMetrics } from "../metrics/trace-metrics.ts";
import type {
  EvalResult,
  EvalSummary,
  MatrixCell,
  MatrixSummary,
  TraceMetrics,
} from "../types.ts";
import { isRecord } from "../utils/type-guards.ts";

const safeParseJsonString = (raw: string): unknown | null => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

function extractStructuredContent(
  value: Record<string, unknown>,
): unknown | undefined {
  if ("structuredContent" in value) {
    return value["structuredContent"];
  }
  return undefined;
}

function normalizeToolTextPayload(text: string): unknown {
  const parsed = safeParseJsonString(text);
  if (isRecord(parsed)) {
    const structuredContent = extractStructuredContent(parsed);
    if (structuredContent !== undefined) {
      return structuredContent;
    }
  }
  return parsed ?? text;
}

const HUMANIZE_INDENT = "  ";
export const MAX_STR_CHARS = 120;
const VERBOSE_ARTIFACT_LIMIT = 6;
const VERBOSE_UUID_MAX = 48;
const VERBOSE_URL_MAX = 120;
const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;
const IMAGE_HINT_MAX_URLS = 2;
const RUN_GRID_DETAIL_MAX_CHARS = 80;

type HumanizeOptions = { verbose: boolean };
type ColoredText = { text: string; colorer: (s: string) => string };

const isScalar = (
  v: unknown,
): v is null | undefined | string | number | boolean =>
  v === null ||
  v === undefined ||
  typeof v === "string" ||
  typeof v === "number" ||
  typeof v === "boolean";

const renderScalar = (
  v: null | undefined | string | number | boolean,
  opts: HumanizeOptions,
): string => {
  if (v === null || v === undefined) {
    return "-";
  }

  if (typeof v === "string") {
    return !opts.verbose && v.length > MAX_STR_CHARS
      ? `${v.slice(0, MAX_STR_CHARS)}…`
      : v;
  }

  return String(v);
};

/**
 * Render an arbitrary value as a human-readable YAML-like string.
 * Scalars render inline; objects and arrays use block style with depth-based
 * indentation. No string trimming or index-slicing needed.
 */
export const humanize = (
  value: unknown,
  depth = 0,
  opts: HumanizeOptions = { verbose: false },
): string => {
  const pad = HUMANIZE_INDENT.repeat(depth);

  if (isScalar(value)) {
    return `${pad}${renderScalar(value, opts)}`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${pad}[]`;
    }
    return value
      .map((item) => {
        if (isScalar(item)) {
          return `${pad}- ${renderScalar(item, opts)}`;
        }
        return `${pad}-\n${humanize(item, depth + 1, opts)}`;
      })
      .join("\n");
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${pad}{}`;
    }
    return entries
      .map(([key, val]) => {
        if (isScalar(val)) {
          return `${pad}${key}: ${renderScalar(val, opts)}`;
        }
        return `${pad}${key}:\n${humanize(val, depth + 1, opts)}`;
      })
      .join("\n");
  }

  return `${pad}${String(value)}`;
};

export const formatToolArguments = (
  argumentsValue: Record<string, unknown>,
  verbose: boolean,
): string => {
  return humanize(argumentsValue, 0, { verbose });
};

export const formatToolReturnForLlm = (
  output: unknown,
  verbose: boolean,
): string => {
  if (typeof output === "string") {
    return humanize(normalizeToolTextPayload(output), 0, { verbose });
  }

  if (isRecord(output)) {
    const structuredContent = extractStructuredContent(output);
    if (structuredContent !== undefined) {
      return humanize(structuredContent, 0, { verbose });
    }

    const content = output["content"];
    if (Array.isArray(content)) {
      const first = content[0];
      if (isRecord(first) && typeof first["text"] === "string") {
        return humanize(normalizeToolTextPayload(first["text"]), 0, {
          verbose,
        });
      }
    }
  }

  return humanize(output, 0, { verbose });
};

export function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}…`;
}

export function resolveMetrics(result: EvalResult): TraceMetrics {
  return result.metrics ?? computeTraceMetrics(result.trace);
}

export function renderCaseMetricsBrief(metrics: TraceMetrics): string {
  const pictureCount = metrics.artifacts_success_by_modality["PICTURE"] ?? 0;
  const videoCount = metrics.artifacts_success_by_modality["VIDEO"] ?? 0;
  const delivered = metrics.delivery_contains_artifact_url ? "yes" : "no";

  return [
    "metrics:",
    `tools ${metrics.tool_calls_total} (errors ${metrics.tool_error_calls_total}, retries ${metrics.tool_retry_calls_total})`,
    `artifacts picture ${pictureCount}, video ${videoCount}`,
    `bindings ${metrics.bindings_total}`,
    `delivered ${delivered}`,
  ].join(" | ");
}

export function renderVerboseArtifactLines(result: EvalResult): string[] {
  const debug = computeTraceMetrics(result.trace, { debug: true }).debug;
  const artifacts = debug?.artifacts ?? [];
  if (artifacts.length === 0) {
    return [];
  }

  const lines = artifacts
    .slice(0, VERBOSE_ARTIFACT_LIMIT)
    .map((artifact, index) => {
      const uuidPreview = truncateText(artifact.uuid, VERBOSE_UUID_MAX);
      const urlPreview = truncateText(artifact.url, VERBOSE_URL_MAX);
      const status = artifact.status ?? "UNKNOWN";

      return `${index + 1}. ${artifact.modality} ${status} uuid=${uuidPreview} url=${urlPreview}`;
    });

  if (artifacts.length > VERBOSE_ARTIFACT_LIMIT) {
    lines.push(
      `... +${artifacts.length - VERBOSE_ARTIFACT_LIMIT} more artifacts`,
    );
  }

  const deliveredUrls = debug?.delivered_urls ?? [];
  if (deliveredUrls.length > 0) {
    const deliveredPreview = deliveredUrls
      .slice(0, VERBOSE_ARTIFACT_LIMIT)
      .map((url) => truncateText(url, VERBOSE_URL_MAX))
      .join(", ");
    lines.push(`delivered_urls: ${deliveredPreview}`);
  }

  return lines;
}

export function extractMarkdownImageUrls(text: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(MARKDOWN_IMAGE_RE)) {
    const url = match[1];
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    urls.push(url);

    if (urls.length >= IMAGE_HINT_MAX_URLS) {
      break;
    }
  }

  return urls;
}

function getLlmJudgeDimension(result: EvalResult) {
  return result.dimensions.find(
    (dimension) => dimension.dimension === "llm_judge",
  );
}

function maxWidth(title: string, values: string[]): number {
  return Math.max(title.length, ...values.map((v) => v.length));
}

export function runStatusText(result: EvalResult): ColoredText {
  if (result.error) {
    return { text: "ERR", colorer: pc.yellow };
  }

  return result.passed
    ? { text: "PASS", colorer: pc.green }
    : { text: "FAIL", colorer: pc.red };
}

export function truncateRunGridDetail(text: string): string {
  return truncateText(text, RUN_GRID_DETAIL_MAX_CHARS);
}

export function runJudgeText(result: EvalResult): ColoredText {
  const llmJudgeDimension = getLlmJudgeDimension(result);
  if (!llmJudgeDimension) {
    return { text: "---", colorer: pc.dim };
  }

  return {
    text: llmJudgeDimension.score.toFixed(2),
    colorer: llmJudgeDimension.passed ? pc.green : pc.red,
  };
}

export function runDetailText(
  result: EvalResult,
  options?: { truncate?: boolean },
): ColoredText {
  const truncate = options?.truncate ?? true;

  if (result.error) {
    return {
      text: truncate ? truncateRunGridDetail(result.error) : result.error,
      colorer: pc.red,
    };
  }

  const llmJudgeDimension = getLlmJudgeDimension(result);
  if (!llmJudgeDimension) {
    return { text: "---", colorer: pc.dim };
  }

  const reason = llmJudgeDimension.reason;
  return {
    text: truncate ? truncateRunGridDetail(reason) : reason,
    colorer: pc.dim,
  };
}

export function escapeMarkdownCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

export function renderRunGrid(summary: EvalSummary): string {
  const results = summary.results;
  if (results.length === 0) {
    return "";
  }

  const caseIdValues = results.map((result) => result.case_id);
  const statusValues = results.map((result) => runStatusText(result).text);
  const judgeValues = results.map((result) => runJudgeText(result).text);
  const durationValues = results.map(
    (result) => `${(result.trace.duration_ms / 1000).toFixed(1)}s`,
  );
  const tokenValues = results.map(
    (result) => `${result.trace.usage.total_tokens} tok`,
  );
  const detailValues = results.map((result) => runDetailText(result).text);

  const caseIdWidth = maxWidth("case", caseIdValues);
  const statusWidth = maxWidth("status", statusValues);
  const judgeWidth = maxWidth("judge", judgeValues);
  const durationWidth = maxWidth("duration", durationValues);
  const tokenWidth = maxWidth("tokens", tokenValues);
  const detailWidth = maxWidth("detail", detailValues);

  const lines: string[] = [];
  lines.push(
    [
      pc.dim("case".padEnd(caseIdWidth)),
      pc.dim("status".padEnd(statusWidth)),
      pc.dim("judge".padEnd(judgeWidth)),
      pc.dim("duration".padEnd(durationWidth)),
      pc.dim("tokens".padEnd(tokenWidth)),
      pc.dim("detail".padEnd(detailWidth)),
    ].join("  "),
  );

  for (const result of results) {
    const status = runStatusText(result);
    const judge = runJudgeText(result);
    const detail = runDetailText(result);
    const duration = `${(result.trace.duration_ms / 1000).toFixed(1)}s`;
    const tokens = `${result.trace.usage.total_tokens} tok`;

    lines.push(
      [
        result.case_id.padEnd(caseIdWidth),
        status.colorer(status.text.padEnd(statusWidth)),
        judge.colorer(judge.text.padEnd(judgeWidth)),
        pc.dim(duration.padEnd(durationWidth)),
        pc.dim(tokens.padEnd(tokenWidth)),
        detail.colorer(detail.text.padEnd(detailWidth)),
      ].join("  "),
    );
  }

  return lines.join("\n");
}

function cellStatusText(cell: MatrixCell | undefined): ColoredText {
  if (!cell) {
    return { text: "---", colorer: pc.dim };
  }

  if (cell.result.error) {
    return { text: "ERR", colorer: pc.yellow };
  }

  const llmJudgeDimension = getLlmJudgeDimension(cell.result);
  if (llmJudgeDimension) {
    return {
      text: llmJudgeDimension.score.toFixed(2),
      colorer: llmJudgeDimension.passed ? pc.green : pc.red,
    };
  }

  return cell.result.passed
    ? { text: "PASS", colorer: pc.green }
    : { text: "FAIL", colorer: pc.red };
}

export function renderMatrixGrid(summary: MatrixSummary): string {
  const caseIds = summary.case_ids;
  const variantLabels = summary.variants;

  if (caseIds.length === 0 || variantLabels.length === 0) {
    return "";
  }

  const cellMap = new Map<string, MatrixCell>();
  for (const cell of summary.cells) {
    cellMap.set(`${cell.case_id}:${cell.variant_label}`, cell);
  }

  const colWidths = variantLabels.map((variantLabel) =>
    Math.max(variantLabel.length, 4),
  );
  const labelWidth = Math.max(...caseIds.map((caseId) => caseId.length));

  const lines: string[] = [];

  const headerPadding = " ".repeat(labelWidth);
  const header = variantLabels
    .map((variantLabel, index) =>
      pc.dim(variantLabel.padEnd(colWidths[index] ?? 4)),
    )
    .join("  ");
  lines.push(`${headerPadding}  ${header}`);

  for (const caseId of caseIds) {
    const label = caseId.padEnd(labelWidth);
    const columns = variantLabels
      .map((variantLabel, index) => {
        const cell = cellMap.get(`${caseId}:${variantLabel}`);
        const status = cellStatusText(cell);
        return status.colorer(status.text.padEnd(colWidths[index] ?? 4));
      })
      .join("  ");
    lines.push(`${label}  ${columns}`);
  }

  return lines.join("\n");
}
