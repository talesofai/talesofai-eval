import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { callJudgeForModel } from "../judge/call.ts";
import { loadModels, resetRegistry } from "../models/index.ts";

describe("callJudge", () => {
  const tempDir = tmpdir();
  let tempFile: string;

  beforeEach(async () => {
    resetRegistry();
    tempFile = join(tempDir, `models-test-${Date.now()}.json`);
    const modelsData = {
      models: {
        "judge-model": {
          id: "judge-model",
          name: "Test Judge Model",
          api: "openai-completions",
          provider: "test",
          baseUrl: "https://api.test.com",
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

  it("returns error when model resolution fails", async () => {
    // Note: Full judge functionality requires a real LLM endpoint.
    // This test verifies error handling when the model config is present
    // but the API call would fail (no real endpoint).
    const result = await callJudgeForModel("judge-model", "sys", "user", 0);

    // Since there's no real endpoint, we expect an error
    assert.equal("error" in result, true);
  });

  it("returns error for unknown model", async () => {
    const result = await callJudgeForModel("unknown-model", "sys", "user", 0);

    assert.equal("error" in result, true);
    if ("error" in result) {
      assert.match(result.error, /Model not found/);
    }
  });

  it("returns error when models not loaded", async () => {
    resetRegistry();
    const result = await callJudgeForModel("judge-model", "sys", "user", 0);

    assert.equal("error" in result, true);
    if ("error" in result) {
      assert.match(result.error, /Models not loaded/);
    }
  });
});
