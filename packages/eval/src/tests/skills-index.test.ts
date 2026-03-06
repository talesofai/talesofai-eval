import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  BUNDLED_SKILLS_DIR,
  clearSkillCache,
  listSkills,
  listSkillsFromRoot,
  loadSkillContent,
  loadSkillContentFromRoot,
  resolveSkillsRoot,
} from "../skills/index.ts";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function createSkillsRoot(prefix: string): string {
  const root = createTempDir(prefix);
  mkdirSync(root, { recursive: true });
  return root;
}

function makeSkillDir(name: string): string {
  const dir = join(BUNDLED_SKILLS_DIR, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupSkillDir(name: string): void {
  const dir = join(BUNDLED_SKILLS_DIR, name);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("skills root resolution", () => {
  it("prefers cli root over case, env, home, and bundled roots", () => {
    const cliRoot = createSkillsRoot("skills-cli-");
    const caseRoot = createSkillsRoot("skills-case-");
    const envRoot = createSkillsRoot("skills-env-");
    const homeDir = createTempDir("skills-home-");
    mkdirSync(join(homeDir, ".agents", "skills"), { recursive: true });

    try {
      const resolved = resolveSkillsRoot({
        cliSkillsDir: cliRoot,
        caseSkillsDir: caseRoot,
        env: { EVAL_SKILLS_DIR: envRoot },
        homeDir,
      });

      assert.equal(resolved.source, "cli");
      assert.equal(resolved.rootDir, cliRoot);
    } finally {
      rmSync(cliRoot, { recursive: true, force: true });
      rmSync(caseRoot, { recursive: true, force: true });
      rmSync(envRoot, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("uses home root when present", () => {
    const homeDir = createTempDir("skills-home-");
    const homeRoot = join(homeDir, ".agents", "skills");
    mkdirSync(homeRoot, { recursive: true });

    try {
      const resolved = resolveSkillsRoot({ homeDir, env: {} });

      assert.equal(resolved.source, "home");
      assert.equal(resolved.rootDir, homeRoot);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("uses bundled root when no override roots exist", () => {
    const homeDir = createTempDir("skills-home-missing-");

    try {
      const resolved = resolveSkillsRoot({
        env: { EVAL_SKILLS_DIR: "   " },
        homeDir: join(homeDir, "missing-home"),
      });

      assert.equal(resolved.source, "bundled");
      assert.equal(resolved.rootDir, BUNDLED_SKILLS_DIR);
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it("lists skills from an explicit root", () => {
    const root = createSkillsRoot("skills-list-");
    const skillName = `temp-skill-${Date.now()}`;
    const skillDir = join(root, skillName);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: from temp root\n---\nbody`,
      "utf8",
    );

    try {
      const skills = listSkillsFromRoot(root);
      const found = skills.find((skill) => skill.name === skillName);

      assert.ok(found);
      assert.equal(found?.description, "from temp root");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads skill content from an explicit root", () => {
    const root = createSkillsRoot("skills-load-");
    const skillName = `temp-load-${Date.now()}`;
    const skillDir = join(root, skillName);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---\nname: ${skillName}\ndescription: temp\n---\nfull content`,
      "utf8",
    );

    try {
      const content = loadSkillContentFromRoot(root, skillName);
      assert.equal(content.includes("full content"), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

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

  it("warns and skips skill when frontmatter name is missing", () => {
    const skillName = `test-missing-name-${Date.now()}`;
    const skillDir = makeSkillDir(skillName);
    const skillPath = join(skillDir, "SKILL.md");

    const stderrMessages: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrMessages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      writeFileSync(skillPath, `---\ndescription: sample\n---\nbody`, "utf8");

      clearSkillCache();
      const skills = listSkills();

      assert.equal(skills.some((s) => s.name === skillName), false);
      assert.equal(
        stderrMessages.some((msg) => msg.includes("missing frontmatter name")),
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

  it("throws when loading skill with missing frontmatter name", () => {
    const skillName = `test-load-missing-name-${Date.now()}`;
    const skillDir = makeSkillDir(skillName);
    const skillPath = join(skillDir, "SKILL.md");

    try {
      writeFileSync(skillPath, `---\ndescription: sample\n---\nbody`, "utf8");

      assert.throws(() => loadSkillContent(skillName), {
        message: /missing frontmatter name/,
      });
    } finally {
      cleanupSkillDir(skillName);
      clearSkillCache();
    }
  });

  it("throws when loading skill with mismatched frontmatter name", () => {
    const skillName = `test-load-mismatch-${Date.now()}`;
    const skillDir = makeSkillDir(skillName);
    const skillPath = join(skillDir, "SKILL.md");

    try {
      writeFileSync(
        skillPath,
        `---\nname: other-name\ndescription: sample\n---\nbody`,
        "utf8",
      );

      assert.throws(() => loadSkillContent(skillName), {
        message: /doesn't match directory name/,
      });
    } finally {
      cleanupSkillDir(skillName);
      clearSkillCache();
    }
  });

  it("rejects symlink escaping skills directory", () => {
    const skillName = `test-symlink-escape-${Date.now()}`;
    const skillDir = makeSkillDir(skillName);

    try {
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: sample\n---\nbody`,
        "utf8",
      );

      const tempDir = join(BUNDLED_SKILLS_DIR, "..", `temp-escape-${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });
      const escapedSkillPath = join(tempDir, "SKILL.md");
      writeFileSync(
        escapedSkillPath,
        `---\nname: escaped-skill\ndescription: escaped\n---\nescape body`,
        "utf8",
      );

      const linkName = `escape-symlink-${Date.now()}`;
      const linkPath = join(BUNDLED_SKILLS_DIR, linkName);
      symlinkSync(tempDir, linkPath, "dir");

      try {
        assert.throws(() => loadSkillContent(linkName), {
          message: /path traversal attempt/,
        });
      } finally {
        if (existsSync(linkPath)) {
          unlinkSync(linkPath);
        }
        if (existsSync(tempDir)) {
          rmSync(tempDir, { recursive: true, force: true });
        }
      }
    } finally {
      cleanupSkillDir(skillName);
      clearSkillCache();
    }
  });

  it("skips symlinked SKILL.md that escapes skills directory", () => {
    const skillName = `test-list-symlink-${Date.now()}`;
    const skillDir = makeSkillDir(skillName);
    const tempDir = join(
      BUNDLED_SKILLS_DIR,
      "..",
      `temp-list-escape-${Date.now()}`,
    );
    const stderrMessages: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrMessages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      mkdirSync(tempDir, { recursive: true });
      const outsideFile = join(tempDir, "outside.md");
      writeFileSync(
        outsideFile,
        `---\nname: ${skillName}\ndescription: leaked\n---\noutside body`,
        "utf8",
      );
      symlinkSync(outsideFile, join(skillDir, "SKILL.md"), "file");

      clearSkillCache();
      const skills = listSkills();

      assert.equal(skills.some((s) => s.name === skillName), false);
      assert.equal(
        stderrMessages.some((msg) => msg.includes("path traversal attempt")),
        true,
      );
    } finally {
      process.stderr.write = originalWrite;
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
      cleanupSkillDir(skillName);
      clearSkillCache();
    }
  });
});
