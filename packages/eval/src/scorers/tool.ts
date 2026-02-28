import type { AssertionConfig, DimensionResult, EvalTrace } from "../types.ts";

type ToolUsageAssertion = Extract<AssertionConfig, { type: "tool_usage" }>;

/**
 * Rule-based tool usage scorer.
 * Checks expected_tools (subset match) and forbidden_tools.
 */
export const scoreToolUsageAssertion = (
  trace: EvalTrace,
  assertion: AssertionConfig,
): DimensionResult => {
  if (assertion.type !== "tool_usage") {
    return {
      dimension: "tool_usage",
      passed: false,
      score: 0,
      reason: `internal error: expected tool_usage assertion, got ${assertion.type}`,
    };
  }

  const names = new Set(trace.tools_called.map((t) => t.name));
  const missing = (assertion.expected_tools ?? []).filter((t) => !names.has(t));
  const forbidden = (assertion.forbidden_tools ?? []).filter((t) =>
    names.has(t),
  );
  const passed = missing.length === 0 && forbidden.length === 0;

  const reasons: string[] = [];
  if (missing.length > 0) {
    reasons.push(`missing: ${missing.join(", ")}`);
  }
  if (forbidden.length > 0) {
    reasons.push(`forbidden used: ${forbidden.join(", ")}`);
  }

  return {
    dimension: "tool_usage",
    passed,
    score: passed ? 1 : 0,
    reason: passed ? "all tool constraints satisfied" : reasons.join("; "),
  };
};

export type { ToolUsageAssertion };
