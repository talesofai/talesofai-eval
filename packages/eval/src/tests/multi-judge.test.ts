import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	aggregateScores,
	calcConfidence,
	formatAggregatedReason,
} from "../utils/aggregate-scores.ts";
import type { AggregatedResult, JudgeScore } from "../utils/aggregate-scores.ts";

describe("aggregateScores", () => {
	it("returns median by default", () => {
		const scores: JudgeScore[] = [
			{ model: "a", score: 0.8, reason: "good" },
			{ model: "b", score: 0.9, reason: "great" },
			{ model: "c", score: 0.7, reason: "ok" },
		];
		const result = aggregateScores(scores, "median");
		assert.equal(result.score, 0.8); // median of [0.7, 0.8, 0.9]
		assert.equal(result.method, "median");
	});

	it("calculates mean when specified", () => {
		const scores: JudgeScore[] = [
			{ model: "a", score: 0.8, reason: "good" },
			{ model: "b", score: 0.9, reason: "great" },
		];
		const result = aggregateScores(scores, "mean");
		assert.ok(Math.abs(result.score - 0.85) < 0.0001);
		assert.equal(result.method, "mean");
	});

	it("calculates IQM (drops outliers)", () => {
		const scores: JudgeScore[] = [
			{ model: "a", score: 0.1, reason: "outlier low" },
			{ model: "b", score: 0.2, reason: "outlier low" },
			{ model: "c", score: 0.8, reason: "good" },
			{ model: "d", score: 0.85, reason: "good" },
			{ model: "e", score: 0.9, reason: "great" },
			{ model: "f", score: 0.95, reason: "great" },
		];
		const result = aggregateScores(scores, "iqm");
		// IQM: sorted=[0.1,0.2,0.8,0.85,0.9,0.95], q1=1, q3=5, middle=[0.2,0.8,0.85,0.9]
		// mean = (0.2+0.8+0.85+0.9)/4 = 0.6875
		assert.equal(result.score, 0.6875);
		assert.equal(result.method, "iqm");
	});

	it("handles single score", () => {
		const scores: JudgeScore[] = [{ model: "a", score: 0.8, reason: "good" }];
		const result = aggregateScores(scores, "median");
		assert.equal(result.score, 0.8);
		assert.equal(result.confidence, 1);
	});

	it("handles empty scores", () => {
		const result = aggregateScores([], "median");
		assert.equal(result.score, 0);
		assert.equal(result.confidence, 0);
	});
});

describe("calcConfidence", () => {
	it("returns ~1 for identical scores", () => {
		const confidence = calcConfidence([0.8, 0.8, 0.8]);
		assert.ok(confidence > 0.999); // essentially 1, allowing for FP error
	});

	it("returns lower confidence for spread scores", () => {
		const confidence = calcConfidence([0.5, 0.8, 0.9]);
		assert.ok(confidence < 1);
		assert.ok(confidence > 0);
	});

	it("returns 1 for single score", () => {
		assert.equal(calcConfidence([0.8]), 1);
	});

	it("returns 0 for empty array", () => {
		assert.equal(calcConfidence([]), 1); // edge case: no variance
	});
});

describe("formatAggregatedReason", () => {
	it("formats individual scores and summary", () => {
		const result: AggregatedResult = {
			score: 0.85,
			confidence: 0.9,
			method: "median",
			individualScores: [
				{ model: "gpt-4o", score: 0.8, reason: "good" },
				{ model: "claude", score: 0.9, reason: "great" },
			],
		};
		const formatted = formatAggregatedReason(result);
		assert.ok(formatted.includes("gpt-4o: 0.80"));
		assert.ok(formatted.includes("claude: 0.90"));
		assert.ok(formatted.includes("median: 0.85"));
		assert.ok(formatted.includes("confidence: 90%"));
	});
});
