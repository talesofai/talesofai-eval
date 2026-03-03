import type { AgentEvalCase, EvalMessage, EvalTrace } from "../types.ts";

export const ADVERSARIAL_HELP_CHOOSE_MESSAGE = "你帮我选两个角色，直接继续。";

const ROLE_WORD_PATTERN = /角色/u;
const INPUT_ACTION_PATTERN = /(选|选择|给|提供|告诉)/u;
const REQUEST_TONE_PATTERN = /(请|先|麻烦|快|吧|好吗|一下|呢|？|\?)/u;

function hasMeaningfulText(text: string | null): text is string {
  return Boolean(text && text.trim().length > 0);
}

function countTrue(values: boolean[]): number {
  let total = 0;
  for (const value of values) {
    if (value) {
      total += 1;
    }
  }
  return total;
}

export function buildAdversarialHelpChooseMessage(): EvalMessage {
  return {
    role: "user",
    content: ADVERSARIAL_HELP_CHOOSE_MESSAGE,
  };
}

export function shouldInjectAdversarialHelpChooseFollowup(options: {
  evalCase: AgentEvalCase;
  followupTurnsUsed: number;
  turnStatus: EvalTrace["status"];
  turnFinalResponse: string | null;
  turnToolCalls: number;
}): boolean {
  const config = options.evalCase.input.auto_followup;
  if (!config || config.mode !== "adversarial_help_choose") {
    return false;
  }

  const maxTurns = config.max_turns ?? 1;
  if (options.followupTurnsUsed >= maxTurns) {
    return false;
  }

  if (options.turnStatus !== "success") {
    return false;
  }

  if (options.turnToolCalls > 0) {
    return false;
  }

  if (!hasMeaningfulText(options.turnFinalResponse)) {
    return false;
  }

  const response = options.turnFinalResponse;
  const hasRoleWord = ROLE_WORD_PATTERN.test(response);
  const hasInputAction = INPUT_ACTION_PATTERN.test(response);
  const hasRequestTone = REQUEST_TONE_PATTERN.test(response);

  if (!hasRoleWord) {
    return false;
  }

  const signalCount = countTrue([hasRoleWord, hasInputAction, hasRequestTone]);
  return signalCount >= 2;
}
