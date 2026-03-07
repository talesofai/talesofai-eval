import { Type } from "@mariozechner/pi-ai";
import { spawnSync } from "node:child_process";
import type { BuiltinTool } from "../minimal-agent/types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Denylist — command patterns that are always blocked.
// Conservative by default; extend over time.
// ─────────────────────────────────────────────────────────────────────────────
const COMMAND_DENYLIST: RegExp[] = [
  /rm\s+-[a-z]*r[a-z]*f\s+\//, // rm -rf /  (recursive force delete at root)
  /mkfs\b/, // format filesystem
  /dd\s+.*of=\/dev\//, // overwrite block device
  />\s*\/dev\/sda/, // write to raw disk
  /\bshutdown\b/,
  /\breboot\b/,
  /\bhalt\b/,
  /:\(\)\s*\{.*\}\s*;/, // fork bomb
];

function isDenylisted(command: string): boolean {
  return COMMAND_DENYLIST.some((pattern) => pattern.test(command));
}

export type BashToolOptions = {
  /** Per-invocation timeout in milliseconds. Default: 30_000 (30 s) */
  timeoutMs?: number;
  /** Maximum output length in characters before truncation. Default: 8_000 */
  maxOutputLength?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT = 8_000;

/**
 * Creates a `bash` builtin tool that executes shell commands.
 *
 * Safety measures:
 * - Denylist: blocks obviously destructive command patterns.
 * - Timeout: kills commands that run too long (default 30 s).
 * - Output cap: truncates stdout+stderr to `maxOutputLength` chars.
 *
 * Intended for discover-mode skill cases, allowing the agent to execute
 * the CLI commands that a loaded skill describes.
 */
export function createBashTool(options: BashToolOptions = {}): BuiltinTool {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputLength = options.maxOutputLength ?? DEFAULT_MAX_OUTPUT;

  return {
    name: "bash",
    description:
      "Execute a shell command and return its combined stdout+stderr output. " +
      "Use this to run the commands described by the skill you have loaded.",
    parameters: Type.Object({
      command: Type.String({
        description: "Shell command to execute",
      }),
    }),
    execute: (args): string => {
      const command = args["command"];

      if (typeof command !== "string" || command.trim().length === 0) {
        return 'Error: Missing required argument "command".';
      }

      if (isDenylisted(command)) {
        return `Error: Command blocked by security denylist: ${command.slice(0, 80)}`;
      }

      const result = spawnSync("sh", ["-c", command], {
        timeout: timeoutMs,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      // spawnSync sets result.error on spawn failure or timeout
      if (result.error) {
        const msg = result.error.message ?? String(result.error);
        if (
          msg.includes("ETIMEDOUT") ||
          result.signal === "SIGTERM" ||
          result.signal === "SIGKILL"
        ) {
          return `Error: Command timed out after ${timeoutMs}ms: ${command.slice(0, 80)}`;
        }
        return `Error: ${msg}`;
      }

      const combined = [result.stdout ?? "", result.stderr ?? ""]
        .join("")
        .trimEnd();

      if (combined.length > maxOutputLength) {
        return (
          combined.slice(0, maxOutputLength) +
          `\n…(output truncated to ${maxOutputLength} chars)`
        );
      }

      return combined;
    },
  };
}
