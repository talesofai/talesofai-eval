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
  createListDirTool,
  createReadFileTool,
} from "../runner/builtin-tools/index.ts";

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

describe("createReadFileTool", () => {
  it("reads file within an explicit skills root", async () => {
    const rootDir = createSkillsRoot("builtin-read-");
    const skillName = `test-read-file-${Date.now()}`;
    const skillDir = makeSkillDir(rootDir, skillName);
    const readFileTool = createReadFileTool(rootDir);

    try {
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: sample\n---\nread me`,
        "utf8",
      );

      const output = await readFileTool.execute({ path: `${skillName}/SKILL.md` });
      assert.equal(typeof output, "string");
      assert.equal((output as string).includes("read me"), true);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("returns error for missing file", async () => {
    const rootDir = createSkillsRoot("builtin-read-missing-");
    const readFileTool = createReadFileTool(rootDir);

    try {
      const output = await readFileTool.execute({ path: `missing-file-${Date.now()}.txt` });
      assert.equal(typeof output, "string");
      assert.equal((output as string).includes("File not found"), true);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects absolute path", async () => {
    const rootDir = createSkillsRoot("builtin-read-absolute-");
    const readFileTool = createReadFileTool(rootDir);

    try {
      const output = await readFileTool.execute({ path: "/etc/passwd" });
      assert.equal(typeof output, "string");
      assert.equal((output as string).includes("Invalid path"), true);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects path traversal with ..", async () => {
    const rootDir = createSkillsRoot("builtin-read-traversal-");
    const readFileTool = createReadFileTool(rootDir);

    try {
      const output = await readFileTool.execute({ path: "../../../etc/passwd" });
      assert.equal(typeof output, "string");
      assert.equal((output as string).includes("Invalid path"), true);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects symlink escaping explicit skills root", async () => {
    const rootDir = createSkillsRoot("builtin-read-symlink-");
    const skillName = `test-symlink-read-${Date.now()}`;
    const skillDir = makeSkillDir(rootDir, skillName);
    const symlinkPath = join(skillDir, "escape-link");
    const readFileTool = createReadFileTool(rootDir);

    try {
      symlinkSync("/etc", symlinkPath, "dir");

      const output = await readFileTool.execute({ path: `${skillName}/escape-link/passwd` });
      assert.equal(typeof output, "string");
      assert.equal((output as string).includes("path traversal attempt"), true);
    } finally {
      if (existsSync(symlinkPath)) {
        unlinkSync(symlinkPath);
      }
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

describe("createListDirTool", () => {
  it("lists directory within an explicit skills root", async () => {
    const rootDir = createSkillsRoot("builtin-list-");
    const skillName = `test-list-dir-${Date.now()}`;
    const skillDir = makeSkillDir(rootDir, skillName);
    const listDirTool = createListDirTool(rootDir);

    try {
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: sample\n---\nbody`,
        "utf8",
      );

      const output = await listDirTool.execute({ path: skillName });
      assert.equal(typeof output, "string");
      assert.equal((output as string).includes("SKILL.md"), true);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("lists root skills directory when no path provided", async () => {
    const rootDir = createSkillsRoot("builtin-list-root-");
    const skillName = `test-list-root-${Date.now()}`;
    const skillDir = makeSkillDir(rootDir, skillName);
    const listDirTool = createListDirTool(rootDir);

    try {
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: sample\n---\nbody`,
        "utf8",
      );

      const output = await listDirTool.execute({});
      assert.equal(typeof output, "string");
      assert.equal((output as string).includes(`${skillName}/`), true);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("returns error for missing directory", async () => {
    const rootDir = createSkillsRoot("builtin-list-missing-");
    const listDirTool = createListDirTool(rootDir);

    try {
      const output = await listDirTool.execute({ path: `missing-dir-${Date.now()}` });
      assert.equal(typeof output, "string");
      assert.equal((output as string).includes("Directory not found"), true);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects absolute path", async () => {
    const rootDir = createSkillsRoot("builtin-list-absolute-");
    const listDirTool = createListDirTool(rootDir);

    try {
      const output = await listDirTool.execute({ path: "/etc" });
      assert.equal(typeof output, "string");
      assert.equal((output as string).includes("Invalid path"), true);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects path traversal with ..", async () => {
    const rootDir = createSkillsRoot("builtin-list-traversal-");
    const listDirTool = createListDirTool(rootDir);

    try {
      const output = await listDirTool.execute({ path: "../../.." });
      assert.equal(typeof output, "string");
      assert.equal((output as string).includes("Invalid path"), true);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("rejects symlink escaping explicit skills root", async () => {
    const rootDir = createSkillsRoot("builtin-list-symlink-");
    const skillName = `test-symlink-list-${Date.now()}`;
    const skillDir = makeSkillDir(rootDir, skillName);
    const symlinkPath = join(skillDir, "escape-link");
    const listDirTool = createListDirTool(rootDir);

    try {
      symlinkSync("/etc", symlinkPath, "dir");

      const output = await listDirTool.execute({ path: `${skillName}/escape-link` });
      assert.equal(typeof output, "string");
      assert.equal((output as string).includes("path traversal attempt"), true);
    } finally {
      if (existsSync(symlinkPath)) {
        unlinkSync(symlinkPath);
      }
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
