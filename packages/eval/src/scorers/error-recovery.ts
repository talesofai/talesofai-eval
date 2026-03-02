import { parseToolOutput, stableStringify } from "../metrics/trace-metrics.ts";
import type { AssertionConfig, DimensionResult, EvalTrace } from "../types.ts";

type ErrorRecoveryAssertion = Extract<
  AssertionConfig,
  { type: "error_recovery" }
>;

const DEFAULT_PASS_THRESHOLD = 0.5;

export const scoreErrorRecovery = (
  trace: EvalTrace,
  assertion: AssertionConfig,
): DimensionResult => {
  if (assertion.type !== "error_recovery") {
    return {
      dimension: "error_recovery",
      passed: false,
      score: 0,
      reason: `internal error: expected error_recovery assertion, got ${assertion.type}`,
    };
  }

  const a = assertion as ErrorRecoveryAssertion;
  const passThreshold = a.pass_threshold ?? DEFAULT_PASS_THRESHOLD;
  const toolFilter = a.tool_name;

  const calls = trace.tools_called;
  let totalErrors = 0;
  let recoveries = 0;

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    if (!call) continue;
    if (toolFilter && call.name !== toolFilter) continue;

    const parsed = parseToolOutput(call.output);
    if (!parsed.explicitError) continue;

    totalErrors++;

    const windowEnd = Math.min(i + 6, calls.length);
    for (let j = i + 1; j < windowEnd; j++) {
      const retryCall = calls[j];
      if (!retryCall) continue;
      if (retryCall.name !== call.name) continue;

      if (
        stableStringify(retryCall.arguments) !== stableStringify(call.arguments)
      ) {
        recoveries++;
        break;
      }
    }
  }

  if (totalErrors === 0) {
    return {
      dimension: "error_recovery",
      passed: true,
      score: 1.0,
      reason: "no tool errors encountered",
    };
  }

  const score = recoveries / totalErrors;
  const passed = score >= passThreshold;

  return {
    dimension: "error_recovery",
    passed,
    score: Math.round(score * 10000) / 10000,
    reason: passed
      ? `recovered ${recoveries}/${totalErrors} errors (score ${score.toFixed(2)} ≥ threshold ${passThreshold})`
      : `only recovered ${recoveries}/${totalErrors} errors (score ${score.toFixed(2)} < threshold ${passThreshold})`,
  };
};
