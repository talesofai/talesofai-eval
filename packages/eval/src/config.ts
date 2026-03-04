import {
  DEFAULT_MCP_SERVER_BASE_URL,
  DEFAULT_UPSTREAM_API_BASE_URL,
} from "./constants.ts";

export const ENV_KEYS = {
  // Runner (shared by plain + agent)
  OPENAI_BASE_URL: "OPENAI_BASE_URL",
  OPENAI_API_KEY: "OPENAI_API_KEY",

  // Default runner model (can be overridden by CLI --model or case.input.model)
  RUNNER_MODEL: "EVAL_RUNNER_MODEL",

  // MCP
  MCP_SERVER_BASE_URL: "EVAL_MCP_SERVER_BASE_URL",
  MCP_X_TOKEN: "EVAL_MCP_X_TOKEN",

  // LLM Judge (falls back to OPENAI_* if not set)
  JUDGE_BASE_URL: "EVAL_JUDGE_BASE_URL",
  JUDGE_API_KEY: "EVAL_JUDGE_API_KEY",
  // Comma-separated model ids from models.json (single model = just one id)
  JUDGE_MODELS: "EVAL_JUDGE_MODELS",
  JUDGE_AGGREGATION: "EVAL_JUDGE_AGGREGATION",

  // Upstream (character provider, uses x-token auth)
  UPSTREAM_BASE_URL: "EVAL_UPSTREAM_API_BASE_URL",
  UPSTREAM_X_TOKEN: "EVAL_UPSTREAM_X_TOKEN",

  // Agent legacy prompt template override
  LEGACY_AGENT_PROMPT_FILE: "EVAL_LEGACY_AGENT_PROMPT_FILE",
} as const;

type RunnerInput = {
  openai_base_url?: string;
  openai_api_key?: string;
};

function readTrimmedValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  return readTrimmedValue(env[key]);
}

export function resolveRunnerBaseURL(
  input?: RunnerInput,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    readTrimmedValue(input?.openai_base_url) ??
    readEnvValue(env, ENV_KEYS.OPENAI_BASE_URL)
  );
}

export function resolveRunnerApiKey(
  input?: RunnerInput,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    readTrimmedValue(input?.openai_api_key) ??
    readEnvValue(env, ENV_KEYS.OPENAI_API_KEY)
  );
}

export function resolveRunnerModel(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readEnvValue(env, ENV_KEYS.RUNNER_MODEL);
}

export function resolveMcpServerBaseURL(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    readEnvValue(env, ENV_KEYS.MCP_SERVER_BASE_URL) ??
    DEFAULT_MCP_SERVER_BASE_URL
  );
}

export function resolveMcpXToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readEnvValue(env, ENV_KEYS.MCP_X_TOKEN);
}

/**
 * Resolve judge base URL with fallback to OPENAI_BASE_URL.
 * This allows users to configure a single endpoint for both runner and judge.
 */
export function resolveJudgeBaseURL(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    readEnvValue(env, ENV_KEYS.JUDGE_BASE_URL) ??
    readEnvValue(env, ENV_KEYS.OPENAI_BASE_URL)
  );
}

/**
 * Resolve judge API key with fallback to OPENAI_API_KEY.
 */
export function resolveJudgeApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    readEnvValue(env, ENV_KEYS.JUDGE_API_KEY) ??
    readEnvValue(env, ENV_KEYS.OPENAI_API_KEY)
  );
}

export function resolveJudgeModels(
  env: NodeJS.ProcessEnv = process.env,
): string[] | undefined {
  const value = readEnvValue(env, ENV_KEYS.JUDGE_MODELS);
  if (!value) {
    return undefined;
  }

  return value
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

export function resolveJudgeAggregation(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return readEnvValue(env, ENV_KEYS.JUDGE_AGGREGATION) ?? "median";
}

export function resolveLegacyAgentPromptFile(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readEnvValue(env, ENV_KEYS.LEGACY_AGENT_PROMPT_FILE);
}

export function resolveUpstreamBaseURL(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    readEnvValue(env, ENV_KEYS.UPSTREAM_BASE_URL) ??
    DEFAULT_UPSTREAM_API_BASE_URL
  );
}

export function resolveUpstreamXToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readEnvValue(env, ENV_KEYS.UPSTREAM_X_TOKEN);
}
