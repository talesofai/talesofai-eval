import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import YAML from "yaml";
import { parseYamlFile } from "../loader/yaml.ts";
import * as scaffoldModule from "../skill-case-scaffold.ts";

type BuildSkillCaseScaffold = (input: {
  skillName: string;
  mode: "inject" | "discover";
  skillContent: string;
  model?: string;
  explicitSkillsDir?: string;
}) => Record<string, unknown>;

function getBuilder(): BuildSkillCaseScaffold {
  const builder = Reflect.get(
    scaffoldModule,
    "buildSkillCaseScaffold",
  ) as BuildSkillCaseScaffold | undefined;

  assert.equal(typeof builder, "function");
  if (!builder) {
    throw new Error("buildSkillCaseScaffold not found");
  }
  return builder;
}

describe("buildSkillCaseScaffold", () => {
  it("generates a valid discover scaffold from loaded skill content", () => {
    const buildSkillCaseScaffold = getBuilder();
    const skillContent = `---
name: write-judge-prompt
description: Write concise judge prompts for structured eval rubrics.
---

# Examples
User request: Draft a concise judge prompt for scoring customer support replies.`;

    const result = buildSkillCaseScaffold({
      skillName: "write-judge-prompt",
      mode: "discover",
      skillContent,
    });

    assert.equal(result.type, "skill");
    assert.equal(result.id, "skill-write-judge-prompt-discover-auto");

    const input = result.input as Record<string, unknown>;
    assert.equal(input.skill, "write-judge-prompt");
    assert.equal(input.model, undefined);
    assert.equal(input.evaluation_mode, "discover");
    assert.equal(typeof input.task, "string");
    assert.equal(typeof input.skills_dir, "undefined");

    const assertions = (result.criteria as { assertions: Array<Record<string, unknown>> }).assertions;
    assert.deepEqual(
      assertions.map((assertion) => assertion.type),
      ["tool_usage", "skill_usage"],
    );
    assert.deepEqual(assertions[0], {
      type: "tool_usage",
      tier: 1,
      expected_tools: ["ls", "read"],
    });
    assert.deepEqual(assertions[1], {
      type: "skill_usage",
      tier: 2,
      checks: ["skill_loaded", "workflow_followed", "skill_influenced_output"],
      pass_threshold: 0.7,
    });
  });

  it("generates a valid inject scaffold from loaded skill content", () => {
    const buildSkillCaseScaffold = getBuilder();
    const skillContent = `---
name: write-judge-prompt
description: Write concise judge prompts for structured eval rubrics.
---

# Examples
User request: Draft a concise judge prompt for scoring customer support replies.`;

    const result = buildSkillCaseScaffold({
      skillName: "write-judge-prompt",
      mode: "inject",
      skillContent,
      model: "qwen-plus",
    });

    assert.equal(result.type, "skill");

    const input = result.input as Record<string, unknown>;
    assert.equal(input.skill, "write-judge-prompt");
    assert.equal(input.model, undefined);
    assert.equal(input.evaluation_mode, "inject");

    const assertions = (result.criteria as { assertions: Array<Record<string, unknown>> }).assertions;
    assert.deepEqual(assertions, [
      {
        type: "skill_usage",
        tier: 2,
        checks: ["workflow_followed", "skill_influenced_output"],
        pass_threshold: 0.7,
      },
    ]);
  });

  it("preserves the caller supplied skillsDir only when explicitly provided", () => {
    const buildSkillCaseScaffold = getBuilder();
    const skillContent = `---
name: write-judge-prompt
description: Write concise judge prompts for structured eval rubrics.
---`;

    const withoutExplicitDir = buildSkillCaseScaffold({
      skillName: "write-judge-prompt",
      mode: "discover",
      skillContent,
    });
    const withExplicitDir = buildSkillCaseScaffold({
      skillName: "write-judge-prompt",
      mode: "discover",
      skillContent,
      explicitSkillsDir: "~/.agents/skills",
    });

    assert.equal(
      typeof (withoutExplicitDir.input as Record<string, unknown>).skills_dir,
      "undefined",
    );
    assert.equal(
      (withExplicitDir.input as Record<string, unknown>).skills_dir,
      "~/.agents/skills",
    );
  });

  it("derives task text from frontmatter description when examples are absent", () => {
    const buildSkillCaseScaffold = getBuilder();
    const skillContent = `---
name: write-judge-prompt
description: Write concise judge prompts for structured evaluation rubrics.
---

# Overview
Use a structured rubric and keep the response short.`;

    const result = buildSkillCaseScaffold({
      skillName: "write-judge-prompt",
      mode: "discover",
      skillContent,
    });

    const task = String((result.input as Record<string, unknown>).task);
    assert.match(task, /judge prompt/i);
    assert.match(task, /rubric/i);
  });

  it("falls back to heading based task wording when description is weak or absent", () => {
    const buildSkillCaseScaffold = getBuilder();
    const skillContent = `---
name: api-review
description: helper
---

# API Review Checklist

Review the interface for clarity and missing edge cases.`;

    const result = buildSkillCaseScaffold({
      skillName: "api-review",
      mode: "discover",
      skillContent,
    });

    const task = String((result.input as Record<string, unknown>).task);
    assert.match(task, /api review/i);
  });

  it("does not mention the skill name in the generated task", () => {
    const buildSkillCaseScaffold = getBuilder();
    const skillContent = `---
name: write-judge-prompt
description: Write concise judge prompts for structured evaluation rubrics.
---`;

    const result = buildSkillCaseScaffold({
      skillName: "write-judge-prompt",
      mode: "discover",
      skillContent,
    });

    const task = String((result.input as Record<string, unknown>).task).toLowerCase();
    assert.equal(task.includes("write-judge-prompt"), false);
  });

  it("is deterministic across repeated runs for the same input", () => {
    const buildSkillCaseScaffold = getBuilder();
    const skillContent = `---
name: write-judge-prompt
description: Write concise judge prompts for structured evaluation rubrics.
---

# Examples
User request: Draft a concise judge prompt for scoring customer support replies.`;

    const first = buildSkillCaseScaffold({
      skillName: "write-judge-prompt",
      mode: "discover",
      skillContent,
      explicitSkillsDir: "~/.agents/skills",
    });
    const second = buildSkillCaseScaffold({
      skillName: "write-judge-prompt",
      mode: "discover",
      skillContent,
      explicitSkillsDir: "~/.agents/skills",
    });

    assert.deepEqual(second, first);
  });

  it("round trips generated discover scaffold through yaml loader", () => {
    const buildSkillCaseScaffold = getBuilder();
    const skillContent = `---
name: write-judge-prompt
description: Write concise judge prompts for structured eval rubrics.
---`;
    const generated = buildSkillCaseScaffold({
      skillName: "write-judge-prompt",
      mode: "discover",
      skillContent,
    });
    const tempDir = mkdtempSync(join(tmpdir(), "skill-case-scaffold-"));
    const filePath = join(tempDir, "discover.eval.yaml");

    try {
      writeFileSync(filePath, YAML.stringify(generated), "utf8");
      const parsed = parseYamlFile(filePath);

      assert.equal(parsed.type, "skill");
      if (parsed.type === "skill") {
        assert.equal(parsed.input.evaluation_mode, "discover");
      }
      assert.deepEqual(
        parsed.criteria.assertions?.map((assertion) => assertion.type),
        ["tool_usage", "skill_usage"],
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("round trips generated inject scaffold through yaml loader", () => {
    const buildSkillCaseScaffold = getBuilder();
    const skillContent = `---
name: write-judge-prompt
description: Write concise judge prompts for structured eval rubrics.
---`;
    const generated = buildSkillCaseScaffold({
      skillName: "write-judge-prompt",
      mode: "inject",
      skillContent,
    });
    const tempDir = mkdtempSync(join(tmpdir(), "skill-case-scaffold-"));
    const filePath = join(tempDir, "inject.eval.yaml");

    try {
      writeFileSync(filePath, YAML.stringify(generated), "utf8");
      const parsed = parseYamlFile(filePath);

      assert.equal(parsed.type, "skill");
      if (parsed.type === "skill") {
        assert.equal(parsed.input.evaluation_mode, "inject");
      }
      assert.deepEqual(
        parsed.criteria.assertions?.map((assertion) => assertion.type),
        ["skill_usage"],
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
