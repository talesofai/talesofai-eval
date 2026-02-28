import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderMatrixGrid } from "../reporter/terminal.ts";
import type { EvalResult, EvalTrace, MatrixSummary } from "../types.ts";

describe("matrix grid", () => {
  it("empty summary returns empty string", () => {
    const summary: MatrixSummary = {
      variants: [],
      case_ids: [],
      cells: [],
      total: 0,
      passed: 0,
      failed: 0,
      errored: 0,
      duration_ms: 0,
    };

    assert.equal(renderMatrixGrid(summary), "");
  });

  it("long variant label keeps alignment", () => {
    const label = "very-long-variant-name";
    const summary: MatrixSummary = {
      variants: [label],
      case_ids: ["case-a"],
      cells: [
        {
          case_id: "case-a",
          variant_label: label,
          result: makeResult("case-a", true),
        },
      ],
      total: 1,
      passed: 1,
      failed: 0,
      errored: 0,
      duration_ms: 10,
    };

    const grid = stripAnsi(renderMatrixGrid(summary));
    const lines = grid.split("\n").filter((line) => line.length > 0);
    const widths = new Set(lines.map((line) => line.length));
    assert.equal(widths.size, 1);
    assert.ok(lines[1]?.includes(`PASS${" ".repeat(label.length - 4)}`));
  });

  it("short variant label still uses min width PASS(4)", () => {
    const summary: MatrixSummary = {
      variants: ["v1"],
      case_ids: ["case-a"],
      cells: [
        {
          case_id: "case-a",
          variant_label: "v1",
          result: makeResult("case-a", true),
        },
      ],
      total: 1,
      passed: 1,
      failed: 0,
      errored: 0,
      duration_ms: 10,
    };

    const grid = stripAnsi(renderMatrixGrid(summary));
    const lines = grid.split("\n").filter((line) => line.length > 0);
    assert.ok(lines[0]?.includes("v1  "));
    assert.ok(lines[1]?.includes("PASS"));
  });

  it("llm_judge cell shows score", () => {
    const result: EvalResult = {
      case_id: "case-a",
      case_type: "plain",
      passed: true,
      dimensions: [
        {
          dimension: "llm_judge",
          passed: true,
          score: 0.92,
          reason: "good",
        },
      ],
      trace: makeTrace("case-a"),
    };

    const summary: MatrixSummary = {
      variants: ["v1"],
      case_ids: ["case-a"],
      cells: [{ case_id: "case-a", variant_label: "v1", result }],
      total: 1,
      passed: 1,
      failed: 0,
      errored: 0,
      duration_ms: 10,
    };

    const grid = stripAnsi(renderMatrixGrid(summary));
    assert.ok(grid.includes("0.92"));
    assert.equal(grid.includes("PASS"), false);
  });
});

function makeTrace(caseId: string): EvalTrace {
  return {
    case_id: caseId,
    case_type: "plain",
    conversation: [],
    tools_called: [],
    final_response: null,
    status: "success",
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
    duration_ms: 100,
  };
}

function makeResult(caseId: string, passed: boolean): EvalResult {
  return {
    case_id: caseId,
    case_type: "plain",
    passed,
    dimensions: [],
    trace: makeTrace(caseId),
  };
}

function stripAnsi(input: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape codes include the ESC control character.
  return input.replace(/\x1B\[[0-9;]*m/g, "");
}
