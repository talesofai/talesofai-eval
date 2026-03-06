import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildDiscoverSystemPrompt,
  buildInjectSystemPrompt,
  buildUserPrompt,
  runSkill,
} from "../runner/skill.ts";
import type { SkillEvalCase } from "../types.ts";

function createSkillsRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(root, { recursive: true });
  return root;
}

function makeSkillDir(rootDir: string, name: string): string {
  const dir = join(rootDir, name);
  mkdirSync(dir, { recursive: true });
  return dir;
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
    assert.equal(prompt.includes('location="write-judge-prompt"'), true);
    assert.equal(prompt.includes("Use ls to explore the skills directory"), true);
    assert.equal(prompt.includes('read files like "write-judge-prompt/SKILL.md"'), true);
  });

  it("buildUserPrompt appends fixtures json", () => {
    const prompt = buildUserPrompt("do task", { a: 1 });
    assert.equal(prompt.includes("do task"), true);
    assert.equal(prompt.includes('"a": 1'), true);
  });
});

describe("runSkill", () => {
  it("inject mode builds skill case trace with case_type skill", async () => {
    const skillsRoot = createSkillsRoot("skill-runner-inject-");
    const skillName = `test-run-inject-${Date.now()}`;
    const skillDir = makeSkillDir(skillsRoot, skillName);

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
        skillsDir: skillsRoot,
      });

      assert.equal(trace.case_type, "skill");
      assert.equal(trace.status, "error");
      assert.equal(trace.conversation[0]?.role, "system");
      assert.equal(
        (trace.conversation[0]?.content as string).includes("SKILL BODY"),
        true,
      );
    } finally {
      rmSync(skillsRoot, { recursive: true, force: true });
    }
  });

  it("discover mode system prompt contains available skills xml", async () => {
    const skillsRoot = createSkillsRoot("skill-runner-discover-");
    const skillName = `test-run-discover-${Date.now()}`;
    const skillDir = makeSkillDir(skillsRoot, skillName);

    try {
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: sample discover\n---\nbody`,
        "utf8",
      );

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
        skillsDir: skillsRoot,
      });

      assert.equal(trace.case_type, "skill");
      assert.equal(trace.status, "error");
      assert.equal(
        (trace.conversation[0]?.content as string).includes("<available_skills>"),
        true,
      );
    } finally {
      rmSync(skillsRoot, { recursive: true, force: true });
    }
  });

  it("discover mode validates target skill exists in explicit root", async () => {
    const skillsRoot = createSkillsRoot("skill-runner-missing-");

    try {
      const evalCase: SkillEvalCase = {
        type: "skill",
        id: "skill-discover-missing",
        description: "test missing skill",
        input: {
          skill: `missing-skill-${Date.now()}`,
          model: "invalid-model-id",
          evaluation_mode: "discover",
          task: "discover missing skill",
        },
        criteria: {},
      };

      const trace = await runSkill(evalCase, {
        mcpServerBaseURL: "http://fake-mcp",
        skillsDir: skillsRoot,
      });

      assert.equal(trace.case_type, "skill");
      assert.equal(trace.status, "error");
      assert.equal(trace.error?.includes("Target skill not found"), true);
    } finally {
      rmSync(skillsRoot, { recursive: true, force: true });
    }
  });

  it("case skills_dir override is used when cli override is absent", async () => {
    const skillsRoot = createSkillsRoot("skill-runner-case-root-");
    const skillName = `test-run-case-root-${Date.now()}`;
    const skillDir = makeSkillDir(skillsRoot, skillName);

    try {
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: sample\n---\nCASE ROOT BODY`,
        "utf8",
      );

      const evalCase: SkillEvalCase = {
        type: "skill",
        id: "skill-case-root",
        description: "test case root",
        input: {
          skill: skillName,
          model: "invalid-model-id",
          evaluation_mode: "inject",
          task: "inject via case root",
          skills_dir: skillsRoot,
        },
        criteria: {},
      };

      const trace = await runSkill(evalCase, {
        mcpServerBaseURL: "http://fake-mcp",
      });

      assert.equal(trace.status, "error");
      assert.equal(
        (trace.conversation[0]?.content as string).includes("CASE ROOT BODY"),
        true,
      );
    } finally {
      rmSync(skillsRoot, { recursive: true, force: true });
    }
  });

  it("inject mode returns error for missing skill", async () => {
    const skillsRoot = createSkillsRoot("skill-runner-inject-missing-");

    try {
      const evalCase: SkillEvalCase = {
        type: "skill",
        id: "skill-inject-missing",
        description: "test missing skill",
        input: {
          skill: `missing-skill-${Date.now()}`,
          model: "invalid-model-id",
          evaluation_mode: "inject",
          task: "inject missing skill",
        },
        criteria: {},
      };

      const trace = await runSkill(evalCase, {
        mcpServerBaseURL: "http://fake-mcp",
        skillsDir: skillsRoot,
      });

      assert.equal(trace.case_type, "skill");
      assert.equal(trace.status, "error");
      assert.equal(trace.error?.includes("Skill not found"), true);
    } finally {
      rmSync(skillsRoot, { recursive: true, force: true });
    }
  });

  it("returns error for invalid skill name", async () => {
    const evalCase: SkillEvalCase = {
      type: "skill",
      id: "skill-invalid-name",
      description: "test invalid name",
      input: {
        skill: "../../../etc",
        model: "invalid-model-id",
        evaluation_mode: "inject",
        task: "escape",
      },
      criteria: {},
    };

    const trace = await runSkill(evalCase, {
      mcpServerBaseURL: "http://fake-mcp",
    });

    assert.equal(trace.case_type, "skill");
    assert.equal(trace.status, "error");
    assert.equal(trace.error?.includes("Invalid skill name"), true);
  });
});
