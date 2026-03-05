import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createJsonMatrixReporter,
  createJsonReporter,
} from "../reporter/json.ts";
import type { EvalSummary, MatrixCell, MatrixSummary, Span } from "../types.ts";

describe("createJsonReporter", () => {
  it("onCaseResult emits stable metrics", () => {
    const reporter = createJsonReporter();
    const output = captureStdout(() => {
      reporter.onCaseResult(makeCell("case-a", "v1", true).result);
    });

    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.type, "result");
    assert.equal(parsed.id, "case-a");
    assert.equal(typeof parsed.metrics.tool_calls_total, "number");
    assert.equal(parsed.metrics.debug, undefined);
  });

  it("verbose mode includes metrics.debug in NDJSON only", () => {
    const reporter = createJsonReporter({ verbose: true });
    const result = makeCell("case-a", "v1", true).result;
    result.trace.tools_called = [
      {
        tool_call_id: "tool-1",
        name: "make_image_v1",
        arguments: { prompt: "draw" },
        output: JSON.stringify({
          structuredContent: {
            task_status: "SUCCESS",
            artifacts: [
              {
                uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                url: "https://cdn.example.com/a.webp",
                modality: "PICTURE",
                status: "SUCCESS",
              },
            ],
          },
        }),
        duration_ms: 12,
      },
    ];

    const output = captureStdout(() => {
      reporter.onCaseResult(result);
    });

    const parsed = JSON.parse(output.trim());
    assert.equal(Array.isArray(parsed.metrics.debug?.artifacts), true);
  });

  it("onSummary emits metrics_summary", () => {
    const reporter = createJsonReporter();
    const summary: EvalSummary = {
      total: 1,
      passed: 1,
      failed: 0,
      errored: 0,
      duration_ms: 10,
      results: [makeCell("case-a", "v1", true).result],
    };

    const output = captureStdout(() => {
      reporter.onSummary(summary);
    });

    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.type, "summary");
    assert.equal(typeof parsed.metrics_summary.avg_tool_calls_total, "number");
  });

  it("onCaseResult includes timing_summary when spans present", () => {
    const reporter = createJsonReporter();
    const result = makeCell("case-a", "v1", true).result;
    const spans: Span[] = [
      {
        name: "mcp_connect",
        kind: "mcp_connect",
        start_ms: 1000,
        end_ms: 1050,
        duration_ms: 50,
      },
      {
        name: "turn_0",
        kind: "llm_turn",
        start_ms: 1100,
        end_ms: 1500,
        duration_ms: 400,
        attributes: { first_token_ms: 1120, input_tokens: 100, output_tokens: 50 },
      },
      {
        name: "tool_make_image_v1_abc",
        kind: "tool_call",
        start_ms: 1510,
        end_ms: 2000,
        duration_ms: 490,
        parent: "turn_0",
        attributes: { tool_call_id: "abc" },
      },
    ];
    result.trace.spans = spans;

    const output = captureStdout(() => {
      reporter.onCaseResult(result);
    });

    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.timing_summary.mcp_connect_ms, 50);
    assert.equal(parsed.timing_summary.llm_total_ms, 400);
    assert.equal(parsed.timing_summary.tool_total_ms, 490);
    assert.equal(parsed.timing_summary.turns_count, 1);
    assert.equal(parsed.timing_summary.llm_first_token_ms, 1120);
  });

  it("verbose mode includes spans array", () => {
    const reporter = createJsonReporter({ verbose: true });
    const result = makeCell("case-a", "v1", true).result;
    const spans: Span[] = [
      {
        name: "turn_0",
        kind: "llm_turn",
        start_ms: 1000,
        end_ms: 1500,
        duration_ms: 500,
      },
    ];
    result.trace.spans = spans;

    const output = captureStdout(() => {
      reporter.onCaseResult(result);
    });

    const parsed = JSON.parse(output.trim());
    assert.ok(Array.isArray(parsed.spans));
    assert.equal(parsed.spans.length, 1);
    assert.equal(parsed.spans[0].name, "turn_0");
  });

  it("non-verbose mode does not include spans array", () => {
    const reporter = createJsonReporter({ verbose: false });
    const result = makeCell("case-a", "v1", true).result;
    result.trace.spans = [
      {
        name: "turn_0",
        kind: "llm_turn",
        start_ms: 1000,
        end_ms: 1500,
        duration_ms: 500,
      },
    ];

    const output = captureStdout(() => {
      reporter.onCaseResult(result);
    });

    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.spans, undefined);
    assert.ok(parsed.timing_summary); // Still has timing summary
  });
});

describe("createJsonMatrixReporter", () => {
  it("onCellStart is silent", () => {
    const reporter = createJsonMatrixReporter();
    const output = captureStdout(() => {
      reporter.onCellStart("case-a", "v1", 0, 1);
    });
    assert.equal(output, "");
  });

  it("onCellResult emits matrix_cell line", () => {
    const reporter = createJsonMatrixReporter();
    const output = captureStdout(() => {
      reporter.onCellResult(makeCell("case-a", "v1", true));
    });

    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.type, "matrix_cell");
    assert.equal(parsed.case_id, "case-a");
    assert.equal(parsed.variant, "v1");
    assert.equal(parsed.passed, true);
    assert.equal(typeof parsed.duration_ms, "number");
    assert.equal(typeof parsed.usage, "object");
    assert.equal(typeof parsed.metrics.tool_calls_total, "number");
  });

  it("onCellResult includes error when present", () => {
    const reporter = createJsonMatrixReporter();
    const output = captureStdout(() => {
      reporter.onCellResult(makeCell("case-a", "v1", false, "timeout"));
    });

    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.error, "timeout");
  });

  it("onMatrixSummary emits matrix_summary line", () => {
    const reporter = createJsonMatrixReporter();
    const summary: MatrixSummary = {
      variants: ["v1", "v2"],
      case_ids: ["case-a"],
      cells: [makeCell("case-a", "v1", true), makeCell("case-a", "v2", false)],
      total: 2,
      passed: 1,
      failed: 1,
      errored: 0,
      duration_ms: 20,
    };

    const output = captureStdout(() => {
      reporter.onMatrixSummary(summary);
    });

    const parsed = JSON.parse(output.trim());
    assert.equal(parsed.type, "matrix_summary");
    assert.deepEqual(parsed.variants, ["v1", "v2"]);
    assert.deepEqual(parsed.case_ids, ["case-a"]);
    assert.equal(parsed.total, 2);
    assert.equal(parsed.passed, 1);
    assert.equal(parsed.failed, 1);
    assert.equal(parsed.errored, 0);
    assert.equal(typeof parsed.metrics_summary.avg_tool_calls_total, "number");
  });
});

function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write;

  const captureWrite: typeof process.stdout.write = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
    callback?: (error: Error | null | undefined) => void,
  ): boolean => {
    const text =
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    chunks.push(text);

    if (typeof encoding === "function") {
      encoding(undefined);
      return true;
    }

    if (callback) {
      callback(undefined);
    }

    return true;
  };

  process.stdout.write = captureWrite;
  try {
    fn();
  } finally {
    process.stdout.write = originalWrite;
  }

  return chunks.join("");
}

function makeCell(
  caseId: string,
  variantLabel: string,
  passed: boolean,
  error?: string,
): MatrixCell {
  return {
    case_id: caseId,
    variant_label: variantLabel,
    result: {
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
        status: "success",
        usage: {
          input_tokens: 1,
          output_tokens: 2,
          total_tokens: 3,
        },
        duration_ms: 10,
      },
      ...(error ? { error } : {}),
    },
  };
}
