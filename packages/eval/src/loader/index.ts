import { globSync } from "node:fs";
import type { EvalCase } from "../types.ts";
import { buildFromFlags } from "./inline.ts";
import { getAllCases, getCase } from "./registry.ts";
import { parseInlineJson, parseYamlFile } from "./yaml.ts";

export { buildFromFlags } from "./inline.ts";
export { getAllCases, getCase, listCaseIds, registerCase } from "./registry.ts";
export { parseInlineJson, parseYamlFile } from "./yaml.ts";

export type ResolveCaseArgs = {
  caseId?: string;
  files?: string[];
  inline?: string;
  typeFilter?: "plain" | "agent" | "skill";
  flags?: Parameters<typeof buildFromFlags>[0];
};

/**
 * Resolve CLI arguments into one or more EvalCase.
 */
export const resolveCases = (args: ResolveCaseArgs): EvalCase[] => {
  const cases: EvalCase[] = [];

  if (args.inline) {
    cases.push(parseInlineJson(args.inline));
  }

  if (args.files && args.files.length > 0) {
    for (const pattern of args.files) {
      const matched = globSync(pattern);
      for (const file of matched) {
        if (typeof file === "string") {
          cases.push(parseYamlFile(file));
        }
      }
    }
  }

  if (args.caseId) {
    if (args.caseId === "all") {
      let all = getAllCases();
      if (args.typeFilter) {
        all = all.filter((c) => c.type === args.typeFilter);
      }
      cases.push(...all);
    } else {
      const c = getCase(args.caseId);
      if (!c) {
        throw new Error(`case not found in registry: ${args.caseId}`);
      }
      cases.push(c);
    }
  }

  if (args.flags && (args.flags.messages?.length ?? 0) > 0) {
    cases.push(buildFromFlags(args.flags));
  }

  return cases;
};
