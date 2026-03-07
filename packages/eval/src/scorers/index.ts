import type {
  AssertionConfig,
  DimensionResult,
  EvalCase,
  EvalResult,
  EvalTier,
  EvalTrace,
} from "../types.ts";
import { isKnownAssertionType, SCORER_REGISTRY } from "./registry.ts";
import { normalizeAssertions } from "../utils/normalize-assertions.ts";

export { SCORER_REGISTRY } from "./registry.ts";

const DEFAULT_TIER: Record<AssertionConfig["type"], EvalTier> = {
  tool_usage: 1,
  final_status: 1,
  error_recovery: 1,
  llm_judge: 2,
  task_success: 2,
  tool_parameter_accuracy: 2,
  skill_usage: 2,
  bash_execution: 2,
  human_review: 3,
};

function resolveAssertionTier(
  assertionType: AssertionConfig["type"],
  tier?: EvalTier,
): EvalTier {
  return tier ?? DEFAULT_TIER[assertionType] ?? 2;
}

export const scoreTrace = async (
  evalCase: EvalCase,
  trace: EvalTrace,
  options?: { tierMax?: EvalTier },
): Promise<EvalResult> => {
  const tierMax: EvalTier = options?.tierMax ?? 2;
  const rawAssertions = normalizeAssertions(evalCase.criteria);

  if (rawAssertions.length === 0) {
    if (trace.status === "error" || trace.error) {
      const reason = trace.error ?? "runner returned error trace";
      process.stderr.write(
        `WARN: case '${evalCase.id}': no assertions defined but trace errored — marking failed\n`,
      );
      return makeResult(evalCase, trace, false, [
        {
          dimension: "final_status",
          tier: 1,
          passed: false,
          score: 0,
          reason,
        },
      ]);
    }

    process.stderr.write(
      `WARN: case '${evalCase.id}': no assertions defined — skipping scoring\n`,
    );
    return makeResult(evalCase, trace, true, []);
  }

  let activeAssertions = rawAssertions.filter(
    (a) => resolveAssertionTier(a.type, a.tier) <= tierMax,
  );

  if (activeAssertions.length === 0) {
    process.stderr.write(
      `WARN: case '${evalCase.id}': all assertions require tier > ${tierMax} — cannot evaluate at this tier\n`,
    );

    if (tierMax >= 2) {
      process.stderr.write(
        `WARN: case '${evalCase.id}': auto-synthesizing task_success fallback\n`,
      );
      activeAssertions = [{ type: "task_success", pass_threshold: 0.7 }];
    } else {
      const syntheticDimension: DimensionResult = {
        dimension: "task_success",
        tier: 1,
        auto_synthesized: true,
        passed: false,
        score: 0,
        reason:
          "no active assertions at tier ≤ 1; define at least one tier-1 assertion for fast CI",
      };
      return makeResult(evalCase, trace, false, [syntheticDimension]);
    }
  }

  const tasks = activeAssertions.map(
    async (assertion): Promise<DimensionResult> => {
      if (!isKnownAssertionType(assertion.type)) {
        throw new Error(`unknown assertion type: ${assertion.type}`);
      }

      const scorer = SCORER_REGISTRY[assertion.type];
      const raw = await scorer(trace, assertion, evalCase);
      const tier = resolveAssertionTier(assertion.type, assertion.tier);
      return { ...raw, tier };
    },
  );

  const dimensions = await Promise.all(tasks);

  const markedDimensions: DimensionResult[] = dimensions.map((d) => {
    const wasAutoSynthesized =
      rawAssertions.length > 0 &&
      rawAssertions.every(
        (a) => resolveAssertionTier(a.type, a.tier) > tierMax,
      );
    if (wasAutoSynthesized && d.dimension === "task_success") {
      return { ...d, auto_synthesized: true as const };
    }
    return d;
  });

  const passed = markedDimensions
    .filter((d) => d.dimension !== "human_review")
    .every((d) => d.passed);

  return makeResult(evalCase, trace, passed, markedDimensions);
};

function makeResult(
  evalCase: EvalCase,
  trace: EvalTrace,
  passed: boolean,
  dimensions: DimensionResult[],
): EvalResult {
  return {
    case_id: evalCase.id,
    case_type: evalCase.type,
    description: evalCase.description,
    ...(evalCase.type === "agent" &&
    evalCase.input.preset_description !== undefined
      ? { preset_description: evalCase.input.preset_description }
      : {}),
    passed,
    dimensions,
    trace,
  };
}
