import {
  ENV_KEYS,
  resolveJudgeApiKey,
  resolveJudgeBaseURL,
  resolveJudgeModel,
  resolveRunnerApiKey,
  resolveRunnerBaseURL,
} from "../env.ts";
import type { AssertionConfig, EvalCase, EvalTier } from "../types.ts";

const JUDGE_ASSERTION_TYPES = new Set<AssertionConfig["type"]>([
  "llm_judge",
  "task_success",
  "tool_parameter_accuracy",
]);

const DEFAULT_TIER: Record<AssertionConfig["type"], EvalTier> = {
  tool_usage: 1,
  final_status: 1,
  error_recovery: 1,
  llm_judge: 2,
  task_success: 2,
  tool_parameter_accuracy: 2,
  human_review: 3,
};

function resolveAssertionTier(assertion: AssertionConfig): EvalTier {
  return assertion.tier ?? DEFAULT_TIER[assertion.type];
}

export function caseNeedsJudge(
  evalCase: EvalCase,
  options?: { tierMax?: EvalTier },
): boolean {
  const tierMax = options?.tierMax ?? 2;

  if (evalCase.criteria.llm_judge && tierMax >= 2) {
    return true;
  }

  return (
    evalCase.criteria.assertions?.some(
      (assertion) =>
        resolveAssertionTier(assertion) <= tierMax &&
        JUDGE_ASSERTION_TYPES.has(assertion.type),
    ) ?? false
  );
}

export function getMissingJudgeConfig(): string[] {
  const missing: string[] = [];

  if (!resolveJudgeBaseURL()) {
    missing.push(`${ENV_KEYS.JUDGE_BASE_URL}|${ENV_KEYS.OPENAI_BASE_URL}`);
  }

  if (!resolveJudgeApiKey()) {
    missing.push(`${ENV_KEYS.JUDGE_API_KEY}|${ENV_KEYS.OPENAI_API_KEY}`);
  }

  if (!resolveJudgeModel()) {
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

  for (const evalCase of cases) {
    const input = evalCase.type === "plain" ? evalCase.input : undefined;

    if (!resolveRunnerBaseURL(input)) {
      missing.add(ENV_KEYS.OPENAI_BASE_URL);
    }

    if (!resolveRunnerApiKey(input)) {
      missing.add(ENV_KEYS.OPENAI_API_KEY);
    }

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
  for (const key of getMissingJudgeConfig()) {
    missing.add(key);
  }
  return [...missing];
}
