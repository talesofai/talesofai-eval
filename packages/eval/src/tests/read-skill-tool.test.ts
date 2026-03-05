import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SKILLS_DIR, clearSkillCache } from "../skills/index.ts";
import { readSkillTool } from "../runner/builtin-tools/read-skill.ts";

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

describe("readSkillTool", () => {
  it("reads skill content", async () => {
    const skillName = `test-read-${Date.now()}`;
    const skillDir = makeSkillDir(skillName);

    try {
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: sample\n---\nread me`,
        "utf8",
      );

      const output = await readSkillTool.execute({ skill_name: skillName });
      assert.equal(typeof output, "string");
      assert.equal((output as string).includes("read me"), true);
    } finally {
      cleanupSkillDir(skillName);
      clearSkillCache();
    }
  });

  it("returns not found error for missing skill", async () => {
    const output = await readSkillTool.execute({
      skill_name: `missing-skill-${Date.now()}`,
    });

    assert.equal(typeof output, "string");
    assert.equal((output as string).includes("Skill not found"), true);
  });

  it("rejects path traversal input", async () => {
    const output = await readSkillTool.execute({ skill_name: "../../../etc" });

    assert.equal(typeof output, "string");
    assert.equal((output as string).includes("Invalid skill name"), true);
  });

  it("rejects invalid name format", async () => {
    const output = await readSkillTool.execute({ skill_name: "Bad_Name" });

    assert.equal(typeof output, "string");
    assert.equal((output as string).includes("Invalid skill name"), true);
  });
});
