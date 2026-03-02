import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderRunHtmlReport, renderRunHtmlReportV3 } from "../reporter/html.ts";
import type { EvalResult, EvalSummary } from "../types.ts";

describe("renderRunHtmlReport", () => {
  it("renders a valid HTML document with embedded data", async () => {
    const summary = makeSummary([
      makeResult("case-a", true),
      makeResult("case-b", false),
    ]);

    const html = await renderRunHtmlReport(summary);

    assert.ok(html.includes("<!DOCTYPE html>"), "should include doctype");
    assert.ok(html.includes("<html"), "should include html tag");
    assert.ok(html.includes("</html>"), "should include closing html tag");
    assert.ok(html.includes("<head>"), "should include head");
    assert.ok(html.includes("<body"), "should include body");

    assert.ok(
      !html.includes('"{{REPORT_DATA}}"'),
      "should replace data placeholder",
    );
    assert.ok(html.includes("REPORT_DATA"), "should have REPORT_DATA variable");
  });

  it("embeds base64-encoded payload", async () => {
    const summary = makeSummary([makeResult("case-a", true)]);

    const payload = await decodePayload(summary);

    assert.equal(payload.summary.total, 1);
    assert.equal(payload.summary.passed, 1);
    assert.equal(payload.cases.length, 1);
    assert.equal(payload.cases[0].result.case_id, "case-a");
    assert.ok(payload.generated_at, "should have generated timestamp");
    assert.ok(payload.summary.metrics_summary, "should have metrics summary");
  });

  it("renders v3 html report with embedded payload", async () => {
    const summary = makeSummary([makeResult("case-v3", true)]);
    const html = await renderRunHtmlReportV3(summary);

    assert.ok(html.includes("<!DOCTYPE html>"), "should include doctype");
    assert.ok(html.includes("class=\"case-list\""), "should include case list");

    const match = html.match(/const REPORT_DATA = "([^"]+)";/);
    assert.ok(match, "should have REPORT_DATA assignment");
    const base64Data = match[1];
    assert.ok(base64Data, "should capture payload");
    const decoded = Buffer.from(base64Data, "base64").toString("utf8");
    const payload = JSON.parse(decoded);

    assert.equal(payload.summary.total, 1);
    assert.equal(payload.cases[0].result.case_id, "case-v3");
  });

  it("prefers first user message as report title", async () => {
    const result = makeResult("case-title", true);
    result.description = "fallback description";
    result.trace.conversation = [{ role: "user", content: "filled user prompt" }];

    const payload = await decodePayload(makeSummary([result]));
    assert.equal(payload.cases[0].title, "filled user prompt");
  });

  it("falls back to result description when user message is missing", async () => {
    const result = makeResult("case-title-fallback", true);
    result.description = "human readable description";

    const payload = await decodePayload(makeSummary([result]));
    assert.equal(payload.cases[0].title, "human readable description");
  });

  it("includes all case details in payload", async () => {
    const result = makeResult("case-with-details", false, "timeout error");
    result.dimensions = [
      {
        dimension: "llm_judge",
        passed: false,
        score: 0.3,
        reason: "Response was incomplete",
      },
    ];
    result.trace.tools_called = [
      {
        tool_call_id: "tool-1",
        name: "make_image_v1",
        arguments: { prompt: "draw a cat" },
        output: JSON.stringify({ result: "ok" }),
        duration_ms: 1500,
      },
    ];
    result.trace.final_response = "Here is your image";

    const payload = await decodePayload(makeSummary([result]));
    const caseData = payload.cases[0];

    assert.equal(caseData.result.case_id, "case-with-details");
    assert.equal(caseData.result.passed, false);
    assert.equal(caseData.result.error, "timeout error");
    assert.equal(caseData.result.dimensions.length, 1);
    assert.equal(caseData.result.dimensions[0].dimension, "llm_judge");
    assert.equal(caseData.result.dimensions[0].score, 0.3);
    assert.equal(caseData.result.trace.tools_called.length, 1);
    assert.equal(caseData.result.trace.tools_called[0].name, "make_image_v1");
    assert.equal(caseData.result.trace.final_response, "Here is your image");
  });

  it("normalizes conversation and tool calls by id", async () => {
    const result = makeResult("case-tools", true);
    result.trace.conversation = [
      {
        role: "assistant",
        content: "Making an image",
        tool_calls: [
          {
            id: "call-a",
            type: "function",
            function: {
              name: "make_image_v1",
              arguments: JSON.stringify({ prompt: "cat" }),
            },
          },
        ],
      },
      {
        role: "tool",
        content: "{}",
        tool_call_id: "call-a",
      },
    ];
    result.trace.tools_called = [
      {
        tool_call_id: "call-b",
        name: "other_tool",
        arguments: { source: "alt" },
        output: { url: "https://cdn.example.com/alt.mp4", modality: "VIDEO" },
        duration_ms: 20,
      },
      {
        tool_call_id: "call-a",
        name: "make_image_v1",
        arguments: { prompt: "cat" },
        output: [
          {
            type: "text",
            text: JSON.stringify({
              msg: "",
              err_msg: null,
              task_status: "SUCCESS",
              artifacts: [
                {
                  uuid: "img-1",
                  url: "https://cdn.example.com/cat.webp",
                  modality: "PICTURE",
                  status: "SUCCESS",
                },
              ],
            }),
          },
        ],
        duration_ms: 50,
      },
    ];

    const payload = await decodePayload(makeSummary([result]));
    const caseData = payload.cases[0];

    assert.equal(caseData.conversation[0].role, "assistant");
    assert.equal(caseData.conversation[1].role, "tool");
    assert.equal(caseData.conversation[0].tool_calls[0].name, "make_image_v1");
    assert.equal(caseData.conversation[1].tool.name, "make_image_v1");
    assert.equal(
      caseData.conversation[1].tool.media[0].url,
      "https://cdn.example.com/cat.webp",
    );
    assert.equal(caseData.tool_calls[1].tool_call_id, "call-a");
  });

  it("handles empty results", async () => {
    const summary: EvalSummary = {
      total: 0,
      passed: 0,
      failed: 0,
      errored: 0,
      duration_ms: 0,
      results: [],
    };

    const payload = await decodePayload(summary);

    assert.equal(payload.summary.total, 0);
    assert.equal(payload.cases.length, 0);
  });

  it("includes correct status counts", async () => {
    const summary = makeSummary([
      makeResult("pass-1", true),
      makeResult("pass-2", true),
      makeResult("fail-1", false),
      makeResult("error-1", false, "runtime error"),
    ]);

    const payload = await decodePayload(summary);

    assert.equal(payload.summary.total, 4);
    assert.equal(payload.summary.passed, 2);
    assert.equal(payload.summary.failed, 1);
    assert.equal(payload.summary.errored, 1);
  });
});

async function decodePayload(summary: EvalSummary) {
  const html = await renderRunHtmlReport(summary);
  const match = html.match(/const REPORT_DATA = "([^"]+)";/);
  assert.ok(match, "should have REPORT_DATA assignment");
  const base64Data = match[1];
  assert.ok(base64Data);
  const decoded = Buffer.from(base64Data, "base64").toString("utf8");
  return JSON.parse(decoded);
}

function makeSummary(results: EvalResult[]): EvalSummary {
  const passed = results.filter((r) => r.passed).length;
  const errored = results.filter((r) => r.error).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed - errored,
    errored,
    duration_ms: results.reduce((sum, r) => sum + r.trace.duration_ms, 0),
    results,
  };
}

function makeResult(
  caseId: string,
  passed: boolean,
  error?: string,
): EvalResult {
  return {
    case_id: caseId,
    case_type: "plain",
    passed,
    dimensions: [],
    trace: {
      case_id: caseId,
      case_type: "plain",
      conversation: [],
      tools_called: [],
      final_response: null,
      status: error ? "error" : passed ? "success" : "failure",
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      duration_ms: 1000,
    },
    ...(error ? { error } : {}),
  };
}
