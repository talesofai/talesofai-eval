import type {
  AssertionConfig,
  DimensionResult,
  EvalCase,
  EvalResult,
  EvalTier,
  EvalTrace,
} from "../types.ts";
import { isKnownAssertionType, SCORER_REGISTRY } from "./registry.ts";

export { SCORER_REGISTRY } from "./registry.ts";

/**
 * Normalize criteria into a flat assertions array.
 * Handles both the new `assertions` format and legacy top-level fields
 * (`expected_tools`, `forbidden_tools`, `expected_status`, `llm_judge`).
 * New assertions take precedence; legacy fields are appended if not already
 * represented in `assertions`.
 */
function normalizeAssertions(
  criteria: EvalCase["criteria"],
): AssertionConfig[] {
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
      expected_tools: criteria.expected_tools,
      forbidden_tools: criteria.forbidden_tools,
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

const DEFAULT_TIER: Record<AssertionConfig["type"], EvalTier> = {
  tool_usage: 1,
  final_status: 1,
  error_recovery: 1,
  llm_judge: 2,
  task_success: 2,
  tool_parameter_accuracy: 2,
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
    preset_description:
      evalCase.type === "agent" ? evalCase.input.preset_description : undefined,
    passed,
    dimensions,
    trace,
  };
}
