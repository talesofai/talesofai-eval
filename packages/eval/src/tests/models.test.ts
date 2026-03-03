import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  listModels,
  loadModels,
  resetRegistry,
  resolveModel,
} from "../models/index.ts";
// Import internal function for unit testing
import { resolveEnvVars } from "../models/registry.ts";

describe("models", () => {
  describe("resolveEnvVars", () => {
    it("replaces ${VAR} with environment variable value", () => {
      process.env["TEST_VAR"] = "test_value";
      const result = resolveEnvVars("prefix_${TEST_VAR}_suffix");
      assert.equal(result, "prefix_test_value_suffix");
      delete process.env["TEST_VAR"];
    });

    it("replaces with empty string if env var not set", () => {
      const result = resolveEnvVars("prefix_${UNDEFINED_VAR}_suffix");
      assert.equal(result, "prefix__suffix");
    });

    it("handles multiple env vars", () => {
      process.env["VAR1"] = "first";
      process.env["VAR2"] = "second";
      const result = resolveEnvVars("${VAR1}_and_${VAR2}");
      assert.equal(result, "first_and_second");
      delete process.env["VAR1"];
      delete process.env["VAR2"];
    });
  });

  describe("loadModels", () => {
    const tempDir = tmpdir();
    let tempFile: string;

    beforeEach(async () => {
      resetRegistry();
      tempFile = join(tempDir, `models-test-${Date.now()}.json`);
    });

    afterEach(async () => {
      resetRegistry();
      try {
        await unlink(tempFile);
      } catch {
        // ignore
      }
    });

    it("loads models from a JSON file", async () => {
      const modelsData = {
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            api: "openai-completions",
            provider: "test",
            baseUrl: "https://api.test.com",
          },
        },
      };
      await writeFile(tempFile, JSON.stringify(modelsData, null, 2));

      const registry = await loadModels(tempFile);
      assert.ok(registry.models["test-model"]);
      assert.equal(registry.models["test-model"]!.id, "test-model");
      assert.equal(registry.models["test-model"]!.name, "Test Model");
    });

    it("resolves env vars in baseUrl", async () => {
      process.env["TEST_BASE_URL"] = "https://api.test.com";
      const modelsData = {
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            api: "openai-completions",
            provider: "test",
            baseUrl: "${TEST_BASE_URL}",
          },
        },
      };
      await writeFile(tempFile, JSON.stringify(modelsData, null, 2));

      const registry = await loadModels(tempFile);
      assert.ok(registry.models["test-model"]);
      assert.equal(
        registry.models["test-model"]!.baseUrl,
        "https://api.test.com",
      );
      delete process.env["TEST_BASE_URL"];
    });

    it("resolves env vars in headers", async () => {
      process.env["TEST_API_KEY"] = "secret123";
      const modelsData = {
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            api: "openai-completions",
            provider: "test",
            baseUrl: "https://api.test.com",
            headers: {
              Authorization: "Bearer ${TEST_API_KEY}",
            },
          },
        },
      };
      await writeFile(tempFile, JSON.stringify(modelsData, null, 2));

      const registry = await loadModels(tempFile);
      assert.ok(registry.models["test-model"]);
      assert.ok(registry.models["test-model"]!.headers);
      assert.equal(
        registry.models["test-model"]!.headers!["Authorization"],
        "Bearer secret123",
      );
      delete process.env["TEST_API_KEY"];
    });
  });

  describe("resolveModel", () => {
    const tempDir = tmpdir();
    let tempFile: string;

    beforeEach(async () => {
      resetRegistry();
      tempFile = join(tempDir, `models-test-${Date.now()}.json`);
      const modelsData = {
        models: {
          "model-a": {
            id: "model-a",
            name: "Model A",
            api: "openai-completions",
            provider: "test",
            baseUrl: "https://api.a.com",
          },
          "model-b": {
            id: "model-b",
            name: "Model B",
            api: "anthropic-messages",
            provider: "test",
            baseUrl: "https://api.b.com",
          },
        },
      };
      await writeFile(tempFile, JSON.stringify(modelsData, null, 2));
      await loadModels(tempFile);
    });

    afterEach(async () => {
      resetRegistry();
      try {
        await unlink(tempFile);
      } catch {
        // ignore
      }
    });

    it("returns correct config for existing model", () => {
      const model = resolveModel("model-a");
      assert.equal(model.id, "model-a");
      assert.equal(model.name, "Model A");
      assert.equal(model.api, "openai-completions");
    });

    it("throws for unknown model", () => {
      assert.throws(
        () => resolveModel("unknown-model"),
        /Model not found: unknown-model/,
      );
    });
  });

  describe("listModels", () => {
    const tempDir = tmpdir();
    let tempFile: string;

    beforeEach(async () => {
      resetRegistry();
      tempFile = join(tempDir, `models-test-${Date.now()}.json`);
      const modelsData = {
        models: {
          "model-a": {
            id: "model-a",
            name: "Model A",
            api: "openai-completions",
            provider: "test",
            baseUrl: "https://api.a.com",
          },
          "model-b": {
            id: "model-b",
            name: "Model B",
            api: "anthropic-messages",
            provider: "test",
            baseUrl: "https://api.b.com",
          },
        },
      };
      await writeFile(tempFile, JSON.stringify(modelsData, null, 2));
      await loadModels(tempFile);
    });

    afterEach(async () => {
      resetRegistry();
      try {
        await unlink(tempFile);
      } catch {
        // ignore
      }
    });

    it("returns list of model IDs", () => {
      const models = listModels();
      assert.deepEqual(models.sort(), ["model-a", "model-b"]);
    });
  });
});
