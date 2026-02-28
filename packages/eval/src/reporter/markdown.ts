import { summarizeTraceMetrics } from "../metrics/trace-metrics.ts";
import type { EvalSummary } from "../types.ts";
import { escapeMarkdownCell } from "./render.ts";
import { buildCaseRowView } from "./report-view.ts";

export function renderRunMarkdownReport(summary: EvalSummary): string {
  const lines: string[] = [];

  lines.push("# agent-eval run report");
  lines.push("");
  lines.push(`- total: ${summary.total}`);
  lines.push(`- passed: ${summary.passed}`);
  lines.push(`- failed: ${summary.failed}`);
  lines.push(`- errored: ${summary.errored}`);
  lines.push(`- duration: ${(summary.duration_ms / 1000).toFixed(1)}s`);
  lines.push("");

  lines.push("| case | status | judge | duration | tokens | detail |");
  lines.push("| --- | --- | --- | --- | --- | --- |");

  for (const result of summary.results) {
    const row = buildCaseRowView(result);

    lines.push(
      `| ${escapeMarkdownCell(row.case_id)} | ${escapeMarkdownCell(row.status_text)} | ${escapeMarkdownCell(row.judge_text)} | ${escapeMarkdownCell(row.duration_text)} | ${escapeMarkdownCell(row.tokens_text)} | ${escapeMarkdownCell(row.detail_text)} |`,
    );
  }

  const metricsSummary = summarizeTraceMetrics(summary.results);
  const bindingRateText =
    metricsSummary.binding_rate === null
      ? "n/a"
      : `${(metricsSummary.binding_rate * 100).toFixed(1)}%`;

  lines.push("");
  lines.push("## Metrics Summary");
  lines.push("");
  lines.push(`- avg_tool_calls_total: ${metricsSummary.avg_tool_calls_total}`);
  lines.push(
    `- avg_tool_error_calls_total: ${metricsSummary.avg_tool_error_calls_total}`,
  );
  lines.push(
    `- avg_tool_retry_calls_total: ${metricsSummary.avg_tool_retry_calls_total}`,
  );
  lines.push(
    `- make_video_binding_rate: ${metricsSummary.make_video_binding_rate === null ? "n/a" : `${(metricsSummary.make_video_binding_rate * 100).toFixed(1)}%`}`,
  );
  lines.push(
    `- milestone_rates: picture=${(metricsSummary.picture_rate * 100).toFixed(1)}% video=${(metricsSummary.video_rate * 100).toFixed(1)}% binding=${bindingRateText} delivery=${(metricsSummary.delivery_rate * 100).toFixed(1)}%`,
  );
  lines.push(
    `- artifacts_by_modality: ${JSON.stringify(metricsSummary.artifacts_by_modality)}`,
  );
  lines.push("");

  return lines.join("\n");
}
