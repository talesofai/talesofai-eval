import type { EvalCase, EvalTrace, RunnerOptions } from "../types.ts";
import { runAgent } from "./agent.ts";
import { runPlain } from "./plain.ts";

export const runCase = async (
  evalCase: EvalCase,
  options: RunnerOptions,
): Promise<EvalTrace> => {
  switch (evalCase.type) {
    case "plain":
      return runPlain(evalCase, options);
    case "agent":
      return runAgent(evalCase, options);
  }
};
