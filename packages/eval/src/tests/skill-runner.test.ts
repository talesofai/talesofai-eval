import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SKILLS_DIR, clearSkillCache } from "../skills/index.ts";
import {
  buildDiscoverSystemPrompt,
  buildInjectSystemPrompt,
  buildUserPrompt,
  runSkill,
} from "../runner/skill.ts";
import type { SkillEvalCase } from "../types.ts";

function makeSkillDir(name: string): string {
  const dir = join(SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupSkillDir(name: string): void {
  const dir = join(SKILLS_DIR, name);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("skill runner helpers", () => {
  it("buildInjectSystemPrompt includes skill content", () => {
    const prompt = buildInjectSystemPrompt("SKILL CONTENT", "PREFIX");
    assert.equal(prompt.includes("PREFIX"), true);
    assert.equal(prompt.includes("SKILL CONTENT"), true);
  });

  it("buildDiscoverSystemPrompt includes only skill list metadata", () => {
    const prompt = buildDiscoverSystemPrompt([
      {
        name: "write-judge-prompt",
        description: "desc",
        filePath: "/tmp/SKILL.md",
        baseDir: "/tmp",
      },
    ]);

    assert.equal(prompt.includes("<available_skills>"), true);
    assert.equal(prompt.includes("location=\"write-judge-prompt\""), true);
    assert.equal(prompt.includes("read_skill"), true);
  });

  it("buildUserPrompt appends fixtures json", () => {
    const prompt = buildUserPrompt("do task", { a: 1 });
    assert.equal(prompt.includes("do task"), true);
    assert.equal(prompt.includes('"a": 1'), true);
  });
});

describe("runSkill", () => {
  it("inject mode builds skill case trace with case_type skill", async () => {
    const skillName = `test-run-inject-${Date.now()}`;
    const skillDir = makeSkillDir(skillName);

    try {
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: sample\n---\nSKILL BODY`,
        "utf8",
      );

      const evalCase: SkillEvalCase = {
        type: "skill",
        id: "skill-inject-case",
        description: "test",
        input: {
          skill: skillName,
          model: "invalid-model-id",
          evaluation_mode: "inject",
          task: "do something",
        },
        criteria: {},
      };

      const trace = await runSkill(evalCase, {
        mcpServerBaseURL: "http://fake-mcp",
      });

      assert.equal(trace.case_type, "skill");
      assert.equal(trace.status, "error");
      assert.equal(trace.conversation[0]?.role, "system");
      assert.equal(
        (trace.conversation[0]?.content as string).includes("SKILL BODY"),
        true,
      );
    } finally {
      cleanupSkillDir(skillName);
      clearSkillCache();
    }
  });

  it("discover mode system prompt contains available skills xml", async () => {
    const skillName = `test-run-discover-${Date.now()}`;
    const skillDir = makeSkillDir(skillName);

    try {
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: sample discover\n---\nbody`,
        "utf8",
      );
      clearSkillCache();

      const evalCase: SkillEvalCase = {
        type: "skill",
        id: "skill-discover-case",
        description: "test",
        input: {
          skill: skillName,
          model: "invalid-model-id",
          evaluation_mode: "discover",
          task: "discover skill",
        },
        criteria: {},
      };

      const trace = await runSkill(evalCase, {
        mcpServerBaseURL: "http://fake-mcp",
      });

      assert.equal(trace.case_type, "skill");
      assert.equal(trace.status, "error");
      assert.equal(
        (trace.conversation[0]?.content as string).includes("<available_skills>"),
        true,
      );
    } finally {
      cleanupSkillDir(skillName);
      clearSkillCache();
    }
  });
});
