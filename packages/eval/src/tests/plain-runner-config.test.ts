import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRunnerApiKey, resolveRunnerBaseURL } from "../config.ts";
import type { PlainEvalCase } from "../types.ts";

const baseInput: PlainEvalCase["input"] = {
  system_prompt: "sys",
  model: "qwen-plus",
  messages: [{ role: "user", content: "hello" }],
  allowed_tool_names: [],
};

describe("runPlain config resolution", () => {
  it("prefers case-level base URL and API key", () => {
    const input: PlainEvalCase["input"] = {
      ...baseInput,
      openai_base_url: "https://case-base.example/v1",
      openai_api_key: "case-key",
    };

    const env = {
      OPENAI_BASE_URL: "https://openai-base.example/v1",
      OPENAI_API_KEY: "openai-key",
    };

    assert.equal(
      resolveRunnerBaseURL(input, env),
      "https://case-base.example/v1",
    );
    assert.equal(resolveRunnerApiKey(input, env), "case-key");
  });

  it("falls back to OPENAI_* when no case-level override", () => {
    const env = {
      OPENAI_BASE_URL: "https://openai-base.example/v1",
      OPENAI_API_KEY: "openai-key",
    };

    assert.equal(
      resolveRunnerBaseURL(baseInput, env),
      "https://openai-base.example/v1",
    );
    assert.equal(resolveRunnerApiKey(baseInput, env), "openai-key");
  });
});
