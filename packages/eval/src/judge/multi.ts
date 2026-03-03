/**
 * Multi-model LLM judge client.
 *
 * Calls multiple judge models in parallel and aggregates their scores.
 * Falls back to single judge when EVAL_JUDGE_MODELS is not configured.
 */

import { resolveJudgeAggregation, resolveJudgeModels } from "../config.ts";
import {
	aggregateScores,
	formatAggregatedReason,
	type AggregationMethod,
	type AggregatedResult,
	type JudgeScore,
} from "./aggregate.ts";
import { callJudge, callJudgeForModel, type JudgeScoreResult } from "./call.ts";

export type { AggregationMethod, AggregatedResult, JudgeScore };

function resolveModelIdsFromEnv(): string[] {
	return resolveJudgeModels() ?? [];
}

/**
 * Check if multi-model judging is configured.
 */
export function isMultiJudgeConfigured(): boolean {
	return resolveModelIdsFromEnv().length > 0;
}

/**
 * Call multiple judge models in parallel and aggregate results.
 */
export async function callMultiJudge(
	systemPrompt: string,
	userPrompt: string,
	options?: {
		models?: Array<{ model: string; baseURL: string; apiKey: string }>;
		method?: AggregationMethod;
		retries?: number;
	},
): Promise<
	| { score: number; reason: string; confidence: number; aggregated: true }
	| { error: string }
> {
	const modelIds =
		options?.models?.map((config) => config.model).filter(Boolean) ??
		resolveModelIdsFromEnv();
	const rawMethod = options?.method ?? resolveJudgeAggregation();
	const method: AggregationMethod =
		rawMethod === "mean" || rawMethod === "iqm" ? rawMethod : "median";

	if (modelIds.length === 0) {
		return { error: "No judge models configured" };
	}

	const judgeCalls = modelIds.map(async (modelId) => {
		const result = await callJudgeForModel(
			modelId,
			systemPrompt,
			userPrompt,
			options?.retries ?? 1,
		);
		return { model: modelId, result };
	});

	const results = await Promise.all(judgeCalls);

	const successfulScores: JudgeScore[] = [];
	const errors: string[] = [];

	for (const r of results) {
		if ("error" in r.result) {
			errors.push(`${r.model}: ${r.result.error}`);
		} else {
			successfulScores.push({
				model: r.model,
				score: r.result.score,
				reason: r.result.reason,
			});
		}
	}

	if (successfulScores.length < 2) {
		return {
			error: `Multi-judge failed: only ${successfulScores.length} successful response(s). Errors: ${errors.join("; ")}`,
		};
	}

	const aggregated = aggregateScores(successfulScores, method);

	return {
		score: aggregated.score,
		reason: formatAggregatedReason(aggregated),
		confidence: aggregated.confidence,
		aggregated: true as const,
	};
}

/**
 * Unified judge call - uses multi-model if configured, otherwise single model.
 * This is the main entry point for scorers.
 */
export async function callJudgeUnified(
	systemPrompt: string,
	userPrompt: string,
	options?: {
		retries?: number;
	},
): Promise<JudgeScoreResult> {
	if (isMultiJudgeConfigured()) {
		const result = await callMultiJudge(systemPrompt, userPrompt, options);
		if ("error" in result) {
			return { error: result.error };
		}
		return {
			score: result.score,
			reason: result.reason,
		};
	}

	return callJudge(systemPrompt, userPrompt, options?.retries);
}
