import type { Context } from "@mariozechner/pi-ai";
import { complete } from "../inference/index.ts";
import type { ModelConfig } from "../models/index.ts";
import { listModels, resolveModel } from "../models/index.ts";
import { safeParseJson } from "../utils/safe-parse-json.ts";

export type JudgeScoreResult =
  | { score: number; reason: string }
  | { error: string };

/**
 * Resolve judge model id.
 * Resolution order:
 * 1. EVAL_JUDGE_MODEL env var (explicit)
 * 2. First model in loaded registry (implicit default)
 */
function resolveJudgeModelId(): string | undefined {
  const value = process.env["EVAL_JUDGE_MODEL"];
  const trimmed = value?.trim();
  if (trimmed && trimmed.length > 0) {
    return trimmed;
  }

  // Fall back to first model in registry
  try {
    const models = listModels();
    return models[0];
  } catch {
    return undefined;
  }
}

export async function callJudgeForModel(
  modelId: string,
  systemPrompt: string,
  userPrompt: string,
  retries = 1,
): Promise<JudgeScoreResult> {
  let model: ModelConfig;
  try {
    model = resolveModel(modelId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `judge model resolution failed: ${message}` };
  }

  let lastError = "judge LLM returned unparseable response";

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const context: Context = {
        systemPrompt,
        messages: [
          { role: "user", content: userPrompt, timestamp: Date.now() },
        ],
      };

      const content = await complete(model, context, {
        temperature: 0,
      });

      if (!content) {
        lastError = "judge LLM returned empty content";
        continue;
      }

      const parsed = safeParseJson<{ score: number; reason: string }>(content);
      if (!parsed) {
        const preview =
          content.length > 240 ? `${content.slice(0, 240)}…` : content;
        lastError = `judge JSON parse failed: ${preview}`;
        continue;
      }

      if (typeof parsed.score !== "number") {
        lastError = "judge response missing numeric score";
        continue;
      }
      if (parsed.score < 0 || parsed.score > 1) {
        lastError = `judge response score out of range [0,1]: ${parsed.score}`;
        continue;
      }
      if (typeof parsed.reason !== "string") {
        lastError = "judge response missing string reason";
        continue;
      }

      return parsed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = `judge request failed: ${message}`;
    }
  }

  return { error: lastError };
}

export async function callJudge(
  systemPrompt: string,
  userPrompt: string,
  retries = 1,
): Promise<JudgeScoreResult> {
  const modelId = resolveJudgeModelId();
  if (!modelId) {
    return {
      error:
        "no judge model configured: set EVAL_JUDGE_MODEL=<id> or ensure models.json has at least one model",
    };
  }

  return callJudgeForModel(modelId, systemPrompt, userPrompt, retries);
}
