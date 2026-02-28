import { safeParseJson } from "../utils/safe-parse-json.ts";
import OpenAI from "openai";
import type { AssertionConfig, DimensionResult, EvalTrace } from "../types.ts";

type LlmJudgeAssertion = Extract<AssertionConfig, { type: "llm_judge" }>;

/**
 * LLM-as-judge scorer.
 */
export const scoreLlmJudgeAssertion = async (
  trace: EvalTrace,
  assertion: AssertionConfig,
): Promise<DimensionResult> => {
  if (assertion.type !== "llm_judge") {
    return {
      dimension: "llm_judge",
      passed: false,
      score: 0,
      reason: `internal error: expected llm_judge assertion, got ${assertion.type}`,
    };
  }

  const model = process.env["EVAL_JUDGE_MODEL"];
  if (!model || model.trim().length === 0) {
    return {
      dimension: "llm_judge",
      passed: false,
      score: 0,
      reason: "missing required EVAL_JUDGE_MODEL",
    };
  }

  const apiKey =
    process.env["EVAL_JUDGE_API_KEY"] ?? process.env["OPENAI_API_KEY"] ?? "";
  const baseURL =
    process.env["EVAL_JUDGE_BASE_URL"] ??
    (apiKey.startsWith("sk-")
      ? "https://api.openai.com/v1"
      : process.env["OPENAI_BASE_URL"]);

  if (!baseURL) {
    return {
      dimension: "llm_judge",
      passed: false,
      score: 0,
      reason: "no OPENAI_BASE_URL or EVAL_JUDGE_BASE_URL configured",
    };
  }

  const openai = new OpenAI({ apiKey, baseURL });
  const formattedTrace = formatTrace(trace);

  const systemPrompt = `你是一个 AI 行为评估专家。根据以下对话记录和评分标准，给出 0~1 的分数和理由。
只输出 JSON: {"score": <0~1>, "reason": "<简短说明>"}`;

  const userPrompt = `## 评分标准
${assertion.prompt}

## 对话记录
${formattedTrace}`;

  const result = await callJudge(openai, model, systemPrompt, userPrompt);

  if ("error" in result) {
    return {
      dimension: "llm_judge",
      passed: false,
      score: 0,
      reason: result.error,
    };
  }

  const passed = result.score >= assertion.pass_threshold;
  return {
    dimension: "llm_judge",
    passed,
    score: result.score,
    reason: result.reason,
  };
};

function formatTrace(trace: EvalTrace): string {
  const lines: string[] = [];
  for (const msg of trace.conversation) {
    if (msg.role === "system") {
      lines.push(`[System] ${msg.content}`);
    } else if (msg.role === "user") {
      lines.push(`[User] ${msg.content}`);
    } else if (msg.role === "assistant") {
      if (msg.content) {
        lines.push(`[Assistant] ${msg.content}`);
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          lines.push(
            `[Assistant → Tool] ${tc.function.name}(${tc.function.arguments})`,
          );
        }
      }
    } else if (msg.role === "tool") {
      const preview =
        msg.content.length > 500
          ? `${msg.content.slice(0, 500)}…`
          : msg.content;
      lines.push(`[Tool Result] ${preview}`);
    }
  }
  return lines.join("\n");
}

async function callJudge(
  openai: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  retries = 1,
): Promise<{ score: number; reason: string } | { error: string }> {
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

export type { LlmJudgeAssertion };
