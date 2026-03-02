import {
  ENV_KEYS,
  resolveJudgeApiKey,
  resolveJudgeBaseURL,
  resolveJudgeModel,
  resolveRunnerApiKey,
  resolveRunnerBaseURL,
} from "../env.ts";
import type { EvalCase } from "../types.ts";

export function caseNeedsJudge(evalCase: EvalCase): boolean {
  if (evalCase.criteria.llm_judge) {
    return true;
  }
  return (
    evalCase.criteria.assertions?.some(
      (assertion) => assertion.type === "llm_judge",
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
  options?: { replay?: boolean },
): string[] {
  const replay = options?.replay ?? false;

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

    if (caseNeedsJudge(evalCase)) {
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
