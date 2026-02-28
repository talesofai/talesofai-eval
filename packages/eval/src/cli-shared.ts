import type { EvalResult } from "./types.ts";

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
  mode: DoctorMode = "all",
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
      key: "OPENAI_BASE_URL",
      requiredFor: "run,diff",
      ok: isSet("OPENAI_BASE_URL"),
      hint: "Set OPENAI_BASE_URL, e.g. https://dashscope.aliyuncs.com/compatible-mode/v1. If your gateway enforces preset_key for plain cases, set EVAL_PLAIN_BASE_URL to a direct LLM endpoint.",
    },
    {
      key: "OPENAI_API_KEY",
      requiredFor: "run,diff",
      ok: isSet("OPENAI_API_KEY"),
      hint: "Set OPENAI_API_KEY before running eval.",
    },
    {
      key: "EVAL_MCP_SERVER_BASE_URL",
      requiredFor: "run,diff",
      ok: isSet("EVAL_MCP_SERVER_BASE_URL"),
      hint: "Set EVAL_MCP_SERVER_BASE_URL, e.g. http://127.0.0.1:13013",
    },
  ];

  // EVAL_UPSTREAM_API_BASE_URL: required for agent mode; optional warning in
  // all mode (plain-only users don't need it); hidden in plain mode.
  if (mode !== "plain") {
    checks.push({
      key: "EVAL_UPSTREAM_API_BASE_URL",
      requiredFor: "agent run/diff",
      ok: isSet("EVAL_UPSTREAM_API_BASE_URL"),
      hint: "Agent cases require EVAL_UPSTREAM_API_BASE_URL for manuscript proxy upstream.",
      optional: mode === "all",
    });
  }

  // EVAL_PLAIN_BASE_URL: always optional, informational for plain users;
  // hidden in agent mode.
  if (mode !== "agent") {
    checks.push({
      key: "EVAL_PLAIN_BASE_URL",
      requiredFor: "plain run",
      ok: isSet("EVAL_PLAIN_BASE_URL"),
      hint: "Optional: set to a direct LLM endpoint if OPENAI_BASE_URL points to a gateway that enforces preset_key. Falls back to OPENAI_BASE_URL when unset.",
      optional: true,
    });
  }

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
    command !== "matrix"
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
