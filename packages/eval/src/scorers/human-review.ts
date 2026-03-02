import type { AssertionConfig, DimensionResult, EvalTrace } from "../types.ts";

export const scoreHumanReview = (
  _trace: EvalTrace,
  assertion: AssertionConfig,
): DimensionResult => {
  if (assertion.type !== "human_review") {
    return {
      dimension: "human_review",
      passed: false,
      score: 0,
      reason: `internal error: expected human_review assertion, got ${assertion.type}`,
    };
  }

  const reason = assertion.reason ?? "flagged for human review";

  return {
    dimension: "human_review",
    passed: true,
    score: 1.0,
    reason,
  };
};
