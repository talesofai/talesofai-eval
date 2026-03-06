import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { EvalResult } from "../types.ts";

export type DoctorCheck = {
  key: string;
  requiredFor: string;
  ok: boolean;
  hint: string;
  /**
   * true → missing displays ⚠️ and does NOT affect exit code.
   * false/absent → missing displays ❌ and causes exit 2.
   */
  optional?: boolean;
};

export type DoctorMode = "plain" | "agent" | "all";

export function computeRunExitCode(results: EvalResult[]): number {
  if (results.some((result) => result.error)) {
    return 2;
  }
  if (results.some((result) => !result.passed)) {
    return 1;
  }
  return 0;
}

export function collectDoctorChecks(
  env: NodeJS.ProcessEnv,
  _mode: DoctorMode = "all",
): DoctorCheck[] {
  const isSet = (key: string): boolean => {
    const value = env[key];
    return Boolean(value && value.trim().length > 0);
  };

  const checks: DoctorCheck[] = [
    {
      key: "cli-name",
      requiredFor: "all",
      ok: true,
      hint: "Use `agent-eval ...`; do not use `eval run` (shell builtin).",
    },
    {
      key: "EVAL_MODELS_PATH or ./models.json",
      requiredFor: "run,llm_judge,diff",
      ok:
        isSet("EVAL_MODELS_PATH") ||
        existsSync(resolve(process.cwd(), "models.json")),
      hint: "Create ./models.json with your model registry, or set EVAL_MODELS_PATH=<path>. See README for format.",
    },
    {
      key: "EVAL_JUDGE_MODEL",
      requiredFor: "llm_judge,diff",
      ok: isSet("EVAL_JUDGE_MODEL") || isSet("EVAL_JUDGE_MODELS"),
      hint: "Set EVAL_JUDGE_MODEL (or EVAL_JUDGE_MODELS for multi-model) to a model id defined in your registry.",
    },
    {
      key: "EVAL_MCP_SERVER_BASE_URL",
      requiredFor: "run,diff",
      ok: true,
      hint: "Optional: defaults to https://mcp.talesofai.cn. Override with EVAL_MCP_SERVER_BASE_URL if needed.",
      optional: true,
    },
    {
      key: "EVAL_MCP_X_TOKEN",
      requiredFor: "agent run",
      ok: isSet("EVAL_MCP_X_TOKEN"),
      hint: "Set EVAL_MCP_X_TOKEN if your MCP server requires authentication (required for talesofai-hosted MCP).",
      optional: true,
    },
    {
      key: "EVAL_UPSTREAM_X_TOKEN",
      requiredFor: "agent run",
      ok: isSet("EVAL_UPSTREAM_X_TOKEN"),
      hint: "Set EVAL_UPSTREAM_X_TOKEN for upstream API auth (character/asset provider).",
      optional: true,
    },
    {
      key: "EVAL_SKILLS_DIR",
      requiredFor: "skill run",
      ok: isSet("EVAL_SKILLS_DIR"),
      hint: "Optional: override skill lookup root. By default skill evals will try ~/.agents/skills, then bundled fixtures.",
      optional: true,
    },
  ];

  return checks;
}

export function shouldUseJsonErrors(argv: string[]): boolean {
  const pickCommandFromArgv = (input: string[]): string | null => {
    const args = input.slice(2);
    for (const arg of args) {
      if (arg === "--") {
        break;
      }
      if (arg.startsWith("-")) {
        continue;
      }
      return arg;
    }
    return null;
  };

  const command = pickCommandFromArgv(argv);
  if (
    command !== "run" &&
    command !== "diff" &&
    command !== "pull-online" &&
    command !== "matrix" &&
    command !== "draft-skill-case"
  ) {
    return false;
  }

  const args = argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
    if (arg === "--format") {
      const next = args[index + 1];
      return next === "json";
    }
    if (arg.startsWith("--format=")) {
      return arg.slice("--format=".length) === "json";
    }
  }
  return false;
}
