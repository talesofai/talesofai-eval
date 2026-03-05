import type { AssertionConfig, EvalCriteria } from "../types.ts";

/**
 * Normalize criteria into a flat assertions array.
 * Handles both the new `assertions` format and legacy top-level fields
 * (`expected_tools`, `forbidden_tools`, `expected_status`, `llm_judge`).
 *
 * New assertions take precedence; legacy fields are only converted
 * when no assertions are defined.
 */
export function normalizeAssertions(criteria: EvalCriteria): AssertionConfig[] {
  const base = criteria.assertions ? [...criteria.assertions] : [];

  // Only normalize legacy fields if no assertions are defined
  // (assertions-based format is the source of truth)
  if (base.length > 0) {
    return base;
  }

  // Legacy: expected_tools / forbidden_tools → tool_usage
  if (criteria.expected_tools || criteria.forbidden_tools) {
    base.push({
      type: "tool_usage",
      ...(criteria.expected_tools !== undefined
        ? { expected_tools: criteria.expected_tools }
        : {}),
      ...(criteria.forbidden_tools !== undefined
        ? { forbidden_tools: criteria.forbidden_tools }
        : {}),
    });
  }

  // Legacy: expected_status → final_status
  if (criteria.expected_status) {
    base.push({
      type: "final_status",
      expected_status: criteria.expected_status,
    });
  }

  // Legacy: llm_judge → llm_judge assertion
  if (criteria.llm_judge) {
    base.push({
      type: "llm_judge",
      prompt: criteria.llm_judge.prompt,
      pass_threshold: criteria.llm_judge.pass_threshold,
    });
  }

  return base;
}
