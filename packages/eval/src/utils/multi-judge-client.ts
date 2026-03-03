/**
 * Multi-model LLM judge client.
 *
 * Calls multiple judge models in parallel and aggregates their scores.
 * Falls back to single judge when EVAL_JUDGE_MODELS is not configured.
 */

import OpenAI from "openai";
import {
	resolveJudgeModelConfigs,
	resolveJudgeAggregation,
} from "../env.ts";
import { callJudge, type JudgeScoreResult } from "./judge-client.ts";
import {
	aggregateScores,
	calcConfidence,
	formatAggregatedReason,
	type AggregationMethod,
	type AggregatedResult,
	type JudgeScore,
} from "./aggregate-scores.ts";

export type { AggregationMethod, AggregatedResult, JudgeScore };
export { aggregateScores, calcConfidence, formatAggregatedReason };

/**
 * Check if multi-model judging is configured.
 */
export function isMultiJudgeConfigured(): boolean {
	const configs = resolveJudgeModelConfigs();
	return configs !== undefined && configs.length > 0;
}

/**
 * Create judge client for a specific model config.
 */
function createClientForConfig(config: {
	model: string;
	baseURL: string;
	apiKey: string;
}): { openai: OpenAI; model: string } {
	return {
		openai: new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL }),
		model: config.model,
	};
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
	const configs = options?.models ?? resolveJudgeModelConfigs() ?? [];
	const rawMethod = options?.method ?? resolveJudgeAggregation();
	const method: AggregationMethod =
		rawMethod === "mean" || rawMethod === "iqm" ? rawMethod : "median";

	if (configs.length === 0) {
		return { error: "No judge models configured" };
	}

	// Validate configs
	for (const config of configs) {
		if (!config.baseURL || !config.apiKey) {
			return {
				error: `Model ${config.model} missing baseURL or apiKey`,
			};
		}
	}

	// Call all models in parallel
	const judgeCalls = configs.map(async (config) => {
		try {
			const { openai, model } = createClientForConfig(config);
			const result = await callJudge(
				openai,
				model,
				systemPrompt,
				userPrompt,
				options?.retries ?? 1,
			);
			return { model: config.model, result };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				model: config.model,
				result: { error: `Judge call failed: ${message}` } as JudgeScoreResult,
			};
		}
	});

	const results = await Promise.all(judgeCalls);

	// Collect successful scores
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

	// Require at least 2 successful responses for multi-model
	if (successfulScores.length < 2) {
		return {
			error: `Multi-judge failed: only ${successfulScores.length} successful response(s). Errors: ${errors.join("; ")}`,
		};
	}

	// Aggregate scores
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
	// Use multi-model if configured
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

	// Fall back to single model
	const configs = resolveJudgeModelConfigs();
	if (!configs || configs.length === 0) {
		return { error: "No judge models configured" };
	}
	const config = configs[0];
	if (!config) {
		return { error: "No judge models configured" };
	}
	const { openai, model } = createClientForConfig(config);
	return callJudge(openai, model, systemPrompt, userPrompt, options?.retries);
}
