import { ENV_KEYS, resolveJudgeModels } from "../config.ts";
import type { AssertionConfig, EvalCase, EvalTier } from "../types.ts";
import { normalizeAssertions } from "../utils/normalize-assertions.ts";

const JUDGE_ASSERTION_TYPES = new Set<AssertionConfig["type"]>([
  "llm_judge",
  "task_success",
  "tool_parameter_accuracy",
  "skill_usage",
]);

const DEFAULT_TIER: Record<AssertionConfig["type"], EvalTier> = {
  tool_usage: 1,
  final_status: 1,
  error_recovery: 1,
  llm_judge: 2,
  task_success: 2,
  tool_parameter_accuracy: 2,
  skill_usage: 2,
  human_review: 3,
};

function resolveAssertionTier(assertion: AssertionConfig): EvalTier {
  return assertion.tier ?? DEFAULT_TIER[assertion.type];
}

function resolveJudgeModel(): string | undefined {
  const value = process.env[ENV_KEYS.JUDGE_MODEL];
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function caseNeedsJudge(
  evalCase: EvalCase,
  options?: { tierMax?: EvalTier },
): boolean {
  const tierMax = options?.tierMax ?? 2;

  // Use normalizeAssertions to ensure assertions-first strategy
  const assertions = normalizeAssertions(evalCase.criteria);

  return assertions.some(
    (assertion) =>
      resolveAssertionTier(assertion) <= tierMax &&
      JUDGE_ASSERTION_TYPES.has(assertion.type),
  );
}

export function getMissingJudgeConfig(): string[] {
  const missing: string[] = [];
  const multiJudgeModels = resolveJudgeModels();

  if (
    (!multiJudgeModels || multiJudgeModels.length === 0) &&
    !resolveJudgeModel()
  ) {
    missing.push(ENV_KEYS.JUDGE_MODEL);
  }

  return missing;
}

export function getMissingRunConfig(
  cases: EvalCase[],
  options?: { replay?: boolean; tierMax?: EvalTier },
): string[] {
  const replay = options?.replay ?? false;
  const tierMax = options?.tierMax ?? 2;

  if (replay) {
    // Replay prefers cached *.result.json when available, so no upfront judge
    // env requirement here. If cache is missing for a case with llm_judge,
    // that case falls back to scoring and may require judge config then.
    return [];
  }

  const missing = new Set<string>();

  // Check for judge config on cases that need it
  for (const evalCase of cases) {
    if (caseNeedsJudge(evalCase, { tierMax })) {
      for (const key of getMissingJudgeConfig()) {
        missing.add(key);
      }
    }
  }

  return [...missing];
}

export function getMissingDiffConfig(cases: EvalCase[]): string[] {
  const missing = new Set<string>(
    getMissingRunConfig(cases, { replay: false }),
  );

  if (!resolveJudgeModel()) {
    missing.add(ENV_KEYS.JUDGE_MODEL);
  }

  return [...missing];
}
