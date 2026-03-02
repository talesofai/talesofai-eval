import type {
  AssertionConfig,
  DimensionResult,
  EvalCase,
  EvalTrace,
} from "../types.ts";
import { callJudge, createJudgeClient } from "../utils/judge-client.ts";

type ToolParameterAccuracyAssertion = Extract<
  AssertionConfig,
  { type: "tool_parameter_accuracy" }
>;

export const scoreToolParameterAccuracy = async (
  trace: EvalTrace,
  assertion: AssertionConfig,
  _evalCase: EvalCase,
): Promise<DimensionResult> => {
  if (assertion.type !== "tool_parameter_accuracy") {
    return {
      dimension: "tool_parameter_accuracy",
      passed: false,
      score: 0,
      reason: `internal error: expected tool_parameter_accuracy assertion, got ${assertion.type}`,
    };
  }

  const a = assertion as ToolParameterAccuracyAssertion;
  const matchingCalls = trace.tools_called.filter(
    (call) => call.name === a.tool_name,
  );

  if (matchingCalls.length === 0) {
    return {
      dimension: "tool_parameter_accuracy",
      passed: false,
      score: 0,
      reason: `tool '${a.tool_name}' was never called`,
    };
  }

  const callsBlock = matchingCalls
    .map(
      (call, i) =>
        `### Call ${i + 1}\n\`\`\`json\n${JSON.stringify(call.arguments, null, 2)}\n\`\`\``,
    )
    .join("\n\n");

  const { openai, model } = createJudgeClient();

  const systemPrompt = `你是一个工具调用参数评估专家。根据期望的参数规范，判断实际调用参数是否满足要求。
只输出 JSON: {"score": <0~1>, "reason": "<简短说明>"}\n评分标准：1.0=完全符合，0.7=基本符合，0.4=部分符合，0.1=几乎不符合，0=完全不符合`;

  const userPrompt = `## 期望的参数规范
${a.expected_description}

## 实际调用参数
${callsBlock}`;

  const result = await callJudge(openai, model, systemPrompt, userPrompt);

  if ("error" in result) {
    return {
      dimension: "tool_parameter_accuracy",
      passed: false,
      score: 0,
      reason: result.error,
    };
  }

  const passed = result.score >= a.pass_threshold;
  return {
    dimension: "tool_parameter_accuracy",
    passed,
    score: result.score,
    reason: result.reason,
  };
};
