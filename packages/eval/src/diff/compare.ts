import type { Context } from "@mariozechner/pi-ai";
import { complete } from "../inference/index.ts";
import type { ModelConfig } from "../models/index.ts";
import { resolveModel } from "../models/index.ts";
import type { DiffResult, EvalCase, EvalTrace } from "../types.ts";
import { safeParseJson } from "../utils/safe-parse-json.ts";

/**
 * Compare two traces for the same case and produce a verdict via LLM judge.
 */
export async function compareTraces(
  evalCase: EvalCase,
  base: EvalTrace,
  candidate: EvalTrace,
  baseLabel: string,
  candidateLabel: string,
): Promise<DiffResult> {
  const modelId = process.env["EVAL_JUDGE_MODEL"];
  if (!modelId) {
    return {
      case_id: evalCase.id,
      verdict: "error",
      reason: "missing required EVAL_JUDGE_MODEL",
      base,
      candidate,
    };
  }

  let model: ModelConfig;
  try {
    model = resolveModel(modelId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      case_id: evalCase.id,
      verdict: "error",
      reason: `failed to resolve model: ${message}`,
      base,
      candidate,
    };
  }

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

  const context: Context = {
    systemPrompt,
    messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
  };

  try {
    const content = await complete(model, context, { temperature: 0 });
    const parsed = safeParseJson<{ verdict: string; reason: string }>(content);

    if (parsed) {
      const validVerdicts = [
        "base_better",
        "candidate_better",
        "equivalent",
      ] as const;
      const verdict = validVerdicts.find((v) => v === parsed.verdict);
      if (verdict && typeof parsed.reason === "string") {
        return {
          case_id: evalCase.id,
          verdict,
          reason: parsed.reason,
          base,
          candidate,
        };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      case_id: evalCase.id,
      verdict: "error",
      reason: `judge failed: ${message}`,
      base,
      candidate,
    };
  }

  return {
    case_id: evalCase.id,
    verdict: "error",
    reason: "judge returned unparseable response",
    base,
    candidate,
  };
}

/**
 * Format a trace for diff comparison.
 * @internal
 */
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
