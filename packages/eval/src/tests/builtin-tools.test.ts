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
  createBashTool,
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

// ── Bash tool tests ───────────────────────────────────────────────────────────

describe("createBashTool", () => {
  it("executes a simple command and returns stdout", async () => {
    const tool = createBashTool();
    const output = await tool.execute({ command: "echo hello" });
    assert.ok(typeof output === "string");
    assert.ok((output as string).includes("hello"));
  });

  it("returns output on command failure (non-zero exit)", async () => {
    const tool = createBashTool();
    const output = await tool.execute({ command: "ls /nonexistent_path_xyz_12345" });
    assert.ok(typeof output === "string");
    assert.ok((output as string).length > 0, "expected non-empty output on failure");
  });

  it("returns error string when command argument is missing", async () => {
    const tool = createBashTool();
    const output = await tool.execute({});
    assert.ok(typeof output === "string");
    assert.ok((output as string).startsWith("Error:"));
  });

  it("blocks a denylisted command", async () => {
    const tool = createBashTool();
    // rm -rf / is on the denylist
    const output = await tool.execute({ command: "rm -rf /" });
    assert.ok(typeof output === "string");
    assert.ok((output as string).startsWith("Error:"));
    assert.ok(
      (output as string).toLowerCase().includes("block") ||
        (output as string).toLowerCase().includes("denylist"),
    );
  });

  it("respects timeout and returns an error for hanging commands", async () => {
    const tool = createBashTool({ timeoutMs: 300 });
    const start = Date.now();
    const output = await tool.execute({ command: "sleep 10" });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5000, `should have timed out well under 5 s, got ${elapsed}ms`);
    assert.ok(typeof output === "string");
    assert.ok(
      (output as string).toLowerCase().includes("timeout") ||
        (output as string).startsWith("Error:"),
    );
  });

  it("caps output at maxOutputLength", async () => {
    const tool = createBashTool({ maxOutputLength: 50 });
    // printf repeats a pattern to generate >50 chars
    const output = await tool.execute({
      command: "printf '%0100d' 0",
    });
    assert.ok(typeof output === "string");
    // capped output + truncation notice should be <= 50 + notice overhead
    assert.ok((output as string).length <= 150, "output should be capped");
    assert.ok((output as string).includes("truncated"));
  });
});
