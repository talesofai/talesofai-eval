import { readFileSync } from "node:fs";
import YAML from "yaml";
import { z } from "zod3";
import {
  DEFAULT_AGENT_PRESET_KEY,
  type AssertionConfig,
  type EvalCase,
  type EvalCriteria,
} from "../types.ts";
import { normalizeAssertions } from "../utils/normalize-assertions.ts";

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

const skillUsageChecksSchema = z
  .array(
    z.enum([
      "skill_loaded",
      "workflow_followed",
      "skill_influenced_output",
    ]),
  )
  .nonempty()
  .refine((checks) => new Set(checks).size === checks.length, {
    message: "skill_usage checks must not contain duplicates",
  });

const assertionConfigSchema = z.union([
  z.object({
    type: z.literal("tool_usage"),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    expected_tools: z.array(z.string()).optional(),
    forbidden_tools: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal("final_status"),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    expected_status: z.enum(["SUCCESS", "PENDING", "FAILURE"]),
  }),
  z.object({
    type: z.literal("llm_judge"),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    prompt: z.string(),
    pass_threshold: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("task_success"),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    user_goal: z.string().optional(),
    pass_threshold: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("tool_parameter_accuracy"),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    tool_name: z.string(),
    expected_description: z.string(),
    pass_threshold: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("error_recovery"),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    tool_name: z.string().optional(),
    pass_threshold: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("skill_usage"),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    checks: skillUsageChecksSchema.optional(),
    pass_threshold: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("bash_execution"),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    pass_threshold: z.number().min(0).max(1).optional(),
    expected_goal: z.string().optional(),
  }),
  z.object({
    type: z.literal("human_review"),
    tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    reason: z.string().optional(),
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
 * Uses shared normalizeAssertions for consistent behavior.
 * The parsed output only contains `{ assertions }`.
 */
const evalCriteriaSchema = evalCriteriaSchemaRaw.transform((data) => {
  const assertions = normalizeAssertions(
    data as EvalCriteria,
  ) as AssertionConfig[];
  return { assertions };
});

const plainCaseSchemaRaw = z.object({
  type: z.literal("plain"),
  id: z.string(),
  description: z.string(),
  input: z.object({
    system_prompt: z.string(),
    model: z.string(),
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

const agentInputSchema = z
  .object({
    preset_key: z.string().default(DEFAULT_AGENT_PRESET_KEY),
    system_prompt: z.string().optional(),
    model: z.string().optional(),
    parameters: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    ),
    messages: z.array(evalMessageSchema),
    allowed_tool_names: z.array(z.string()).optional(),
    need_approval_tool_names: z.array(z.string()).optional(),
    auto_followup: z
      .object({
        mode: z.literal("adversarial_help_choose"),
        max_turns: z.number().int().positive().optional(),
      })
      .optional(),
  })
  .superRefine((input, ctx) => {
    if (typeof input.system_prompt === "string") {
      if (input.system_prompt.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "system_prompt must be a non-empty string",
          path: ["system_prompt"],
        });
      }
      if (!input.model) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "model is required when system_prompt is provided",
          path: ["model"],
        });
      }
      return;
    }

    for (const key of requiredAgentParameterKeys) {
      if (!(key in input.parameters)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `missing required parameter: ${key}`,
          path: ["parameters", key],
        });
        continue;
      }

      if (typeof input.parameters[key] !== "string") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `parameter must be string (empty string allowed): ${key}`,
          path: ["parameters", key],
        });
      }
    }
  });

const agentCaseSchemaRaw = z.object({
  type: z.literal("agent"),
  id: z.string(),
  description: z.string(),
  input: agentInputSchema,
  criteria: evalCriteriaSchemaRaw,
});

const agentCaseSchema = agentCaseSchemaRaw.extend({
  criteria: evalCriteriaSchema,
});

const skillCaseSchemaRaw = z.object({
  type: z.literal("skill"),
  id: z.string(),
  description: z.string(),
  input: z.object({
    skill: z.string(),
    model: z.string().optional(),
    task: z.string(),
    skills_dir: z.string().optional(),
    fixtures: z.record(z.string(), z.unknown()).optional(),
    system_prompt_prefix: z.string().optional(),
    allowed_tool_names: z.array(z.string()).optional(),
    evaluation_mode: z.enum(["inject", "discover"]).optional(),
  }),
  criteria: evalCriteriaSchemaRaw,
});

const skillCaseSchema = skillCaseSchemaRaw.extend({
  criteria: evalCriteriaSchema,
});

export const evalCaseSchemaRaw = z.union([
  plainCaseSchemaRaw,
  agentCaseSchemaRaw,
  skillCaseSchemaRaw,
]);
export const evalCaseSchema = z.union([plainCaseSchema, agentCaseSchema, skillCaseSchema]);

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
