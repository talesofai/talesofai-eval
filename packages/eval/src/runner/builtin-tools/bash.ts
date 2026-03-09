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
  /** Default per-invocation timeout in milliseconds. Default: 30_000 (30 s).
   *  The agent can override this per-call via the `timeout_seconds` parameter. */
  timeoutMs?: number;
  /** Maximum output length in characters before truncation. Default: 8_000 */
  maxOutputLength?: number;
  /** Working directory for spawned commands. Defaults to the process CWD. */
  cwd?: string;
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
  const cwd = options.cwd;

  return {
    name: "bash",
    description:
      "Execute a shell command and return its combined stdout+stderr output. " +
      "Use this to run the commands described by the skill you have loaded. " +
      "Set timeout_seconds to control how long the command may run (default: 30).",
    parameters: Type.Object({
      command: Type.String({
        description: "Shell command to execute",
      }),
      timeout_seconds: Type.Optional(
        Type.Number({
          description:
            "Maximum seconds to wait for the command to complete. " +
            "Use a larger value for long-running tasks such as image or video generation (e.g. 120). " +
            `Default: ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}.`,
          minimum: 1,
          maximum: 600,
        }),
      ),
    }),
    execute: (args): string => {
      const command = args["command"];

      if (typeof command !== "string" || command.trim().length === 0) {
        return 'Error: Missing required argument "command".';
      }

      if (isDenylisted(command)) {
        return `Error: Command blocked by security denylist: ${command.slice(0, 80)}`;
      }

      // Per-call timeout takes precedence over the tool-level default.
      const callTimeoutMs =
        typeof args["timeout_seconds"] === "number"
          ? args["timeout_seconds"] * 1_000
          : timeoutMs;

      const result = spawnSync("sh", ["-c", command], {
        timeout: callTimeoutMs,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        ...(cwd !== undefined ? { cwd } : {}),
      });

      // spawnSync sets result.error on spawn failure or timeout
      if (result.error) {
        const msg = result.error.message ?? String(result.error);
        if (
          msg.includes("ETIMEDOUT") ||
          result.signal === "SIGTERM" ||
          result.signal === "SIGKILL"
        ) {
          return `Error: Command timed out after ${callTimeoutMs}ms: ${command.slice(0, 80)}`;
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
