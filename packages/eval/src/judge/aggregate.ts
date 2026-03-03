/**
 * Score aggregation utilities for multi-model LLM judging.
 *
 * Supports: median, mean, iqm (interquartile mean)
 */

export type AggregationMethod = "median" | "mean" | "iqm";

export interface JudgeScore {
  model: string;
  score: number;
  reason: string;
}

export interface AggregatedResult {
  score: number;
  confidence: number;
  method: AggregationMethod;
  individualScores: JudgeScore[];
}

/**
 * Calculate median of an array of numbers.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1] ?? 0;
    const right = sorted[mid] ?? 0;
    return (left + right) / 2;
  }
  return sorted[mid] ?? 0;
}

/**
 * Calculate mean of an array of numbers.
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Calculate standard deviation.
 */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Calculate Interquartile Mean (IQM) - drops bottom and top 25% before averaging.
 * More robust to outliers than simple mean.
 */
function interquartileMean(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length < 4) return mean(values);

  const sorted = [...values].sort((a, b) => a - b);
  const q1Index = Math.floor(sorted.length * 0.25);
  const q3Index = Math.ceil(sorted.length * 0.75);
  const middleValues = sorted.slice(q1Index, q3Index);

  return mean(middleValues);
}

/**
 * Calculate confidence based on standard deviation relative to mean.
 * Returns 0-1 where 1 = all scores identical (high confidence).
 */
export function calcConfidence(scores: number[]): number {
  if (scores.length < 2) return 1;
  const m = mean(scores);
  if (m === 0) return scores.every((s) => s === 0) ? 1 : 0;
  const std = stdDev(scores);
  // Coefficient of variation inverted: 1 - (std/mean)
  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, 1 - std / m));
}

/**
 * Aggregate multiple judge scores using specified method.
 */
export function aggregateScores(
  scores: JudgeScore[],
  method: AggregationMethod,
): AggregatedResult {
  if (scores.length === 0) {
    return {
      score: 0,
      confidence: 0,
      method,
      individualScores: [],
    };
  }

  if (scores.length === 1) {
    const single = scores[0];
    if (!single) {
      return {
        score: 0,
        confidence: 0,
        method,
        individualScores: [],
      };
    }
    return {
      score: single.score,
      confidence: 1,
      method,
      individualScores: scores,
    };
  }

  const scoreValues = scores.map((s) => s.score);

  let aggregatedScore: number;
  switch (method) {
    case "mean":
      aggregatedScore = mean(scoreValues);
      break;
    case "iqm":
      aggregatedScore = interquartileMean(scoreValues);
      break;
    case "median":
    default:
      aggregatedScore = median(scoreValues);
  }

  const confidence = calcConfidence(scoreValues);

  return {
    score: aggregatedScore,
    confidence,
    method,
    individualScores: scores,
  };
}

/**
 * Format aggregated result for display/reason field.
 */
export function formatAggregatedReason(result: AggregatedResult): string {
  const parts: string[] = [];

  // Individual scores
  for (const s of result.individualScores) {
    const scoreStr = s.score.toFixed(2);
    parts.push(`${s.model}: ${scoreStr} - ${s.reason}`);
  }

  // Summary line
  parts.push(
    `[aggregated via ${result.method}: ${result.score.toFixed(2)}, confidence: ${(result.confidence * 100).toFixed(0)}%]`,
  );

  return parts.join(" | ");
}
