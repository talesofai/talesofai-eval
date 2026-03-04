import type { EvalCase, EvalTrace, RunnerOptions } from "../types.ts";

export interface Runner {
  run(evalCase: EvalCase, options: RunnerOptions): Promise<EvalTrace>;
}
