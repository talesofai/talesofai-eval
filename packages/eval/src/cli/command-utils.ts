import {
  computeTraceMetrics,
  stripTraceMetricsDebug,
} from "../metrics/trace-metrics.ts";
import { createJsonReporter } from "../reporter/json.ts";
import { createTerminalReporter } from "../reporter/terminal.ts";
import { runCase } from "../runners/index.ts";
import { scoreTrace } from "../scorers/index.ts";
import { saveResult, saveTrace } from "../traces.ts";
import type {
  EvalCase,
  EvalResult,
  EvalTier,
  EvalTrace,
  Reporter,
  RunnerOptions,
  ToolCallRecord,
  ToolCallStartRecord,
} from "../types.ts";
import { type OutputFormat } from "./helpers.ts";

export function createReporterFromFormat(
  format: OutputFormat,
  verbose: boolean,
  concurrency = 1,
): Reporter {
  if (format === "json") {
    return createJsonReporter({ verbose });
  }

  return createTerminalReporter({ verbose, concurrency });
}

export function withStableMetrics(result: EvalResult): EvalResult {
  return {
    ...result,
    metrics: stripTraceMetricsDebug(computeTraceMetrics(result.trace)),
  };
}

export function makeErrorTrace(
  caseId: string,
  caseType: "plain" | "agent",
  errorMsg?: string,
): EvalTrace {
  return {
    case_id: caseId,
    case_type: caseType,
    conversation: [],
    tools_called: [],
    final_response: null,
    status: "error",
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    duration_ms: 0,
    ...(errorMsg !== undefined ? { error: errorMsg } : {}),
  };
}

export function applyOverrides(
  evalCase: EvalCase,
  overrides: Record<string, unknown>,
): EvalCase {
  return {
    ...evalCase,
    input: { ...evalCase.input, ...overrides },
  } as EvalCase;
}

export async function runAndScore(options: {
  runCase: EvalCase;
  scoreCase: EvalCase;
  runnerOpts: RunnerOptions;
  recordDir?: string;
  tierMax?: EvalTier;
}): Promise<EvalResult> {
  try {
    const trace = await runCase(options.runCase, options.runnerOpts);
    if (options.recordDir) {
      await saveTrace(trace, options.recordDir);
    }

    const result = withStableMetrics(
      await scoreTrace(options.scoreCase, trace, { tierMax: options.tierMax }),
    );
    if (options.recordDir) {
      await saveResult(result, options.recordDir).catch(() => {});
    }

    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorTrace = makeErrorTrace(
      options.runCase.id,
      options.runCase.type,
      errorMsg,
    );

    if (options.recordDir) {
      await saveTrace(errorTrace, options.recordDir).catch(() => {});
    }

    const result = withStableMetrics({
      case_id: options.runCase.id,
      case_type: options.runCase.type,
      description: options.runCase.description,
      preset_description:
        options.runCase.type === "agent"
          ? options.runCase.input.preset_description
          : undefined,
      passed: false,
      dimensions: [],
      trace: errorTrace,
      error: errorMsg,
    });

    if (options.recordDir) {
      await saveResult(result, options.recordDir).catch(() => {});
    }

    return result;
  }
}

export function createRunnerOptions(options: {
  reporter: Reporter;
  mcpServerBaseURL: string;
}): RunnerOptions {
  return {
    mcpServerBaseURL: options.mcpServerBaseURL,
    onDelta: (delta: string) => options.reporter.onDelta(delta),
    onToolStart: (call: ToolCallStartRecord) =>
      options.reporter.onToolStart(call),
    onToolCall: (call: ToolCallRecord) => options.reporter.onToolCall(call),
  };
}

function resolveDefaultConcurrency(totalTasks: number): number {
  return Math.max(1, Math.min(totalTasks, 8));
}

export function resolveConcurrency(
  configured: number | undefined,
  totalTasks: number,
): number {
  if (configured === undefined) {
    return resolveDefaultConcurrency(totalTasks);
  }

  return Math.max(1, configured);
}
