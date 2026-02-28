import {
  computeTraceMetrics,
  stripTraceMetricsDebug,
  summarizeTraceMetrics,
} from "../metrics/trace-metrics.ts";
import type {
  DiffResult,
  DiffSummary,
  EvalCase,
  EvalResult,
  EvalSummary,
  MatrixCell,
  MatrixReporter,
  MatrixSummary,
  Reporter,
  ToolCallRecord,
  ToolCallStartRecord,
  TraceMetrics,
} from "../types.ts";

const METRICS_DEBUG_ARTIFACT_LIMIT = 10;
const MAX_DEBUG_UUID_CHARS = 64;
const MAX_DEBUG_URL_CHARS = 160;

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}…`;
}

function resolveStableMetrics(result: EvalResult): TraceMetrics {
  return stripTraceMetricsDebug(
    result.metrics ?? computeTraceMetrics(result.trace),
  );
}

function buildVerboseMetrics(result: EvalResult): TraceMetrics {
  const stable = resolveStableMetrics(result);
  const debugMetrics = computeTraceMetrics(result.trace, { debug: true });

  const artifacts = debugMetrics.debug?.artifacts;
  const deliveredUrls = debugMetrics.debug?.delivered_urls;

  const debugArtifacts = Array.isArray(artifacts)
    ? artifacts.slice(0, METRICS_DEBUG_ARTIFACT_LIMIT).map((artifact) => ({
        ...artifact,
        uuid: truncateText(artifact.uuid, MAX_DEBUG_UUID_CHARS),
        url: truncateText(artifact.url, MAX_DEBUG_URL_CHARS),
      }))
    : undefined;

  const debugDeliveredUrls = Array.isArray(deliveredUrls)
    ? deliveredUrls
        .slice(0, METRICS_DEBUG_ARTIFACT_LIMIT)
        .map((url) => truncateText(url, MAX_DEBUG_URL_CHARS))
    : undefined;

  const debugPayload = {
    ...(debugArtifacts ? { artifacts: debugArtifacts } : {}),
    ...(debugDeliveredUrls ? { delivered_urls: debugDeliveredUrls } : {}),
  };

  return {
    ...stable,
    ...(Object.keys(debugPayload).length > 0 ? { debug: debugPayload } : {}),
  };
}

/**
 * JSON (NDJSON) reporter — each result/summary is one JSON line to stdout.
 */
export const createJsonReporter = (options?: {
  verbose?: boolean;
}): Reporter => {
  const verbose = options?.verbose ?? false;

  return {
    onCaseStart(_c: EvalCase, _index: number, _total: number) {
      // silent in JSON mode
    },

    onDelta(delta: string) {
      if (verbose) {
        process.stderr.write(delta);
      }
    },

    onToolStart(_call: ToolCallStartRecord) {
      // silent in JSON mode
    },

    onToolCall(_call: ToolCallRecord) {
      // silent in JSON mode
    },

    onCaseResult(result: EvalResult) {
      const output: {
        type: string;
        id: string;
        case_type: string;
        passed: boolean;
        dimensions: typeof result.dimensions;
        duration_ms: number;
        usage: typeof result.trace.usage;
        metrics: TraceMetrics;
        conversation?: typeof result.trace.conversation;
        tools_called?: typeof result.trace.tools_called;
        error?: string;
      } = {
        type: "result",
        id: result.case_id,
        case_type: result.case_type,
        passed: result.passed,
        dimensions: result.dimensions,
        duration_ms: result.trace.duration_ms,
        usage: result.trace.usage,
        metrics: verbose
          ? buildVerboseMetrics(result)
          : resolveStableMetrics(result),
      };

      if (verbose) {
        output.conversation = result.trace.conversation;
        output.tools_called = result.trace.tools_called;
      }

      if (result.error) {
        output.error = result.error;
      }

      process.stdout.write(`${JSON.stringify(output)}\n`);
    },

    onDiffResult(result: DiffResult) {
      const output = {
        type: "diff",
        id: result.case_id,
        verdict: result.verdict,
        reason: result.reason,
      };
      process.stdout.write(`${JSON.stringify(output)}\n`);
    },

    onSummary(summary: EvalSummary) {
      const output = {
        type: "summary",
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        errored: summary.errored,
        ms: summary.duration_ms,
        metrics_summary: summarizeTraceMetrics(summary.results),
      };
      process.stdout.write(`${JSON.stringify(output)}\n`);
    },

    onDiffSummary(summary: DiffSummary) {
      const output = {
        type: "diff_summary",
        total: summary.total,
        base_better: summary.base_better,
        candidate_better: summary.candidate_better,
        equivalent: summary.equivalent,
        errored: summary.errored,
        ms: summary.duration_ms,
      };
      process.stdout.write(`${JSON.stringify(output)}\n`);
    },
  };
};

export const createJsonMatrixReporter = (): MatrixReporter => {
  return {
    onCellStart(
      _caseId: string,
      _variantLabel: string,
      _cellIndex: number,
      _total: number,
    ) {
      // silent in JSON mode
    },

    onCellResult(cell: MatrixCell) {
      const output = {
        type: "matrix_cell",
        case_id: cell.case_id,
        variant: cell.variant_label,
        passed: cell.result.passed,
        dimensions: cell.result.dimensions,
        duration_ms: cell.result.trace.duration_ms,
        usage: cell.result.trace.usage,
        metrics: resolveStableMetrics(cell.result),
        ...(cell.result.error ? { error: cell.result.error } : {}),
      };
      process.stdout.write(`${JSON.stringify(output)}\n`);
    },

    onMatrixSummary(summary: MatrixSummary) {
      const output = {
        type: "matrix_summary",
        variants: summary.variants,
        case_ids: summary.case_ids,
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        errored: summary.errored,
        ms: summary.duration_ms,
        metrics_summary: summarizeTraceMetrics(
          summary.cells.map((cell) => cell.result),
        ),
      };
      process.stdout.write(`${JSON.stringify(output)}\n`);
    },
  };
};
