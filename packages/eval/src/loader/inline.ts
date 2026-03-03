import { resolveRunnerBaseURL } from "../config.ts";
import {
  DEFAULT_AGENT_PRESET_KEY,
  type EvalCase,
  type EvalCriteria,
  type EvalMessage,
} from "../types.ts";

const requiredAgentParameterKeys = [
  "preset_description",
  "reference_planning",
  "reference_content",
  "reference_content_schema",
] as const;

/**
 * Build an EvalCase from CLI inline flags.
 */
export const buildFromFlags = (flags: {
  type?: string;
  id?: string;
  systemPrompt?: string;
  model?: string;
  openaiBaseUrl?: string;
  presetKey?: string;
  parameters?: Record<string, string | number | boolean>;
  messages?: string[];
  expectedTools?: string[];
  forbiddenTools?: string[];
  expectedStatus?: string;
  judgePrompt?: string;
  judgeThreshold?: number;
  allowedToolNames?: string[];
}): EvalCase => {
  const id = flags.id ?? `tmp-${Date.now()}`;
  const messages = parseMessages(flags.messages ?? []);

  const assertions: NonNullable<EvalCriteria["assertions"]> = [];

  if (
    (flags.expectedTools && flags.expectedTools.length > 0) ||
    (flags.forbiddenTools && flags.forbiddenTools.length > 0)
  ) {
    assertions.push({
      type: "tool_usage",
      expected_tools: flags.expectedTools,
      forbidden_tools: flags.forbiddenTools,
    });
  }

  if (flags.expectedStatus) {
    assertions.push({
      type: "final_status",
      expected_status: flags.expectedStatus as
        | "SUCCESS"
        | "PENDING"
        | "FAILURE",
    });
  }

  if (flags.judgePrompt) {
    assertions.push({
      type: "llm_judge",
      prompt: flags.judgePrompt,
      pass_threshold: flags.judgeThreshold ?? 0.7,
    });
  }

  const criteria: EvalCriteria = { assertions };

  if (flags.type === "agent") {
    const parameters = flags.parameters ?? {};

    if (typeof flags.systemPrompt === "string") {
      if (!flags.model) {
        throw new Error(
          "agent case model is required when system prompt is set",
        );
      }

      return {
        type: "agent",
        id,
        description: `inline agent case ${id}`,
        input: {
          preset_key: flags.presetKey ?? DEFAULT_AGENT_PRESET_KEY,
          system_prompt: flags.systemPrompt,
          model: flags.model,
          parameters,
          messages,
          allowed_tool_names: flags.allowedToolNames,
        },
        criteria,
      };
    }

    const missing = requiredAgentParameterKeys.filter(
      (key) => !(key in parameters),
    );
    if (missing.length > 0) {
      throw new Error(
        `agent case parameters missing required keys: ${missing.join(", ")}`,
      );
    }

    const invalidType = requiredAgentParameterKeys.filter(
      (key) => typeof parameters[key] !== "string",
    );
    if (invalidType.length > 0) {
      throw new Error(
        `agent case parameters must be string (empty string allowed): ${invalidType.join(", ")}`,
      );
    }

    return {
      type: "agent",
      id,
      description: `inline agent case ${id}`,
      input: {
        preset_key: flags.presetKey ?? DEFAULT_AGENT_PRESET_KEY,
        parameters,
        messages,
        allowed_tool_names: flags.allowedToolNames,
      },
      criteria,
    };
  }

  // Default: plain
  return {
    type: "plain",
    id,
    description: `inline plain case ${id}`,
    input: {
      system_prompt: flags.systemPrompt ?? "",
      model: flags.model ?? "qwen-plus",
      openai_base_url: flags.openaiBaseUrl ?? resolveRunnerBaseURL() ?? "",
      messages,
      allowed_tool_names: flags.allowedToolNames,
    },
    criteria,
  };
};

/**
 * Parse --message "role:content" format.
 * Role defaults to "user" if omitted.
 */
function parseMessages(raw: string[]): EvalMessage[] {
  return raw.map((m) => {
    const colonIdx = m.indexOf(":");
    if (colonIdx === -1) {
      return { role: "user" as const, content: m };
    }

    const prefix = m.slice(0, colonIdx);
    const content = m.slice(colonIdx + 1);

    if (prefix === "user" || prefix === "assistant") {
      if (prefix === "assistant") {
        return { role: "assistant" as const, content };
      }
      return { role: "user" as const, content };
    }

    // No valid role prefix → entire string is content for user
    return { role: "user" as const, content: m };
  });
}
