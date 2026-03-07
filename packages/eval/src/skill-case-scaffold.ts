import type { Context } from "@mariozechner/pi-ai";
import { complete } from "./inference/index.ts";
import { loadMetaSkillContent } from "./skills/index.ts";
import { resolveModel } from "./models/index.ts";
import { parseFrontmatter } from "./utils/frontmatter.ts";
import { safeParseJson } from "./utils/safe-parse-json.ts";

// ============================================================================
// T1.1: Workflow Identification Types
// ============================================================================

/**
 * Represents an identified workflow/user scenario from a skill.
 * A workflow is a complete user usage scenario that may contain multiple commands/steps.
 */
export type IdentifiedWorkflow = {
  /** Workflow name in kebab-case, e.g., "character-to-image" */
  name: string;
  /** Brief description of the workflow */
  description: string;
  /** User task description that would trigger this workflow */
  task: string;
  /** Expected tools that should be used in this workflow */
  expected_tools?: string[];
};

export type BuildSkillCaseScaffoldInput = {
  skillName: string;
  mode: "inject" | "discover";
  skillContent: string;
  model?: string;
  explicitSkillsDir?: string;
};

export type SkillCaseScaffold = {
  type: "skill";
  id: string;
  description: string;
  input: {
    skill: string;
    model?: string;
    evaluation_mode: "inject" | "discover";
    task: string;
    skills_dir?: string;
  };
  criteria: {
    assertions: Array<
      | {
          type: "tool_usage";
          tier: 1;
          expected_tools: string[];
        }
      | {
          type: "skill_usage";
          tier: 2;
          checks: Array<
            "skill_loaded" | "workflow_followed" | "skill_influenced_output"
          >;
          pass_threshold: 0.7;
        }
    >;
  };
};

const DEFAULT_MODEL = "deepseek/deepseek-chat";

// ============================================================================
// T1.2: Workflow Identification Function
// ============================================================================

export type IdentifyWorkflowsInput = {
  skillName: string;
  skillContent: string;
  mode: "inject" | "discover";
  model?: string;
};

export type IdentifyWorkflowsResult = {
  workflows: IdentifiedWorkflow[];
  retries: number;
};

/**
 * Identifies all user scenarios/workflows from a skill using LLM analysis.
 * Uses meta-skills (error-analysis, write-judge-prompt) to guide the analysis.
 */
export async function identifyWorkflows(
  input: IdentifyWorkflowsInput,
  opts?: { modelId?: string; maxRetries?: number },
): Promise<IdentifyWorkflowsResult> {
  const maxRetries = opts?.maxRetries ?? 2; // Default: 2 retries (3 total attempts)
  let lastError: string | null = null;
  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt++;
    try {
      const result = await identifyWorkflowsOnce(input, opts, lastError);
      return { workflows: result.workflows, retries: attempt - 1 };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt > maxRetries) {
        throw new Error(
          `Workflow identification failed after ${attempt} attempts: ${lastError}`,
        );
      }
      // Continue to retry with error feedback
    }
  }

  // Should never reach here
  throw new Error("Workflow identification failed unexpectedly");
}

