import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveJudgeAggregation,
  resolveJudgeModels,
  resolveLegacyAgentPromptFile,
  resolveMcpServerBaseURL,
  resolveMcpXToken,
  resolveRunnerApiKey,
  resolveRunnerBaseURL,
  resolveUpstreamBaseURL,
  resolveUpstreamXToken,
} from "../config.ts";
import {
  DEFAULT_MCP_SERVER_BASE_URL,
  DEFAULT_UPSTREAM_API_BASE_URL,
} from "../constants.ts";

describe("config resolvers", () => {
  it("resolveRunnerBaseURL: case-level override wins", () => {
    const env = {
      OPENAI_BASE_URL: "https://openai-base.example/v1",
    };

    const value = resolveRunnerBaseURL(
      { openai_base_url: "https://case-base.example/v1" },
      env,
    );

    assert.equal(value, "https://case-base.example/v1");
  });

  it("resolveRunnerBaseURL: falls back to OPENAI_BASE_URL", () => {
    const env = {
      OPENAI_BASE_URL: "https://openai-base.example/v1",
    };

    const value = resolveRunnerBaseURL(undefined, env);
    assert.equal(value, "https://openai-base.example/v1");
  });

  it("resolveRunnerBaseURL: returns undefined when missing", () => {
    const value = resolveRunnerBaseURL(undefined, {});
    assert.equal(value, undefined);
  });

  it("resolveRunnerApiKey: case-level override wins", () => {
    const env = {
      OPENAI_API_KEY: "openai-key",
    };

    const value = resolveRunnerApiKey({ openai_api_key: "case-key" }, env);
    assert.equal(value, "case-key");
  });

  it("resolveRunnerApiKey: falls back to OPENAI_API_KEY", () => {
    const env = {
      OPENAI_API_KEY: "openai-key",
    };

    const value = resolveRunnerApiKey(undefined, env);
    assert.equal(value, "openai-key");
  });

  it("resolveRunnerApiKey: returns undefined when missing", () => {
    const value = resolveRunnerApiKey(undefined, {});
    assert.equal(value, undefined);
  });

  it("resolveJudgeModels: parses comma-separated model list", () => {
    const value = resolveJudgeModels({
      EVAL_JUDGE_MODELS: "model-a, model-b,model-c ",
    });

    assert.deepEqual(value, ["model-a", "model-b", "model-c"]);
  });

  it("resolveJudgeModels: returns undefined when absent", () => {
    const value = resolveJudgeModels({});
    assert.equal(value, undefined);
  });

  it("resolveJudgeAggregation: defaults to median", () => {
    const value = resolveJudgeAggregation({});
    assert.equal(value, "median");
  });

  it("resolveJudgeAggregation: returns configured value", () => {
    const value = resolveJudgeAggregation({ EVAL_JUDGE_AGGREGATION: "mean" });
    assert.equal(value, "mean");
  });

  it("resolveLegacyAgentPromptFile: returns env value when set", () => {
    const value = resolveLegacyAgentPromptFile({
      EVAL_LEGACY_AGENT_PROMPT_FILE: "./prompts/legacy.txt",
    });
    assert.equal(value, "./prompts/legacy.txt");
  });

  it("resolveLegacyAgentPromptFile: trims and returns undefined when empty", () => {
    assert.equal(
      resolveLegacyAgentPromptFile({ EVAL_LEGACY_AGENT_PROMPT_FILE: "   " }),
      undefined,
    );
  });

  it("resolveMcpServerBaseURL: returns env value when set", () => {
    const value = resolveMcpServerBaseURL({
      EVAL_MCP_SERVER_BASE_URL: "https://custom-mcp.example",
    });
    assert.equal(value, "https://custom-mcp.example");
  });

  it("resolveMcpServerBaseURL: falls back to default", () => {
    const value = resolveMcpServerBaseURL({});
    assert.equal(value, DEFAULT_MCP_SERVER_BASE_URL);
  });

  it("resolveUpstreamBaseURL: returns env value when set", () => {
    const value = resolveUpstreamBaseURL({
      EVAL_UPSTREAM_API_BASE_URL: "https://custom-upstream.example",
    });
    assert.equal(value, "https://custom-upstream.example");
  });

  it("resolveUpstreamBaseURL: falls back to default", () => {
    const value = resolveUpstreamBaseURL({});
    assert.equal(value, DEFAULT_UPSTREAM_API_BASE_URL);
  });

  it("optional token resolvers return value when set", () => {
    const env = {
      EVAL_MCP_X_TOKEN: "mcp-token",
      EVAL_UPSTREAM_X_TOKEN: "upstream-token",
    };

    assert.equal(resolveMcpXToken(env), "mcp-token");
    assert.equal(resolveUpstreamXToken(env), "upstream-token");
  });

  it("optional token resolvers return undefined when absent", () => {
    const env = {};

    assert.equal(resolveMcpXToken(env), undefined);
    assert.equal(resolveUpstreamXToken(env), undefined);
  });
});
