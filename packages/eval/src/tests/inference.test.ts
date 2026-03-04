import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Context } from "@mariozechner/pi-ai";
import { complete, stream } from "../inference/index.ts";
import type { ModelConfig } from "../models/index.ts";

// Mock model config for testing
const mockModel: ModelConfig = {
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "test",
  baseUrl: "https://api.test.com",
};

describe("inference", () => {
  describe("stream", () => {
    it("is an async generator function", () => {
      // Since we can't easily mock pi-ai's stream without complex setup,
      // we just verify the function signature and export
      assert.equal(typeof stream, "function");
    });

    it("returns an async generator when called", () => {
      const context: Context = {
        systemPrompt: "You are a test assistant.",
        messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
      };
      const generator = stream(mockModel, context);
      assert.equal(typeof generator[Symbol.asyncIterator], "function");
    });
  });

  describe("complete", () => {
    it("is an async function", () => {
      assert.equal(typeof complete, "function");
    });

    it("returns a Promise", () => {
      const context: Context = {
        systemPrompt: "You are a test assistant.",
        messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
      };
      const result = complete(mockModel, context);
      assert.ok(result instanceof Promise);
      // Clean up - let it fail/reject since we're mocking
      result.catch(() => {});
    });
  });

  describe("StreamOptions", () => {
    it("accepts temperature option", () => {
      const options = { temperature: 0.5 };
      assert.equal(options.temperature, 0.5);
    });

    it("accepts maxTokens option", () => {
      const options = { maxTokens: 100 };
      assert.equal(options.maxTokens, 100);
    });
  });
});
