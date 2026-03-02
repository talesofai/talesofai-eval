import OpenAI from "openai";
import {
  ENV_KEYS,
  resolveJudgeApiKey,
  resolveJudgeBaseURL,
  resolveJudgeModel,
} from "../env.ts";
import { safeParseJson } from "./safe-parse-json.ts";

export type JudgeScoreResult =
  | { score: number; reason: string }
  | { error: string };

export function createJudgeClient(): { openai: OpenAI; model: string } {
  const model = resolveJudgeModel();
  if (!model) {
    throw new Error(`missing required ${ENV_KEYS.JUDGE_MODEL}`);
  }

  const apiKey = resolveJudgeApiKey();
  if (!apiKey) {
    throw new Error(
      `missing required ${ENV_KEYS.JUDGE_API_KEY}|${ENV_KEYS.OPENAI_API_KEY}`,
    );
  }

  const baseURL = resolveJudgeBaseURL();
  if (!baseURL) {
    throw new Error(
      `missing required ${ENV_KEYS.JUDGE_BASE_URL}|${ENV_KEYS.OPENAI_BASE_URL}`,
    );
  }

  return { openai: new OpenAI({ apiKey, baseURL }), model };
}

export async function callJudge(
  openai: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  retries = 1,
): Promise<JudgeScoreResult> {
  let lastError = "judge LLM returned unparseable response";

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const stream = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        stream: true,
      });

      let content = "";
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          content += delta;
        }
      }

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
