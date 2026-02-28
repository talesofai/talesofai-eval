import type {
  AssertionConfig,
  DimensionResult,
  EvalCase,
  EvalTrace,
  ScorerFn,
} from "../types.ts";
import { scoreLlmJudgeAssertion } from "./llm-judge.ts";
import { scoreFinalStatusAssertion } from "./status.ts";
import { scoreToolUsageAssertion } from "./tool.ts";

export type { ScorerFn };

export const SCORER_REGISTRY: Record<
  AssertionConfig["type"],
  (
    trace: EvalTrace,
    assertion: AssertionConfig,
    evalCase: EvalCase,
  ) => Promise<DimensionResult> | DimensionResult
> = {
  tool_usage: (trace, assertion, _evalCase) =>
    scoreToolUsageAssertion(trace, assertion),
  final_status: (trace, assertion, _evalCase) =>
    scoreFinalStatusAssertion(trace, assertion),
  llm_judge: (trace, assertion, _evalCase) =>
    scoreLlmJudgeAssertion(trace, assertion),
};

/**
 * Runtime guard: narrow an AssertionConfig to one of the known variants.
 *
 * Note: loader zod schema should already ensure this, but TS-built cases may
 * bypass the loader. We still keep a guard for defensive programming.
 */
export function isKnownAssertionType(
  type: string,
): type is AssertionConfig["type"] {
  return type in SCORER_REGISTRY;
}

export function hasAssertion(
  evalCase: EvalCase,
  type: AssertionConfig["type"],
): boolean {
  return evalCase.criteria.assertions?.some((a) => a.type === type) ?? false;
}
