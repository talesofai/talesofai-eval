import OpenAI from "openai";
import {
  ENV_KEYS,
  resolveJudgeApiKey,
  resolveJudgeBaseURL,
  resolveJudgeModel,
} from "../env.ts";
import type { DiffResult, DiffVerdict, EvalCase, EvalTrace } from "../types.ts";
import { safeParseJson } from "../utils/safe-parse-json.ts";

/**
 * Compare two traces for the same case and produce a verdict via LLM judge.
 */
export const compareTraces = async (
  evalCase: EvalCase,
  base: EvalTrace,
  candidate: EvalTrace,
  baseLabel: string,
  candidateLabel: string,
): Promise<DiffResult> => {
  const model = resolveJudgeModel();
  if (!model) {
    return {
      case_id: evalCase.id,
      verdict: "error",
      reason: `missing required ${ENV_KEYS.JUDGE_MODEL}`,
      base,
      candidate,
    };
  }

  const apiKey = resolveJudgeApiKey();
  if (!apiKey) {
    return {
      case_id: evalCase.id,
      verdict: "error",
      reason: `missing required ${ENV_KEYS.JUDGE_API_KEY}|${ENV_KEYS.OPENAI_API_KEY}`,
      base,
      candidate,
    };
  }

  const baseURL = resolveJudgeBaseURL();
  if (!baseURL) {
    return {
      case_id: evalCase.id,
      verdict: "error",
      reason: `missing required ${ENV_KEYS.JUDGE_BASE_URL}|${ENV_KEYS.OPENAI_BASE_URL}`,
      base,
      candidate,
    };
  }

  const openai = new OpenAI({ apiKey, baseURL });

  const defaultSystemPrompt = `你是一个 AI 行为评估专家。对比以下两次运行，判断哪次更好地完成了任务。
只输出 JSON: {"verdict": "base_better"|"candidate_better"|"equivalent", "reason": "..."}`;

  const systemPrompt =
    process.env["EVAL_DIFF_SYSTEM_PROMPT"] ?? defaultSystemPrompt;

  const userPrompt = `## 任务描述
${evalCase.description}

## Base（${baseLabel}）
${formatTraceForDiff(base)}

## Candidate（${candidateLabel}）
${formatTraceForDiff(candidate)}`;

  const result = await callDiffJudge(openai, model, systemPrompt, userPrompt);

  return {
    case_id: evalCase.id,
    verdict: result?.verdict ?? "error",
    reason: result?.reason ?? "judge returned unparseable response",
    base,
    candidate,
  };
};

function formatTraceForDiff(trace: EvalTrace): string {
  const lines: string[] = [];
  for (const msg of trace.conversation) {
    if (msg.role === "system") continue;
    if (msg.role === "user") {
      lines.push(`[User] ${msg.content}`);
    } else if (msg.role === "assistant") {
      if (msg.content) lines.push(`[Assistant] ${msg.content}`);
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          lines.push(
            `[Tool Call] ${tc.function.name}(${tc.function.arguments})`,
          );
        }
      }
    } else if (msg.role === "tool") {
      const preview =
        msg.content.length > 300
          ? `${msg.content.slice(0, 300)}…`
          : msg.content;
      lines.push(`[Tool Result] ${preview}`);
    }
  }
  lines.push(`Status: ${trace.status} | Duration: ${trace.duration_ms}ms`);
  return lines.join("\n");
}

async function callDiffJudge(
  openai: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ verdict: DiffVerdict; reason: string } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
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
      if (!content) continue;

      const parsed = safeParseJson<{ verdict: string; reason: string }>(
        content,
      );
      if (!parsed) continue;

      const validVerdicts = [
        "base_better",
        "candidate_better",
        "equivalent",
      ] as const;
      const verdict = validVerdicts.find((v) => v === parsed.verdict);
      if (verdict && typeof parsed.reason === "string") {
        return { verdict, reason: parsed.reason };
      }
    } catch {
      if (attempt === 1) return null;
    }
  }
  return null;
}
