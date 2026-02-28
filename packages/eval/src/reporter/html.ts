import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "html-minifier-terser";
import { summarizeTraceMetrics } from "../metrics/trace-metrics.ts";
import type { EvalResult, EvalSummary, TraceMetricsSummary } from "../types.ts";
import {
  buildCaseMetricsView,
  buildCaseRowView,
  buildConversationView,
  buildToolCallViews,
  type CaseMetricsView,
  type CaseRowView,
  type ConversationItemView,
  type ToolCallView,
} from "./report-view.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const STYLE_PLACEHOLDER = "{{REPORT_STYLE}}";
const SCRIPT_PLACEHOLDER = "{{REPORT_SCRIPT}}";
const DATA_PLACEHOLDER = "{{REPORT_DATA}}";

export type ReportCasePayload = {
  row: CaseRowView;
  title: string;
  metrics_view: CaseMetricsView;
  tool_calls: ToolCallView[];
  conversation: ConversationItemView[];
  result: EvalResult;
};

export type ReportPayload = {
  generated_at: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    errored: number;
    duration_ms: number;
    metrics_summary: TraceMetricsSummary;
  };
  cases: ReportCasePayload[];
};

function encodePayload(payload: ReportPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json).toString("base64");
}

function loadTemplate(name: string): string {
  const templatePath = join(__dirname, "templates", name);
  return readFileSync(templatePath, "utf8");
}

async function maybeMinifyHtml(html: string): Promise<string> {
  if (process.env["NODE_ENV"] !== "production") {
    return html;
  }

  return await minify(html, {
    collapseWhitespace: true,
    minifyCSS: true,
    minifyJS: true,
    ignoreCustomFragments: [/<pre[\s\S]*?<\/pre>/g, /<code[\s\S]*?<\/code>/g],
  });
}

function buildReportCasePayload(result: EvalResult): ReportCasePayload {
  const toolCalls = buildToolCallViews(result.trace.tools_called);
  return {
    row: buildCaseRowView(result),
    title: result.preset_description ?? result.description ?? result.case_id,
    metrics_view: buildCaseMetricsView(result),
    tool_calls: toolCalls,
    conversation: buildConversationView(result.trace, toolCalls),
    result,
  };
}

export async function renderRunHtmlReport(
  summary: EvalSummary,
): Promise<string> {
  const payload: ReportPayload = {
    generated_at: new Date().toISOString(),
    summary: {
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      errored: summary.errored,
      duration_ms: summary.duration_ms,
      metrics_summary: summarizeTraceMetrics(summary.results),
    },
    cases: summary.results.map(buildReportCasePayload),
  };

  const encoded = encodePayload(payload);
  const template = loadTemplate("report.template.html");
  const styles = loadTemplate("report.template.css");
  const script = loadTemplate("report.template.js").replaceAll(
    DATA_PLACEHOLDER,
    encoded,
  );

  const html = template
    .replaceAll(STYLE_PLACEHOLDER, styles)
    .replaceAll(SCRIPT_PLACEHOLDER, script);

  return await maybeMinifyHtml(html);
}
