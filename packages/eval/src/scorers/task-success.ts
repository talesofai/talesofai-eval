import { parseToolOutput } from "../metrics/trace-metrics.ts";
import type {
	AssertionConfig,
	DimensionResult,
	EvalCase,
	EvalTrace,
} from "../types.ts";
import { callJudge, createJudgeClient } from "../utils/judge-client.ts";
import {
	callMultiJudge,
	isMultiJudgeConfigured,
} from "../utils/multi-judge-client.ts";

type TaskSuccessAssertion = Extract<AssertionConfig, { type: "task_success" }>;

function resolveUserGoal(
	assertion: TaskSuccessAssertion,
	trace: EvalTrace,
	evalCase: EvalCase,
): string {
	if (assertion.user_goal) {
		return assertion.user_goal;
	}

	for (const msg of trace.conversation) {
		if (msg.role === "user") {
			return typeof msg.content === "string"
				? msg.content
				: "(complex user message)";
		}
	}

	for (const msg of evalCase.input.messages) {
		if (msg.role === "user") {
			const content = msg.content;
			if (typeof content === "string") {
				return content;
			}
			if (Array.isArray(content)) {
				const textPart = content.find(
					(
						p,
					): p is
						| { type: "text"; text: string }
						| { type: "input_text"; text: string } =>
						p.type === "text" || p.type === "input_text",
				);
				if (textPart) {
					return textPart.text;
				}
			}
			return "(complex user message)";
		}
	}

	return "(unknown user goal)";
}

function collectArtifactSummary(trace: EvalTrace): string {
	const lines: string[] = [];

	for (const call of trace.tools_called) {
		const parsed = parseToolOutput(call.output);
		for (const artifact of parsed.artifacts) {
			if (artifact.url) {
				lines.push(`[${artifact.modality}] ${artifact.url}`);
			}
		}
	}

	return lines.length > 0 ? lines.join("\n") : "(no artifacts produced)";
}

export const scoreTaskSuccess = async (
	trace: EvalTrace,
	assertion: AssertionConfig,
	evalCase: EvalCase,
): Promise<DimensionResult> => {
	if (assertion.type !== "task_success") {
		return {
			dimension: "task_success",
			passed: false,
			score: 0,
			reason: `internal error: expected task_success assertion, got ${assertion.type}`,
		};
	}

	const a = assertion as TaskSuccessAssertion;
	const userGoal = resolveUserGoal(a, trace, evalCase);
	const finalResponse = trace.final_response ?? "(no final response)";
	const artifactSummary = collectArtifactSummary(trace);

	const systemPrompt = `你是一个 AI 任务完成评估专家。根据用户目标、智能体的最终回复和产出物，判断任务是否成功完成。
只输出 JSON: {"score": <0~1>, "reason": "<简短说明>"}\n评分标准：1.0=完全完成，0.7=基本完成，0.4=部分完成，0.1=几乎未完成，0=完全失败`;

	const userPrompt = `## 用户目标
${userGoal}

## 智能体最终回复
${finalResponse}

## 产出物
${artifactSummary}`;

	// Use multi-model judging if configured
	if (isMultiJudgeConfigured()) {
		const result = await callMultiJudge(systemPrompt, userPrompt);

		if ("error" in result) {
			return {
				dimension: "task_success",
				passed: false,
				score: 0,
				reason: result.error,
			};
		}

		const passed = result.score >= a.pass_threshold;
		return {
			dimension: "task_success",
			passed,
			score: result.score,
			reason: result.reason,
		};
	}

	// Fallback to single-model judging
	const { openai, model } = createJudgeClient();
	const result = await callJudge(openai, model, systemPrompt, userPrompt);

	if ("error" in result) {
		return {
			dimension: "task_success",
			passed: false,
			score: 0,
			reason: result.error,
		};
	}

	const passed = result.score >= a.pass_threshold;
	return {
		dimension: "task_success",
		passed,
		score: result.score,
		reason: result.reason,
	};
};
