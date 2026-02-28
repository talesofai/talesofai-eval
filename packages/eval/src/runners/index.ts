import type { EvalCase, EvalTrace, RunnerOptions } from "../types.ts";
import { runAgent } from "./agent.ts";
import { runPlain } from "./plain.ts";

export type {
  ManuscriptProxy,
  ManuscriptProxyOptions,
} from "./manuscript-proxy.ts";
export { createManuscriptProxy } from "./manuscript-proxy.ts";

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
