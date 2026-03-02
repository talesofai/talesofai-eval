import {
  DEFAULT_MCP_SERVER_BASE_URL,
  DEFAULT_UPSTREAM_API_BASE_URL,
} from "./constants.ts";

export const ENV_KEYS = {
  // Runner (shared by plain + agent)
  OPENAI_BASE_URL: "OPENAI_BASE_URL",
  OPENAI_API_KEY: "OPENAI_API_KEY",
  OPENAI_X_TOKEN: "OPENAI_X_TOKEN",

  // MCP
  MCP_SERVER_BASE_URL: "EVAL_MCP_SERVER_BASE_URL",
  MCP_X_TOKEN: "EVAL_MCP_X_TOKEN",

  // LLM Judge
  JUDGE_BASE_URL: "EVAL_JUDGE_BASE_URL",
  JUDGE_API_KEY: "EVAL_JUDGE_API_KEY",
  JUDGE_MODEL: "EVAL_JUDGE_MODEL",

  // Upstream (character provider)
  UPSTREAM_BASE_URL: "EVAL_UPSTREAM_API_BASE_URL",
  UPSTREAM_X_TOKEN: "EVAL_UPSTREAM_X_TOKEN",
} as const;

type RunnerInput = {
  openai_base_url?: string;
  openai_api_key?: string;
};

function readTrimmedValue(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readEnvValue(
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  return readTrimmedValue(env[key]);
}

// Runner — required at startup for any run
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

export function resolveRunnerXToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readEnvValue(env, ENV_KEYS.OPENAI_X_TOKEN);
}

// MCP — optional, has defaults from constants.ts
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

// Judge — required when a case uses llm_judge
export function resolveJudgeBaseURL(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    readEnvValue(env, ENV_KEYS.JUDGE_BASE_URL) ??
    readEnvValue(env, ENV_KEYS.OPENAI_BASE_URL)
  );
}

export function resolveJudgeApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    readEnvValue(env, ENV_KEYS.JUDGE_API_KEY) ??
    readEnvValue(env, ENV_KEYS.OPENAI_API_KEY)
  );
}

export function resolveJudgeModel(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readEnvValue(env, ENV_KEYS.JUDGE_MODEL);
}

// Upstream — optional, has default
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
