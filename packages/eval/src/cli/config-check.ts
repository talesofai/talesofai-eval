import type { EvalCase } from "../types.ts";

function hasEnvValue(key: string): boolean {
  const value = process.env[key];
  return Boolean(value && value.trim().length > 0);
}

function isMissingEnvValue(key: string): boolean {
  return !hasEnvValue(key);
}

function hasEnvPair(first: string, second: string): boolean {
  return hasEnvValue(first) && hasEnvValue(second);
}

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
  const judgeBase =
    process.env["EVAL_JUDGE_BASE_URL"] ?? process.env["OPENAI_BASE_URL"];
  const judgeApiKey =
    process.env["EVAL_JUDGE_API_KEY"] ?? process.env["OPENAI_API_KEY"];

  if (!judgeBase || judgeBase.trim().length === 0) {
    missing.push("EVAL_JUDGE_BASE_URL|OPENAI_BASE_URL");
  }

  if (!judgeApiKey || judgeApiKey.trim().length === 0) {
    missing.push("EVAL_JUDGE_API_KEY|OPENAI_API_KEY");
  }

  if (isMissingEnvValue("EVAL_JUDGE_MODEL")) {
    missing.push("EVAL_JUDGE_MODEL");
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

  const required = new Set<string>();

  const hasAgentCase = cases.some((evalCase) => evalCase.type === "agent");
  const hasPlainCase = cases.some((evalCase) => evalCase.type === "plain");

  if (hasAgentCase) {
    required.add("OPENAI_BASE_URL");
    required.add("OPENAI_API_KEY");
  }

  if (hasPlainCase) {
    const hasPlainOpenaiPair = hasEnvPair("OPENAI_BASE_URL", "OPENAI_API_KEY");
    const hasEvalPlainPair = hasEnvPair(
      "EVAL_PLAIN_BASE_URL",
      "EVAL_PLAIN_API_KEY",
    );

    if (!hasPlainOpenaiPair && !hasEvalPlainPair) {
      required.add(
        "EVAL_PLAIN_BASE_URL+EVAL_PLAIN_API_KEY|OPENAI_BASE_URL+OPENAI_API_KEY",
      );
    }
  }

  if (cases.some(caseNeedsJudge)) {
    for (const key of getMissingJudgeConfig()) {
      required.add(key);
    }
  }

  return [...required].filter((key) => {
    if (key.includes("+") || key.includes("|")) {
      return true;
    }
    return isMissingEnvValue(key);
  });
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
