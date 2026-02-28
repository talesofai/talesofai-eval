import pc from "picocolors";
import {
  DEFAULT_ALLOWED_TOOL_NAMES,
  type EvalCase,
  type EvalResult,
  type EvalTrace,
} from "../types.ts";
import {
  DEFAULT_PROXY_PORT,
  DEFAULT_UPSTREAM_API_BASE_URL,
} from "../constants.ts";
import {
  computeTraceMetrics,
  stripTraceMetricsDebug,
} from "../metrics/trace-metrics.ts";
import { createManuscriptProxy } from "../runners/manuscript-proxy.ts";
import { getNumberOption, isRecord } from "./helpers.ts";

export function resolveDefaultConcurrency(totalTasks: number): number {
  return Math.max(1, Math.min(totalTasks, 8));
}

export function resolveConcurrency(
  options: Record<string, unknown>,
  totalTasks: number,
): number {
  const configured = getNumberOption(options, "concurrency");
  if (configured === undefined) {
    return resolveDefaultConcurrency(totalTasks);
  }

  return Math.max(1, configured);
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

export function makeErroredResultFromTrace(options: {
  caseId: string;
  caseType: "plain" | "agent";
  trace: EvalTrace;
  fallbackError: string;
}): EvalResult {
  return {
    case_id: options.caseId,
    case_type: options.caseType,
    passed: false,
    dimensions: [],
    trace: options.trace,
    error: options.trace.error ?? options.fallbackError,
  };
}

export function withStableMetrics(result: EvalResult): EvalResult {
  return {
    ...result,
    metrics: stripTraceMetricsDebug(computeTraceMetrics(result.trace)),
  };
}

export function normalizeCachedResult(result: EvalResult): EvalResult {
  if (result.error) {
    return withStableMetrics(result);
  }

  if (result.trace.status !== "error" && !result.trace.error) {
    return withStableMetrics(result);
  }

  return withStableMetrics({
    case_id: result.case_id,
    case_type: result.case_type,
    passed: false,
    dimensions: [],
    trace: result.trace,
    error: result.trace.error ?? "Runner error in replay trace",
  });
}

export async function maybeStartProxy(needed: boolean) {
  if (!needed) {
    return null;
  }

  const proxyPort = Number(process.env["EVAL_PROXY_PORT"] ?? DEFAULT_PROXY_PORT);
  const upstreamBaseURL =
    process.env["EVAL_UPSTREAM_API_BASE_URL"] ?? DEFAULT_UPSTREAM_API_BASE_URL;
  const proxy = createManuscriptProxy({
    port: proxyPort,
    upstreamBaseURL,
    upstreamToken: process.env["EVAL_UPSTREAM_X_TOKEN"],
    allowedToolNames: [...DEFAULT_ALLOWED_TOOL_NAMES],
  });

  await proxy.start();
  process.stderr.write(
    pc.dim(`ManuscriptProxy started on port ${proxyPort}\n`),
  );
  return proxy;
}

export function applyOverrides(
  evalCase: EvalCase,
  overrides: Record<string, unknown>,
): EvalCase {
  if (evalCase.type === "plain") {
    return {
      ...evalCase,
      input: { ...evalCase.input, ...overrides },
    };
  }

  return {
    ...evalCase,
    input: { ...evalCase.input, ...overrides },
  };
}

export function parseVariants(rawVariants: string[]): Array<{
  label: string;
  overrides: Record<string, unknown>;
}> {
  if (rawVariants.length === 0) {
    throw new Error("parseVariants requires at least one variant");
  }

  const seenLabels = new Set<string>();
  const variants: Array<{ label: string; overrides: Record<string, unknown> }> =
    [];

  for (let index = 0; index < rawVariants.length; index++) {
    const raw = rawVariants[index];
    if (raw === undefined) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`variant #${index + 1}: ${error.message}`);
      }
      throw error;
    }

    if (!isRecord(parsed)) {
      throw new Error(`variant #${index + 1}: must be a JSON object`);
    }

    const label = parsed["label"];
    if (typeof label !== "string" || label.trim().length === 0) {
      throw new Error(`variant #${index + 1}: missing or empty "label" field`);
    }

    if (seenLabels.has(label)) {
      throw new Error(`duplicate variant label: "${label}"`);
    }

    seenLabels.add(label);

    const overrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== "label") {
        overrides[key] = value;
      }
    }

    variants.push({ label, overrides });
  }

  return variants;
}
