import type { Context } from "@mariozechner/pi-ai";
import { complete } from "../inference/index.ts";
import type { ModelConfig } from "../models/index.ts";
import { resolveModel } from "../models/index.ts";
import { safeParseJson } from "../utils/safe-parse-json.ts";
import { resolveJudgeModels } from "../config.ts";

export type JudgeScoreResult =
  | { score: number; reason: string }
  | { error: string };

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
  const models = resolveJudgeModels();
  const modelId = models?.[0];
  if (!modelId) {
    return { error: "missing required EVAL_JUDGE_MODELS" };
  }

  return callJudgeForModel(modelId, systemPrompt, userPrompt, retries);
}
