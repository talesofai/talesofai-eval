import type { AssertionConfig, DimensionResult, EvalTrace } from "../types.ts";

type FinalStatusAssertion = Extract<AssertionConfig, { type: "final_status" }>;

/**
 * Rule-based status scorer for AgentEvalCase.
 * Maps trace.status to manuscript running status.
 */
export const scoreFinalStatusAssertion = (
  trace: EvalTrace,
  assertion: AssertionConfig,
): DimensionResult => {
  if (assertion.type !== "final_status") {
    return {
      dimension: "final_status",
      passed: false,
      score: 0,
      reason: `internal error: expected final_status assertion, got ${assertion.type}`,
    };
  }

  const expected = assertion.expected_status;

  // Map trace status → manuscript running status
  const statusMap: Record<string, string> = {
    success: "SUCCESS",
    failure: "FAILURE",
    cancelled: "STOP",
    error: "FAILURE",
  };

  const actual = statusMap[trace.status] ?? "UNKNOWN";
  const passed = actual === expected;

  return {
    dimension: "final_status",
    passed,
    score: passed ? 1 : 0,
    reason: passed
      ? `status matched: ${expected}`
      : `expected ${expected}, got ${actual}`,
  };
};

export type { FinalStatusAssertion };
