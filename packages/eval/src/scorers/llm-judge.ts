import type { AssertionConfig, DimensionResult, EvalTrace } from "../types.ts";
import {
  callJudge,
  createJudgeClient,
} from "../utils/judge-client.ts";

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

  const { openai, model } = createJudgeClient();
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

export type { LlmJudgeAssertion };
