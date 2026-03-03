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
  // Multi-judge (comma-separated model names for litellm/unified endpoints)
  JUDGE_MODELS: "EVAL_JUDGE_MODELS",
  JUDGE_AGGREGATION: "EVAL_JUDGE_AGGREGATION",

  // Upstream (character provider)
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

/**
 * Resolve comma-separated list of judge models for multi-model judging.
 * For litellm/unified endpoints: EVAL_JUDGE_MODELS=model1,model2,model3
 * Returns undefined if not configured.
 */
export function resolveJudgeModels(
  env: NodeJS.ProcessEnv = process.env,
): string[] | undefined {
  const value = readEnvValue(env, ENV_KEYS.JUDGE_MODELS);
  if (!value) return undefined;
  return value.split(",").map((m) => m.trim()).filter(Boolean);
}

/**
 * Resolve aggregation method for multi-model judging.
 * Defaults to "median" if not specified.
 */
export function resolveJudgeAggregation(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return readEnvValue(env, ENV_KEYS.JUDGE_AGGREGATION) ?? "median";
}

/**
 * Model configuration for multi-judge.
 * All models share the same endpoint (litellm/unified gateway).
 */
export interface JudgeModelConfig {
  model: string;
  baseURL: string;
  apiKey: string;
}

/**
 * Parse model configurations from env.
 * Simple format: EVAL_JUDGE_MODELS=model1,model2,model3
 * All models use the same baseURL/apiKey from judge config.
 */
export function resolveJudgeModelConfigs(
  env: NodeJS.ProcessEnv = process.env,
): JudgeModelConfig[] | undefined {
  const models = resolveJudgeModels(env);
  if (!models || models.length === 0) return undefined;

  const baseURL = resolveJudgeBaseURL(env);
  const apiKey = resolveJudgeApiKey(env);

  if (!baseURL || !apiKey) {
    return undefined;
  }

  return models.map((model) => ({ model, baseURL, apiKey }));
}

export function resolveLegacyAgentPromptFile(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readEnvValue(env, ENV_KEYS.LEGACY_AGENT_PROMPT_FILE);
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
