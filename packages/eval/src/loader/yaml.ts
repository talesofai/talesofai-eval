import { readFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod3";
import { DEFAULT_AGENT_PRESET_KEY, type EvalCase } from "../types.ts";

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const evalMessageSchema = z.union([
  z.object({
    role: z.literal("user"),
    content: z.union([
      z.string(),
      z.array(
        z.union([
          z.object({ type: z.literal("text"), text: z.string() }),
          z.object({
            type: z.literal("image_url"),
            image_url: z.object({ url: z.string() }),
          }),
          z.object({ type: z.literal("input_text"), text: z.string() }),
          z.object({ type: z.literal("input_image"), image: z.string() }),
        ]),
      ),
    ]),
  }),
  z.object({
    role: z.literal("assistant"),
    reasoning_content: z.string().optional(),
    content: z
      .union([
        z.string(),
        z.array(
          z.union([
            z.object({ type: z.literal("text"), text: z.string() }),
            z.object({ type: z.literal("output_text"), text: z.string() }),
          ]),
        ),
      ])
      .optional(),
    tool_calls: z
      .array(
        z.object({
          index: z.number(),
          id: z.string(),
          type: z.literal("function"),
          function: z.object({
            name: z.string(),
            arguments: z.string(),
          }),
        }),
      )
      .optional(),
  }),
]);

const assertionConfigSchema = z.union([
  z.object({
    type: z.literal("tool_usage"),
    expected_tools: z.array(z.string()).optional(),
    forbidden_tools: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("final_status"),
    expected_status: z.enum(["SUCCESS", "PENDING", "FAILURE"]),
  }),
  z.object({
    type: z.literal("llm_judge"),
    prompt: z.string(),
    pass_threshold: z.number().min(0).max(1),
  }),
]);

/**
 * Raw criteria schema for JSON schema generation and editor autocomplete.
 *
 * Note: the runtime parser uses a .transform() below to normalize legacy
 * fields into `assertions`, so downstream code can consume a clean shape.
 */
const evalCriteriaSchemaRaw = z.object({
  // --- legacy fields (kept for backward compatibility) ---
  expected_tools: z.array(z.string()).optional(),
  forbidden_tools: z.array(z.string()).optional(),
  expected_status: z.enum(["SUCCESS", "PENDING", "FAILURE"]).optional(),
  llm_judge: z
    .object({
      prompt: z.string(),
      pass_threshold: z.number().min(0).max(1),
    })
    .optional(),

  // --- new standard ---
  assertions: z.array(assertionConfigSchema).optional(),
});

/**
 * Runtime criteria schema: normalize legacy fields into `assertions`.
 * The parsed output only contains `{ assertions }`.
 */
const evalCriteriaSchema = evalCriteriaSchemaRaw.transform((data) => {
  const assertions = data.assertions ? [...data.assertions] : [];

  if (data.expected_tools || data.forbidden_tools) {
    assertions.push({
      type: "tool_usage",
      expected_tools: data.expected_tools,
      forbidden_tools: data.forbidden_tools,
    });
  }

  if (data.expected_status) {
    assertions.push({
      type: "final_status",
      expected_status: data.expected_status,
    });
  }

  if (data.llm_judge) {
    assertions.push({
      type: "llm_judge",
      prompt: data.llm_judge.prompt,
      pass_threshold: data.llm_judge.pass_threshold,
    });
  }

  return {
    assertions,
  };
});

const plainCaseSchemaRaw = z.object({
  type: z.literal("plain"),
  id: z.string(),
  description: z.string(),
  input: z.object({
    system_prompt: z.string(),
    model: z.string(),
    openai_base_url: z.string().optional(),
    openai_api_key: z.string().optional(),
    messages: z.array(evalMessageSchema),
    allowed_tool_names: z.array(z.string()).optional(),
  }),
  criteria: evalCriteriaSchemaRaw,
});

const plainCaseSchema = plainCaseSchemaRaw.extend({
  criteria: evalCriteriaSchema,
});

const requiredAgentParameterKeys = [
  "preset_description",
  "reference_planning",
  "reference_content",
  "reference_content_schema",
] as const;

const agentCaseSchemaRaw = z.object({
  type: z.literal("agent"),
  id: z.string(),
  description: z.string(),
  input: z.object({
    preset_key: z.string().default(DEFAULT_AGENT_PRESET_KEY),
    parameters: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .superRefine((parameters, ctx) => {
        for (const key of requiredAgentParameterKeys) {
          if (!(key in parameters)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `missing required parameter: ${key}`,
            });
            continue;
          }

          if (typeof parameters[key] !== "string") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `parameter must be string (empty string allowed): ${key}`,
            });
          }
        }
      }),
    messages: z.array(evalMessageSchema),
    allowed_tool_names: z.array(z.string()).optional(),
    need_approval_tool_names: z.array(z.string()).optional(),
    auto_followup: z
      .object({
        mode: z.literal("adversarial_help_choose"),
        max_turns: z.number().int().positive().optional(),
      })
      .optional(),
  }),
  criteria: evalCriteriaSchemaRaw,
});

const agentCaseSchema = agentCaseSchemaRaw.extend({
  criteria: evalCriteriaSchema,
});

export const evalCaseSchemaRaw = z.union([
  plainCaseSchemaRaw,
  agentCaseSchemaRaw,
]);
export const evalCaseSchema = z.union([plainCaseSchema, agentCaseSchema]);

/**
 * Parse a .eval.yaml file into an EvalCase, with full zod validation.
 */
export const parseYamlFile = (filePath: string): EvalCase => {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = YAML.parse(raw);
  return evalCaseSchema.parse(parsed) as EvalCase;
};

/**
 * Parse inline JSON into an EvalCase, with full zod validation.
 */
export const parseInlineJson = (json: string): EvalCase => {
  const parsed = JSON.parse(json);
  return evalCaseSchema.parse(parsed) as EvalCase;
};
