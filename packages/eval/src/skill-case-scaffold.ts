import { parseFrontmatter } from "./utils/frontmatter.ts";

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
