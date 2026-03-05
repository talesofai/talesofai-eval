import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  SKILLS_DIR,
  clearSkillCache,
  listSkills,
  loadSkillContent,
} from "../skills/index.ts";

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

describe("skills index", () => {
  it("lists valid skills with matching frontmatter name", () => {
    const skillName = `test-skill-${Date.now()}`;
    const skillDir = makeSkillDir(skillName);
    const skillPath = join(skillDir, "SKILL.md");

    try {
      writeFileSync(
        skillPath,
        `---\nname: ${skillName}\ndescription: sample skill\n---\nbody`,
        "utf8",
      );

      clearSkillCache();
      const skills = listSkills();
      const found = skills.find((s) => s.name === skillName);

      assert.ok(found);
      assert.equal(found?.description, "sample skill");
    } finally {
      cleanupSkillDir(skillName);
      clearSkillCache();
    }
  });

  it("warns and skips skill when frontmatter name mismatches directory", () => {
    const skillName = `test-mismatch-${Date.now()}`;
    const skillDir = makeSkillDir(skillName);
    const skillPath = join(skillDir, "SKILL.md");

    const stderrMessages: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrMessages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      writeFileSync(
        skillPath,
        `---\nname: other-name\ndescription: sample\n---\nbody`,
        "utf8",
      );

      clearSkillCache();
      const skills = listSkills();

      assert.equal(skills.some((s) => s.name === skillName), false);
      assert.equal(
        stderrMessages.some((msg) =>
          msg.includes("doesn't match directory name"),
        ),
        true,
      );
    } finally {
      process.stderr.write = originalWrite;
      cleanupSkillDir(skillName);
      clearSkillCache();
    }
  });

  it("loads full skill content", () => {
    const skillName = `test-load-${Date.now()}`;
    const skillDir = makeSkillDir(skillName);
    const skillPath = join(skillDir, "SKILL.md");

    try {
      writeFileSync(
        skillPath,
        `---\nname: ${skillName}\ndescription: sample\n---\nfull content`,
        "utf8",
      );

      const content = loadSkillContent(skillName);
      assert.equal(content.includes("full content"), true);
    } finally {
      cleanupSkillDir(skillName);
      clearSkillCache();
    }
  });

  it("throws when loading missing skill", () => {
    assert.throws(() => loadSkillContent(`missing-skill-${Date.now()}`), {
      message: /Skill not found/,
    });
  });
});
