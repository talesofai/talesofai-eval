import { globSync } from "node:fs";
import { ZodError } from "zod3";
import {
  caseNotFound,
  didYouMean,
  invalidJson,
  validationError,
} from "../errors.ts";
import { buildFromFlags } from "../loader/inline.ts";
import { getAllCases, getCase, listCaseIds } from "../loader/registry.ts";
import { parseInlineJson, parseYamlFile } from "../loader/yaml.ts";
import type { EvalCase } from "../types.ts";
import {
  formatZodIssues,
  getStringArrayOption,
  getStringOption,
} from "./helpers.ts";

export function resolveCasesFromArgs(options: Record<string, unknown>): {
  cases: EvalCase[];
  unmatchedFilePatterns: string[];
} {
  const cases: EvalCase[] = [];
  const unmatchedFilePatterns: string[] = [];

  const inlineValue = getStringOption(options, "inline");
  if (inlineValue) {
    try {
      cases.push(parseInlineJson(inlineValue));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw invalidJson("inline", error.message);
      }
      if (error instanceof ZodError) {
        throw validationError("inline", formatZodIssues(error));
      }
      throw error;
    }
  }

  const filePatterns = getStringArrayOption(options, "file");
  if (filePatterns) {
    for (const pattern of filePatterns) {
      const matched = globSync(pattern);
      if (matched.length === 0) {
        unmatchedFilePatterns.push(pattern);
      }
      for (const file of matched) {
        try {
          cases.push(parseYamlFile(file));
        } catch (error) {
          if (error instanceof ZodError) {
            throw validationError(
              "file",
              formatZodIssues(error).map((issue) => `${file}: ${issue}`),
            );
          }
          if (error instanceof Error) {
            throw validationError("file", [`${file}: ${error.message}`]);
          }
          throw error;
        }
      }
    }
  }

  const caseId = getStringOption(options, "case");
  if (caseId) {
    if (caseId === "all") {
      const typeFilter = getStringOption(options, "type");
      const allCases = getAllCases();
      if (typeFilter === "plain" || typeFilter === "agent") {
        cases.push(
          ...allCases.filter((evalCase) => evalCase.type === typeFilter),
        );
      } else {
        cases.push(...allCases);
      }
    } else {
      const evalCase = getCase(caseId);
      if (!evalCase) {
        const available = listCaseIds();
        const suggestions = didYouMean(caseId, available, 3);
        const merged = [...suggestions, ...available].filter(
          (item, index, arr) => arr.indexOf(item) === index,
        );
        throw caseNotFound(caseId, merged);
      }
      cases.push(evalCase);
    }
  }

  const messages = getStringArrayOption(options, "message");
  const systemPrompt = getStringOption(options, "systemPrompt");
  const presetKey = getStringOption(options, "presetKey");

  if (messages || systemPrompt || presetKey) {
    const expectedTools = getStringOption(options, "expectedTools");
    const forbiddenTools = getStringOption(options, "forbiddenTools");
    const allowedToolNames = getStringOption(options, "allowedToolNames");
    const explicitType = getStringOption(options, "type");

    const inlineType =
      explicitType === "agent" || explicitType === "plain"
        ? explicitType
        : presetKey
          ? "agent"
          : "plain";

    try {
      cases.push(
        buildFromFlags({
          type: inlineType,
          systemPrompt,
          model: getStringOption(options, "model"),
          presetKey,
          messages,
          expectedTools: expectedTools ? expectedTools.split(",") : undefined,
          forbiddenTools: forbiddenTools
            ? forbiddenTools.split(",")
            : undefined,
          expectedStatus: getStringOption(options, "expectedStatus"),
          judgePrompt: getStringOption(options, "judgePrompt"),
          judgeThreshold:
            typeof options["judgeThreshold"] === "string"
              ? Number(options["judgeThreshold"])
              : undefined,
          allowedToolNames: allowedToolNames
            ? allowedToolNames.split(",")
            : undefined,
        }),
      );
    } catch (error) {
      if (error instanceof Error) {
        throw validationError("flags", [error.message]);
      }
      throw error;
    }
  }

  return { cases, unmatchedFilePatterns };
}
