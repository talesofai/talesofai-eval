import { Type } from "@mariozechner/pi-ai";
import { readdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import type { BuiltinTool } from "../minimal-agent/types.ts";
import { BUNDLED_SKILLS_DIR } from "../../skills/index.ts";

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

export function createListDirTool(skillsDir: string): BuiltinTool {
  let canonicalSkillsDir: string | null = null;

  const getCanonicalSkillsDir = (): string => {
    if (canonicalSkillsDir === null) {
      canonicalSkillsDir = realpathSync(skillsDir);
    }
    return canonicalSkillsDir;
  };

  return {
    name: "ls",
    description: "List files and directories within the skills directory.",
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({
          description: "Relative path to the directory within skills directory (defaults to root)",
        }),
      ),
    }),
    execute: (args) => {
      const dirPath = args["path"] ?? ".";

      if (typeof dirPath !== "string") {
        return 'Error: Argument "path" must be a string.';
      }

      if (dirPath !== "." && !isValidRelativePath(dirPath)) {
        return `Error: Invalid path "${dirPath}". Must be a relative path without traversal.`;
      }

      const absolutePath = join(skillsDir, dirPath);

      let canonicalPath: string;
      try {
        canonicalPath = realpathSync(absolutePath);
      } catch {
        return `Error: Directory not found: ${dirPath}`;
      }

      const canonicalRoot = getCanonicalSkillsDir();
      if (!isWithinRoot(canonicalPath, canonicalRoot)) {
        return "Error: Invalid path: path traversal attempt detected";
      }

      try {
        const entries = readdirSync(canonicalPath, { withFileTypes: true });
        return entries
          .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
          .sort()
          .join("\n");
      } catch {
        return `Error: Failed to list directory "${dirPath}".`;
      }
    },
  };
}

export const listDirTool = createListDirTool(BUNDLED_SKILLS_DIR);
