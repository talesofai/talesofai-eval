import { readFileSync } from "node:fs";
import { resolveLegacyAgentPromptFile } from "../config.ts";
import type { AgentEvalCase, PlainEvalCase } from "../types.ts";

export type NormalizedAgentCase = Omit<PlainEvalCase, "type"> & {
  type: "agent";
};

export const LEGACY_AGENT_SYSTEM_PROMPT = `Your core task is to use the available information, toolset, and reference materials to execute instructions precisely and help the user generate high-quality fantasy content.

## Reference Summary
{{preset_description}}

## Reference Execution Plan
{{reference_planning}}

## Reference Output Information
{{reference_content}}`;

const LEGACY_REQUIRED_PARAMETER_KEYS = [
  "preset_description",
  "reference_planning",
  "reference_content",
  "reference_content_schema",
] as const;

const resolveLegacyAgentSystemPromptTemplate = (): string => {
  const overrideFile = resolveLegacyAgentPromptFile();
  if (!overrideFile) {
    return LEGACY_AGENT_SYSTEM_PROMPT;
  }

  let template = "";
  try {
    template = readFileSync(overrideFile, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `failed to read legacy prompt template file (${overrideFile}): ${message}`,
    );
  }

  if (template.trim().length === 0) {
    throw new Error(`legacy prompt template file is empty: ${overrideFile}`);
  }

  return template;
};

const renderTemplate = (
  template: string,
  parameters: Record<string, string | number | boolean>,
): string => {
  return template.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (placeholder, key) => {
    const value = parameters[key];
    if (value === undefined) {
      process.stderr.write(
        `[normalizeAgentInput] missing template parameter: ${key}; keeping placeholder ${placeholder}\n`,
      );
      return placeholder;
    }
    return String(value);
  });
};

const renderTemplatedMessages = (
  messages: AgentEvalCase["input"]["messages"],
  parameters: Record<string, string | number | boolean>,
): AgentEvalCase["input"]["messages"] => {
  const cloned = structuredClone(messages);

  for (const message of cloned) {
    if (typeof message.content === "string") {
      message.content = renderTemplate(message.content, parameters);
      continue;
    }

    if (!Array.isArray(message.content)) {
      continue;
    }

    for (const part of message.content) {
      if (
        (part.type === "text" ||
          part.type === "input_text" ||
          part.type === "output_text") &&
        "text" in part &&
        typeof part.text === "string"
      ) {
        part.text = renderTemplate(part.text, parameters);
      }
    }
  }

  return cloned;
};

const validateLegacyParameters = (
  parameters: Record<string, string | number | boolean>,
): void => {
  const missing = LEGACY_REQUIRED_PARAMETER_KEYS.filter(
    (key) => !(key in parameters),
  );
  if (missing.length > 0) {
    throw new Error(
      `agent case parameters missing required keys: ${missing.join(", ")}`,
    );
  }

  const invalidType = LEGACY_REQUIRED_PARAMETER_KEYS.filter(
    (key) => typeof parameters[key] !== "string",
  );
  if (invalidType.length > 0) {
    throw new Error(
      `agent case parameters must be string (empty string allowed): ${invalidType.join(", ")}`,
    );
  }
};

export function normalizeAgentInput(
  evalCase: AgentEvalCase,
): NormalizedAgentCase {
  const { input } = evalCase;
  const parameters = input.parameters;

  const renderedMessages = renderTemplatedMessages(input.messages, parameters);

  if (typeof input.system_prompt === "string") {
    if (input.system_prompt.trim().length === 0) {
      throw new Error(
        "agent case input.system_prompt must be a non-empty string",
      );
    }
    if (!input.model) {
      throw new Error(
        "agent case input.model is required when system_prompt is provided",
      );
    }

    return {
      type: "agent",
      id: evalCase.id,
      description: evalCase.description,
      input: {
        system_prompt: renderTemplate(input.system_prompt, parameters),
        model: input.model,
        messages: renderedMessages,
        ...(input.allowed_tool_names !== undefined
          ? { allowed_tool_names: input.allowed_tool_names }
          : {}),
      },
      criteria: evalCase.criteria,
    };
  }

  validateLegacyParameters(parameters);

  if (!input.model) {
    throw new Error(
      "agent case input.model is required when using parameter-templated system prompt",
    );
  }

  return {
    type: "agent",
    id: evalCase.id,
    description: evalCase.description,
    input: {
      system_prompt: renderTemplate(
        resolveLegacyAgentSystemPromptTemplate(),
        parameters,
      ),
      model: input.model,
      messages: renderedMessages,
      ...(input.allowed_tool_names !== undefined
        ? { allowed_tool_names: input.allowed_tool_names }
        : {}),
    },
    criteria: evalCase.criteria,
  };
}
