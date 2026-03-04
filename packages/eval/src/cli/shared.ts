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
      key: "OPENAI_BASE_URL",
      requiredFor: "run,diff",
      ok: isSet("OPENAI_BASE_URL"),
      hint: "Set OPENAI_BASE_URL, e.g. https://dashscope.aliyuncs.com/compatible-mode/v1.",
    },
    {
      key: "OPENAI_API_KEY",
      requiredFor: "run,diff",
      ok: isSet("OPENAI_API_KEY"),
      hint: "Set OPENAI_API_KEY before running eval.",
    },
    {
      key: "EVAL_JUDGE_MODELS",
      requiredFor: "llm_judge,diff",
      ok: isSet("EVAL_JUDGE_MODELS"),
      hint: "Set EVAL_JUDGE_MODELS (comma-separated model ids from models.json).",
    },
    {
      key: "EVAL_MCP_SERVER_BASE_URL",
      requiredFor: "run,diff",
      ok: true,
      hint: "Optional: defaults to https://mcp.talesofai.cn. Override with EVAL_MCP_SERVER_BASE_URL if needed.",
      optional: true,
    },
  ];

  return checks;
}

export function shouldUseJsonErrors(argv: string[]): boolean {
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
