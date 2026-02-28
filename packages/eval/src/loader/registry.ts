import type { EvalCase } from "../types.ts";
import { evalCaseSchema } from "./yaml.ts";

/**
 * Built-in case registry. Import and re-export cases defined in TypeScript.
 *
 * Note: cases defined in TS bypass the YAML loader, so we validate and
 * normalize them here to ensure runtime sees a consistent shape
 * (notably: legacy criteria fields are transformed into `criteria.assertions`).
 */
const registry = new Map<string, EvalCase>();

export const registerCase = (evalCase: EvalCase): void => {
  const normalized = evalCaseSchema.parse(evalCase) as EvalCase;
  registry.set(normalized.id, normalized);
};

export const getCase = (id: string): EvalCase | undefined => {
  return registry.get(id);
};

export const getAllCases = (): EvalCase[] => {
  return [...registry.values()];
};

export const listCaseIds = (): string[] => {
  return [...registry.keys()];
};
