import type { Context } from "@mariozechner/pi-ai";
import { complete } from "./inference/index.ts";
import { loadMetaSkillContent } from "./skills/index.ts";
import type { ModelConfig } from "./models/index.ts";
import { resolveModel } from "./models/index.ts";
import { parseFrontmatter } from "./utils/frontmatter.ts";
import { safeParseJson } from "./utils/safe-parse-json.ts";

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
    model: string;
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
      model: input.model ?? DEFAULT_MODEL,
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

export type GenerateSkillCaseInput = {
  skillName: string;
  skillContent: string;
  mode: "inject" | "discover";
  model?: string;
  skillsDir: string;
  explicitSkillsDir?: string;
};

export type GeneratedSkillCase = {
  id: string;
  description: string;
  input: {
    skill: string;
    model: string;
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

const CASE_GENERATOR_MODEL = "deepseek/deepseek-chat";

/**
 * Generate an intelligent skill eval case using meta-skills.
 * Uses error-analysis and write-judge-prompt to create meaningful test cases.
 * 
 * @throws Error if meta-skills cannot be loaded, model resolution fails, or LLM response is invalid
 */
export async function generateSkillCase(
  input: GenerateSkillCaseInput,
  opts?: { modelId?: string },
): Promise<GeneratedSkillCase> {
  // Load relevant meta-skills
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

  // Build prompt for LLM
  const systemPrompt = buildCaseGeneratorSystemPrompt({
    errorAnalysisSkill,
    writeJudgeSkill,
  });

  const userPrompt = buildCaseGeneratorUserPrompt({
    skillName: input.skillName,
    skillContent: input.skillContent,
    mode: input.mode,
  });

  // Resolve model for generation
  const modelId = opts?.modelId ?? CASE_GENERATOR_MODEL;
  const model = resolveModel(modelId);

  // Call LLM to generate case
  const context: Context = {
    systemPrompt,
    messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
  };

  const response = await complete(model, context, { temperature: 0.3 });

  // Parse and validate response
  const parsed = parseGeneratedCase(response, input);
  if (parsed) {
    return parsed;
  }

  throw new Error(
    `Failed to parse LLM response as valid skill case. Response: ${response.slice(0, 500)}...`,
  );
}

function buildCaseGeneratorSystemPrompt(input: {
  errorAnalysisSkill: string;
  writeJudgeSkill: string;
}): string {
  return `You are an expert at generating evaluation test cases for AI skills.

You have access to these meta-skills (evaluation methods) that guide how to create good test cases:

## error-analysis skill
${input.errorAnalysisSkill.slice(0, 2000)}

## write-judge-prompt skill
${input.writeJudgeSkill.slice(0, 2000)}

Use the patterns from these meta-skills to generate meaningful test cases that:
1. Test realistic user scenarios
2. Include meaningful assertions
3. Are specific to the skill's purpose

Return ONLY a JSON object with this EXACT structure (no markdown code blocks):

{
  "id": "skill-{skillName}-{mode}-generated",
  "description": "Brief description of what this case tests",
  "input": {
    "skill": "{skillName}",
    "model": "deepseek/deepseek-chat",
    "evaluation_mode": "{mode}",
    "task": "A concrete user request that would naturally trigger this skill"
  },
  "criteria": {
    "assertions": [
      {
        "type": "tool_usage",
        "tier": 1,
        "expected_tools": ["ls", "read"]
      },
      {
        "type": "skill_usage",
        "tier": 2,
        "checks": ["skill_loaded", "workflow_followed", "skill_influenced_output"],
        "pass_threshold": 0.7
      },
      {
        "type": "llm_judge",
        "tier": 2,
        "prompt": "Specific criterion to evaluate",
        "pass_threshold": 0.7
      }
    ]
  }
}

Assertion types:
- tool_usage (tier 1): Check if specific tools were called
- skill_usage (tier 2): Check if skill was properly loaded and followed
- llm_judge (tier 2): Evaluate output quality with specific criteria
- task_success (tier 2): Check if user's goal was achieved`;
}

function buildCaseGeneratorUserPrompt(input: {
  skillName: string;
  skillContent: string;
  mode: "inject" | "discover";
}): string {
  return `Generate a ${input.mode} mode evaluation case for this skill:

## Skill: ${input.skillName}

${input.skillContent.slice(0, 4000)}

Requirements:
- The task should describe what the USER wants, not mention the skill name
- For "discover" mode, the agent must discover and use the skill on its own
- For "inject" mode, the skill is already loaded in context
- Include appropriate assertions for the mode`;
}

function parseGeneratedCase(
  response: string,
  input: GenerateSkillCaseInput,
): GeneratedSkillCase | null {
  const parsed = safeParseJson<GeneratedSkillCase>(response);
  if (!parsed) {
    return null;
  }

  // Validate required fields
  if (
    !parsed.id ||
    !parsed.description ||
    !parsed.input?.task ||
    !parsed.criteria?.assertions
  ) {
    return null;
  }

  // Ensure skill name matches
  parsed.input.skill = input.skillName;
  parsed.input.model = input.model ?? DEFAULT_MODEL;
  parsed.input.evaluation_mode = input.mode;

  // Add skills_dir if explicitly provided
  if (input.explicitSkillsDir) {
    parsed.input.skills_dir = input.explicitSkillsDir;
  }

  return parsed;
}