async function identifyWorkflowsOnce(
  input: IdentifyWorkflowsInput,
  opts?: { modelId?: string },
  previousError?: string | null,
): Promise<{ workflows: IdentifiedWorkflow[] }> {
  // Load meta-skills for guidance
  let errorAnalysisSkill: string;
  let writeJudgeSkill: string;
  try {
    errorAnalysisSkill = loadMetaSkillContent("error-analysis");
    writeJudgeSkill = loadMetaSkillContent("write-judge-prompt");
  } catch (error) {
    throw new Error(
      `Failed to load meta-skills: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Build prompts
  const systemPrompt = buildWorkflowIdentificationSystemPrompt({
    errorAnalysisSkill,
    writeJudgeSkill,
  });

  const userPrompt = buildWorkflowIdentificationUserPrompt({
    skillName: input.skillName,
    skillContent: input.skillContent,
    mode: input.mode,
    ...(previousError != null ? { previousError } : {}),
  });

  // Resolve model
  const modelId = opts?.modelId ?? input.model ?? DEFAULT_MODEL;
  const model = resolveModel(modelId);

  // Call LLM
  const context: Context = {
    systemPrompt,
    messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
  };

  const response = await complete(model, context, { temperature: 0.3 });

  // Parse response
  const parsed = parseWorkflowIdentificationResponse(response);
  if (parsed) {
    return parsed;
  }

  throw new Error(
    `Failed to parse LLM response as valid workflow list. Response: ${response.slice(0, 500)}...`,
  );
}

function buildWorkflowIdentificationSystemPrompt(input: {
  errorAnalysisSkill: string;
  writeJudgeSkill: string;
}): string {
  return `You are an expert at analyzing AI skills and identifying user scenarios/workflows.

You have access to these meta-skills (evaluation methods) that guide how to understand skill purposes:

## error-analysis skill
${input.errorAnalysisSkill.slice(0, 2000)}

## write-judge-prompt skill
${input.writeJudgeSkill.slice(0, 2000)}

Your task is to analyze a skill and identify ALL possible user scenarios/workflows.

A workflow is:
- A complete user usage scenario
- May contain multiple commands/steps
- Represents how a user would naturally interact with the skill

Return ONLY a JSON object with this EXACT structure (no markdown code blocks):

{
  "workflows": [
    {
      "name": "workflow-name-in-kebab-case",
      "description": "Brief description of what this workflow accomplishes",
      "task": "A concrete user request that would naturally trigger this workflow",
      "expected_tools": ["tool1", "tool2"]
    }
  ]
}

Requirements:
1. Identify ALL distinct workflows the skill supports
2. Each workflow name must be in kebab-case (lowercase, hyphen-separated)
3. The task should describe what the USER wants, NOT mention the skill name
4. expected_tools should list the main tools/functions this workflow would use
5. Do NOT set limits on the number of workflows - return all that exist
6. Each workflow should be meaningfully different from others`;
}

function buildWorkflowIdentificationUserPrompt(input: {
  skillName: string;
  skillContent: string;
  mode: "inject" | "discover";
  previousError?: string | null;
}): string {
  let prompt = `Analyze this skill and identify all user scenarios/workflows:

## Skill: ${input.skillName}

${input.skillContent.slice(0, 6000)}

Mode: ${input.mode}
- For "discover" mode, the agent must discover and use the skill on its own
- For "inject" mode, the skill is already loaded in context

Identify all distinct workflows this skill supports. Return the JSON object.`;

  // Add error feedback for retry
  if (input.previousError) {
    prompt += `

## Previous Attempt Failed

Your previous response failed with this error:
${input.previousError}

Please fix the issue and return a valid JSON object with the workflow list.`;
  }

  return prompt;
}

export function parseWorkflowIdentificationResponse(
  response: string,
): { workflows: IdentifiedWorkflow[] } | null {
  const parsed = safeParseJson<{ workflows: unknown[] }>(response);
  if (!parsed || !Array.isArray(parsed.workflows)) {
    return null;
  }

  const workflows: IdentifiedWorkflow[] = [];
  for (const item of parsed.workflows) {
    if (
      !item ||
      typeof item !== "object" ||
      !("name" in item) ||
      !("description" in item) ||
      !("task" in item)
    ) {
      continue;
    }

    const workflow = item as Record<string, unknown>;
    const name = String(workflow.name ?? "");
    const description = String(workflow.description ?? "");
    const task = String(workflow.task ?? "");

    // Validate required fields
    if (!name || !description || !task) {
      continue;
    }

    // Validate kebab-case name
    if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
      continue;
    }

    const identified: IdentifiedWorkflow = {
      name,
      description,
      task,
    };

    // Add expected_tools if present
    if (
      "expected_tools" in workflow &&
      Array.isArray(workflow.expected_tools)
    ) {
      identified.expected_tools = workflow.expected_tools.filter(
        (t): t is string => typeof t === "string",
      );
    }

    workflows.push(identified);
  }

  if (workflows.length === 0) {
    return null;
  }

  return { workflows };
}

export function buildSkillCaseScaffold(
  input: BuildSkillCaseScaffoldInput,
): SkillCaseScaffold {
  const { frontmatter, body } = parseFrontmatter(input.skillContent);
  const description =
    typeof frontmatter["description"] === "string"
      ? normalizeText(frontmatter["description"])
      : "";

  const task = buildTaskText({
    skillName: input.skillName,
    description,
    body,
  });

  return {
    type: "skill",
    id: `skill-${input.skillName}-${input.mode}-auto`,
    description: `Auto-generated ${input.mode} skill case for ${input.skillName}`,
    input: {
      skill: input.skillName,
      evaluation_mode: input.mode,
      ...(input.explicitSkillsDir
        ? { skills_dir: input.explicitSkillsDir }
        : {}),
      task,
    },
    criteria: {
      assertions:
        input.mode === "discover"
          ? [
              {
                type: "tool_usage",
                tier: 1,
                expected_tools: ["ls", "read"],
              },
              {
                type: "skill_usage",
                tier: 2,
                checks: [
                  "skill_loaded",
                  "workflow_followed",
                  "skill_influenced_output",
                ],
                pass_threshold: 0.7,
              },
            ]
          : [
              {
                type: "skill_usage",
                tier: 2,
                checks: ["workflow_followed", "skill_influenced_output"],
                pass_threshold: 0.7,
              },
            ],
    },
  };
}

function buildTaskText(input: {
  skillName: string;
  description: string;
  body: string;
}): string {
  const exampleTask = extractExampleTask(input.body);
  if (exampleTask && !mentionsSkillName(exampleTask, input.skillName)) {
    return ensureSentence(exampleTask);
  }

  const descriptionTask = buildTaskFromDescription(input.description);
  if (descriptionTask && !mentionsSkillName(descriptionTask, input.skillName)) {
    return ensureSentence(descriptionTask);
  }

  const headingTask = buildTaskFromHeading(input.body);
  if (headingTask && !mentionsSkillName(headingTask, input.skillName)) {
    return ensureSentence(headingTask);
  }

  return "Produce a concise text artifact that completes the requested workflow.";
}

function extractExampleTask(body: string): string | null {
  const lines = body.split(/\r?\n/);
  const patterns = [
    /^(?:[-*]\s*)?(?:user request|request|task|prompt):\s*(.+)$/i,
    /^(?:[-*]\s*)?example:\s*(.+)$/i,
  ];

  for (const line of lines) {
    const normalizedLine = normalizeText(line);
    if (!normalizedLine) {
      continue;
    }

    for (const pattern of patterns) {
      const match = normalizedLine.match(pattern);
      const candidate = match?.[1] ? normalizeText(match[1]) : "";
      if (candidate) {
        return candidate;
      }
    }
  }

  return null;
}

function buildTaskFromDescription(description: string): string | null {
  if (!description || isWeakSummary(description)) {
    return null;
  }

  if (/judge prompt/i.test(description)) {
    return "Write a concise judge prompt for scoring a short customer support reply with a structured rubric.";
  }

  if (/(analysis|analy[sz]e|review|audit)/i.test(description)) {
    return `Provide a concise ${stripTrailingPeriod(description).toLowerCase()}`;
  }

  return stripTrailingPeriod(description);
}

function buildTaskFromHeading(body: string): string | null {
  const headings = Array.from(body.matchAll(/^#{1,6}\s+(.+)$/gm)).map((match) =>
    normalizeText(match[1] ?? ""),
  );

  const heading = headings.find((value) => value && !isWeakSummary(value));
  if (!heading) {
    return null;
  }

  const normalizedHeading = stripTrailingPeriod(
    heading.replace(/\bchecklist\b/gi, "").replace(/\s{2,}/g, " ").trim(),
  );

  if (!normalizedHeading) {
    return null;
  }

  return `Provide a concise ${normalizedHeading.toLowerCase()}`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripTrailingPeriod(value: string): string {
  return value.replace(/[.\s]+$/g, "").trim();
}

function ensureSentence(value: string): string {
  const trimmed = stripTrailingPeriod(value);
  if (!trimmed) {
    return trimmed;
  }
  return `${trimmed}.`;
}

function isWeakSummary(value: string): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized.length < 8) {
    return true;
  }

  return ["helper", "tool", "utility", "workflow", "guide", "skill"].includes(
    normalized,
  );
}

function mentionsSkillName(value: string, skillName: string): boolean {
  return value.toLowerCase().includes(skillName.toLowerCase());
}

// ============================================================================
// Intelligent Case Generation using Meta-Skills
// ============================================================================

export type GeneratedSkillCase = {
  type: "skill";
  id: string;
  description: string;
  input: {
    skill: string;
    model?: string;
    evaluation_mode: "inject" | "discover";
    task: string;
    skills_dir?: string;
  };
  criteria: {
    assertions: Array<{
      type: string;
      tier: number;
      [key: string]: unknown;
    }>;
  };
};

// ============================================================================
// T1.3: Assertion Auto-Design
// ============================================================================

type AssertionDesign = {
  type: "tool_usage" | "skill_usage" | "llm_judge" | "task_success";
  tier: 1 | 2;
  [key: string]: unknown;
};

/**
 * Designs assertions based on workflow characteristics.
 * - discover mode: includes tool_usage (ls/read) + skill_usage
 * - Adds llm_judge or task_success based on workflow description
 */
function designAssertionsForWorkflow(
  workflow: IdentifiedWorkflow,
  mode: "inject" | "discover",
): AssertionDesign[] {
  const assertions: AssertionDesign[] = [];

  // Tier 1: tool_usage for discover mode
  if (mode === "discover") {
    assertions.push({
      type: "tool_usage",
      tier: 1,
      expected_tools: workflow.expected_tools ?? ["ls", "read"],
    });
  }

  // Tier 2: skill_usage (always included)
  assertions.push({
    type: "skill_usage",
    tier: 2,
    checks:
      mode === "discover"
        ? ["skill_loaded", "workflow_followed", "skill_influenced_output"]
        : ["workflow_followed", "skill_influenced_output"],
    pass_threshold: 0.7,
  });

  // Tier 2: Add llm_judge for quality evaluation
  const llmJudgePrompt = buildLlmJudgePrompt(workflow);
  if (llmJudgePrompt) {
    assertions.push({
      type: "llm_judge",
      tier: 2,
      prompt: llmJudgePrompt,
      pass_threshold: 0.7,
    });
  }

  return assertions;
}

/**
 * Builds an LLM judge prompt based on workflow description.
 * Returns null if workflow is too simple for quality evaluation.
 */
function buildLlmJudgePrompt(workflow: IdentifiedWorkflow): string | null {
  const desc = workflow.description.toLowerCase();

  // Skip judge prompt for simple workflows
  if (desc.length < 20) {
    return null;
  }

  // Build contextual judge prompt
  return `Did the agent successfully complete the "${workflow.name}" workflow? ${workflow.description}`;
}

// ============================================================================
// T1.4: Multi-Case Generation
// ============================================================================

export type GenerateSkillCasesInput = {
  skillName: string;
  skillContent: string;
  mode: "inject" | "discover";
  skillsDir: string;
  explicitSkillsDir?: string;
  model?: string;
};

export type GenerateSkillCasesResult = {
  workflows: IdentifiedWorkflow[];
  cases: GeneratedSkillCase[];
  skipped: Array<{ workflow: string; reason: string }>;
  retries: number;
};

/**
 * Generate multiple skill eval cases from a single skill.
 * Identifies all workflows and generates a case for each.
 */
export async function generateSkillCases(
  input: GenerateSkillCasesInput,
  opts?: { modelId?: string },
): Promise<GenerateSkillCasesResult> {
  // Step 1: Identify workflows
  const workflowResult = await identifyWorkflows(
    {
      skillName: input.skillName,
      skillContent: input.skillContent,
      mode: input.mode,
      ...(input.model !== undefined ? { model: input.model } : {}),
    },
    opts,
  );

  const cases: GeneratedSkillCase[] = [];
  const skipped: Array<{ workflow: string; reason: string }> = [];

  // Step 2: Generate case for each workflow
  for (const workflow of workflowResult.workflows) {
    try {
      const generatedCase = buildCaseFromWorkflow(workflow, input);
      cases.push(generatedCase);
    } catch (error) {
      skipped.push({
        workflow: workflow.name,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    workflows: workflowResult.workflows,
    cases,
    skipped,
    retries: workflowResult.retries,
  };
}

/**
 * Builds a GeneratedSkillCase from an identified workflow.
 */
function buildCaseFromWorkflow(
  workflow: IdentifiedWorkflow,
  input: GenerateSkillCasesInput,
): GeneratedSkillCase {
  const assertions = designAssertionsForWorkflow(workflow, input.mode);

  return {
    type: "skill",
    id: `skill-${input.skillName}-${input.mode}-${workflow.name}`,
    description: workflow.description,
    input: {
      skill: input.skillName,
      evaluation_mode: input.mode,
      task: workflow.task,
      ...(input.explicitSkillsDir
        ? { skills_dir: input.explicitSkillsDir }
        : {}),
    },
    criteria: {
      assertions,
    },
  };
}
