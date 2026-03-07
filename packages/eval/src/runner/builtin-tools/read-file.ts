import { Type } from "@mariozechner/pi-ai";
import { readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import type { BuiltinTool } from "../minimal-agent/types.ts";

function isValidRelativePath(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("\\")) {
    return false;
  }

  if (path.includes("..")) {
    return false;
  }

  return true;
}

function isWithinRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

export function createReadFileTool(skillsDir: string): BuiltinTool {
  let canonicalSkillsDir: string | null = null;

  const getCanonicalSkillsDir = (): string => {
    if (canonicalSkillsDir === null) {
      canonicalSkillsDir = realpathSync(skillsDir);
    }
    return canonicalSkillsDir;
  };

  return {
    name: "read",
    description: "Read a file from the skills directory by relative path.",
    parameters: Type.Object({
      path: Type.String({
        description: "Relative path to the file within the skills directory",
      }),
    }),
    execute: (args) => {
      const filePath = args["path"];

      if (typeof filePath !== "string" || filePath.trim().length === 0) {
        return 'Error: Missing required argument "path".';
      }

      if (!isValidRelativePath(filePath)) {
        return `Error: Invalid path "${filePath}". Must be a relative path without traversal.`;
      }

      const absolutePath = join(skillsDir, filePath);

      let canonicalPath: string;
      try {
        canonicalPath = realpathSync(absolutePath);
      } catch {
        return `Error: File not found: ${filePath}`;
      }

      const canonicalRoot = getCanonicalSkillsDir();
      if (!isWithinRoot(canonicalPath, canonicalRoot)) {
        return "Error: Invalid path: path traversal attempt detected";
      }

      try {
        return readFileSync(canonicalPath, "utf-8");
      } catch {
        return `Error: Failed to read file "${filePath}".`;
      }
    },
  };
}
