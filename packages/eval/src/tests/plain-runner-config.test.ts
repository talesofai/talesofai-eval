import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePlainApiKey, resolvePlainBaseURL } from "../runners/plain.ts";
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
      EVAL_PLAIN_BASE_URL: "https://plain-base.example/v1",
      OPENAI_BASE_URL: "https://openai-base.example/v1",
      EVAL_PLAIN_API_KEY: "plain-key",
      OPENAI_API_KEY: "openai-key",
    };

    assert.equal(
      resolvePlainBaseURL(input, env),
      "https://case-base.example/v1",
    );
    assert.equal(resolvePlainApiKey(input, env), "case-key");
  });

  it("uses EVAL_PLAIN_* before OPENAI_* fallback", () => {
    const env = {
      EVAL_PLAIN_BASE_URL: "https://plain-base.example/v1",
      OPENAI_BASE_URL: "https://openai-base.example/v1",
      EVAL_PLAIN_API_KEY: "plain-key",
      OPENAI_API_KEY: "openai-key",
    };

    assert.equal(
      resolvePlainBaseURL(baseInput, env),
      "https://plain-base.example/v1",
    );
    assert.equal(resolvePlainApiKey(baseInput, env), "plain-key");
  });

  it("falls back to OPENAI_* when EVAL_PLAIN_* is absent", () => {
    const env = {
      OPENAI_BASE_URL: "https://openai-base.example/v1",
      OPENAI_API_KEY: "openai-key",
    };

    assert.equal(
      resolvePlainBaseURL(baseInput, env),
      "https://openai-base.example/v1",
    );
    assert.equal(resolvePlainApiKey(baseInput, env), "openai-key");
  });
});
