import type {
  DimensionResult,
  EvalCase,
  EvalResult,
  EvalTrace,
} from "../types.ts";
import { isKnownAssertionType, SCORER_REGISTRY } from "./registry.ts";

export { compareTraces } from "./diff.ts";
export { SCORER_REGISTRY } from "./registry.ts";

/**
 * Run all applicable scorers on a trace and produce an EvalResult.
 */
export const scoreTrace = async (
  evalCase: EvalCase,
  trace: EvalTrace,
): Promise<EvalResult> => {
  const assertions = evalCase.criteria.assertions ?? [];

  if (assertions.length === 0) {
    return {
      case_id: evalCase.id,
      case_type: evalCase.type,
      description: evalCase.description,
      preset_description:
        evalCase.type === "agent"
          ? evalCase.input.preset_description
          : undefined,
      passed: true,
      dimensions: [],
      trace,
    };
  }

  const tasks = assertions.map(async (assertion): Promise<DimensionResult> => {
    // Defensive guard: TS-built cases might bypass zod.
    if (!isKnownAssertionType(assertion.type)) {
      throw new Error(`unknown assertion type: ${assertion.type}`);
    }

    const scorer = SCORER_REGISTRY[assertion.type];
    return await scorer(trace, assertion, evalCase);
  });

  const dimensions = await Promise.all(tasks);
  const passed = dimensions.every((d) => d.passed);

  return {
    case_id: evalCase.id,
    case_type: evalCase.type,
    description: evalCase.description,
    preset_description:
      evalCase.type === "agent" ? evalCase.input.preset_description : undefined,
    passed,
    dimensions,
    trace,
  };
};
