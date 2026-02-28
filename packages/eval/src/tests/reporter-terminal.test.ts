import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTerminalMatrixReporter,
  createTerminalReporter,
  formatToolArguments,
  formatToolReturnForLlm,
  humanize,
  MAX_STR_CHARS,
  renderMatrixGrid,
  renderRunGrid,
  renderRunMarkdownReport,
} from "../reporter/terminal.ts";
import type { EvalResult, EvalTrace, MatrixSummary } from "../types.ts";

describe("terminal reporter humanize", () => {
  it("truncates long strings by default", () => {
    const long = "x".repeat(MAX_STR_CHARS + 25);
    const rendered = humanize(long);
    assert.equal(rendered, `${"x".repeat(MAX_STR_CHARS)}…`);
  });

  it("does not truncate long strings in verbose mode", () => {
    const long = "x".repeat(MAX_STR_CHARS + 25);
    const rendered = humanize(long, 0, { verbose: true });
    assert.equal(rendered, long);
  });

  it("applies truncation to tool arguments in non-verbose mode", () => {
    const long = "y".repeat(MAX_STR_CHARS + 5);
    const rendered = formatToolArguments({ prompt: long }, false);
    assert.match(rendered, new RegExp(`prompt: y{${MAX_STR_CHARS}}…`));
  });

  it("keeps full tool return text in verbose mode", () => {
    const long = "z".repeat(MAX_STR_CHARS + 5);
    const output = JSON.stringify({ structuredContent: { text: long } });
    const rendered = formatToolReturnForLlm(output, true);
    assert.match(rendered, new RegExp(`text: z{${MAX_STR_CHARS + 5}}`));
  });
});

describe("createTerminalReporter compact mode", () => {
  it("concurrency=1: onDelta writes assistant-prefixed output", () => {
    const reporter = createTerminalReporter({ concurrency: 1 });
    const output = captureStderr(() => {
      reporter.onDelta("hello");
    });
    assert.equal(stripAnsi(output), "  assistant hello");
  });

  it("concurrency=2: onDelta suppressed", () => {
    const reporter = createTerminalReporter({ concurrency: 2 });
    const output = captureStderr(() => {
      reporter.onDelta("hello");
    });
    assert.equal(output, "");
  });

  it("concurrency=2: onToolStart suppressed", () => {
    const reporter = createTerminalReporter({ concurrency: 2 });
    const output = captureStderr(() => {
      reporter.onToolStart({ name: "tool", arguments: {} });
    });
    assert.equal(output, "");
  });

  it("concurrency=2: onToolCall suppressed", () => {
    const reporter = createTerminalReporter({ concurrency: 2 });
    const output = captureStderr(() => {
      reporter.onToolCall({
        tool_call_id: "tool-0",
        name: "tool",
        arguments: {},
        output: null,
        duration_ms: 10,
      });
    });
    assert.equal(output, "");
  });

  it("concurrency=2: onCaseStart includes elapsed timer", () => {
    const reporter = createTerminalReporter({ concurrency: 2 });
    const output = captureStderr(() => {
      reporter.onCaseStart(
        {
          type: "agent",
          id: "case-timer",
          description: "case",
          input: {
            preset_key: "preset",
            parameters: {},
            messages: [{ role: "user", content: "hi" }],
          },
          criteria: {},
        },
        0,
        1,
      );
    });

    assert.match(stripAnsi(output), /running\.\.\. \(0s\)/);
  });

  it("shows heartbeat for long-running tool call", async () => {
    const reporter = createTerminalReporter({
      concurrency: 1,
      heartbeatIntervalMs: 5,
    });

    const output = await captureStderrAsync(async () => {
      reporter.onToolStart({ name: "make_image_v1", arguments: {} });
      await wait(20);
      reporter.onToolCall({
        tool_call_id: "tool-1",
        name: "make_image_v1",
        arguments: {},
        output: null,
        duration_ms: 100,
      });
    });

    assert.match(stripAnsi(output), /still running/);
  });
});

describe("createTerminalReporter metrics", () => {
  it("adds concise metrics line for each case in non-compact mode", () => {
    const reporter = createTerminalReporter({ concurrency: 1 });
    const result = makeResult("case-metrics", true);
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
        duration_ms: 100,
      },
    ];
    result.trace.final_response = "https://cdn.example.com/a.webp";

    const output = captureStderr(() => {
      reporter.onCaseStart(
        {
          type: "plain",
          id: "case-metrics",
          description: "case",
          input: {
            system_prompt: "sys",
            model: "qwen-plus",
            messages: [{ role: "user", content: "hi" }],
          },
          criteria: {},
        },
        0,
        1,
      );
      reporter.onCaseResult(result);
    });

    const plain = stripAnsi(output);
    assert.match(
      plain,
      /metrics:\s*\|\s*tools 1 \(errors 0, retries 0\)\s*\|\s*artifacts picture 1, video 0\s*\|\s*bindings 0\s*\|\s*delivered yes/,
    );
  });

  it("prints image markdown hint for terminal users", () => {
    const reporter = createTerminalReporter({ concurrency: 1 });
    const result = makeResult("case-image", true);
    result.trace.final_response =
      "![洛天依的伪物图鉴](https://cdn.example.com/luo.webp)";

    const output = captureStderr(() => {
      reporter.onCaseStart(
        {
          type: "plain",
          id: "case-image",
          description: "case",
          input: {
            system_prompt: "sys",
            model: "qwen-plus",
            messages: [{ role: "user", content: "hi" }],
          },
          criteria: {},
        },
        0,
        1,
      );
      reporter.onCaseResult(result);
    });

    const plain = stripAnsi(output);
    assert.match(plain, /image markdown detected/i);
    assert.match(plain, /Cmd\/Ctrl\+Click/);
    assert.match(plain, /https:\/\/cdn\.example\.com\/luo\.webp/);
  });
});

describe("renderRunGrid", () => {
  it("renders aligned run summary table", () => {
    const summary = {
      total: 2,
      passed: 1,
      failed: 1,
      errored: 0,
      duration_ms: 3000,
      results: [makeResult("case-pass", true), makeResult("case-fail", false)],
    };

    const grid = stripAnsi(renderRunGrid(summary));
    const lines = grid.split("\n").filter((line) => line.length > 0);
    assert.ok(lines[0]?.includes("case"));
    assert.ok(lines[0]?.includes("status"));
    assert.ok(lines[0]?.includes("judge"));

    const widths = new Set(lines.map((line) => line.length));
    assert.equal(widths.size, 1);
    assert.ok(lines[1]?.includes("PASS"));
    assert.ok(lines[2]?.includes("FAIL"));
  });

  it("includes llm_judge reason and error detail", () => {
    const judgeResult: EvalResult = {
      case_id: "case-judge",
      case_type: "plain",
      passed: false,
      dimensions: [
        {
          dimension: "llm_judge",
          passed: false,
          score: 0.2,
          reason: "judge says response misses key requirement",
        },
      ],
      trace: makeTrace("case-judge"),
    };

    const errorResult = makeResult(
      "case-error",
      false,
      "request timeout from upstream",
    );

    const summary = {
      total: 2,
      passed: 0,
      failed: 1,
      errored: 1,
      duration_ms: 3000,
      results: [judgeResult, errorResult],
    };

    const grid = stripAnsi(renderRunGrid(summary));
    assert.match(grid, /judge says response misses key requirement/);
    assert.match(grid, /request timeout from upstream/);
  });

  it("renderRunMarkdownReport includes full detail without truncation", () => {
    const longReason = "judge reason ".repeat(20);
    const judgeResult: EvalResult = {
      case_id: "case-judge",
      case_type: "plain",
      passed: false,
      dimensions: [
        {
          dimension: "llm_judge",
          passed: false,
          score: 0.2,
          reason: longReason,
        },
      ],
      trace: makeTrace("case-judge"),
    };

    const summary = {
      total: 1,
      passed: 0,
      failed: 1,
      errored: 0,
      duration_ms: 1000,
      results: [judgeResult],
    };

    const md = renderRunMarkdownReport(summary);
    assert.match(md, /# agent-eval run report/);
    assert.match(
      md,
      /\| case \| status \| judge \| duration \| tokens \| detail \|/,
    );
    assert.match(md, /case-judge/);
    assert.ok(md.includes(longReason));
    assert.equal(md.includes("…"), false);
    assert.match(md, /## Metrics Summary/);
  });

  it("onSummary includes grid when summary has multiple cases", () => {
    const reporter = createTerminalReporter({ concurrency: 8 });
    const summary = {
      total: 2,
      passed: 1,
      failed: 1,
      errored: 0,
      duration_ms: 2500,
      results: [makeResult("case-a", true), makeResult("case-b", false)],
    };

    const output = captureStderr(() => {
      reporter.onSummary(summary);
    });

    const plain = stripAnsi(output);
    assert.match(plain, /case\s+status\s+judge\s+duration\s+tokens/);
    assert.match(plain, /case-a\s+PASS/);
    assert.match(plain, /case-b\s+FAIL/);
  });
});

describe("createTerminalMatrixReporter", () => {
  it("prints elapsed timer in running row", () => {
    const reporter = createTerminalMatrixReporter({
      compactRefreshIntervalMs: 0,
    });

    const output = captureStderr(() => {
      reporter.onCellStart("case-a", "v1", 0, 2);
    });

    assert.match(stripAnsi(output), /running\.\.\. \(0s\)/);
  });

  it("marks errored cell as ERR", () => {
    const reporter = createTerminalMatrixReporter({
      compactRefreshIntervalMs: 0,
    });

    const output = captureStderr(() => {
      reporter.onCellStart("case-a", "v1", 0, 1);
      reporter.onCellResult({
        case_id: "case-a",
        variant_label: "v1",
        result: makeResult("case-a", false, "timeout"),
      });
    });

    assert.match(stripAnsi(output), /\bERR\b/);
  });
});

describe("renderMatrixGrid", () => {
  it("renders aligned rows for 2x2", () => {
    const summary: MatrixSummary = {
      variants: ["v1", "v2"],
      case_ids: ["case-a", "case-b"],
      cells: [
        {
          case_id: "case-a",
          variant_label: "v1",
          result: makeResult("case-a", true),
        },
        {
          case_id: "case-a",
          variant_label: "v2",
          result: makeResult("case-a", false),
        },
        {
          case_id: "case-b",
          variant_label: "v1",
          result: makeResult("case-b", true),
        },
        {
          case_id: "case-b",
          variant_label: "v2",
          result: makeResult("case-b", true),
        },
      ],
      total: 4,
      passed: 3,
      failed: 1,
      errored: 0,
      duration_ms: 1000,
    };

    const grid = stripAnsi(renderMatrixGrid(summary));
    const lines = grid.split("\n").filter((line) => line.length > 0);
    const widths = new Set(lines.map((line) => line.length));

    assert.equal(widths.size, 1);
    assert.ok(lines[0]?.includes("v1"));
    assert.ok(lines[0]?.includes("v2"));
    assert.ok(lines[1]?.startsWith("case-a"));
    assert.ok(lines[1]?.includes("PASS"));
    assert.ok(lines[1]?.includes("FAIL"));
  });

  it("shows llm_judge score when available", () => {
    const resultWithJudge: EvalResult = {
      case_id: "case-a",
      case_type: "plain",
      passed: true,
      dimensions: [
        {
          dimension: "llm_judge",
          passed: true,
          score: 0.87,
          reason: "ok",
        },
      ],
      trace: makeTrace("case-a"),
    };

    const summary: MatrixSummary = {
      variants: ["v1"],
      case_ids: ["case-a"],
      cells: [
        {
          case_id: "case-a",
          variant_label: "v1",
          result: resultWithJudge,
        },
      ],
      total: 1,
      passed: 1,
      failed: 0,
      errored: 0,
      duration_ms: 10,
    };

    const grid = stripAnsi(renderMatrixGrid(summary));
    assert.ok(grid.includes("0.87"));
    assert.equal(grid.includes("PASS"), false);
  });

  it("shows ERR for errored cells", () => {
    const summary: MatrixSummary = {
      variants: ["v1"],
      case_ids: ["case-a"],
      cells: [
        {
          case_id: "case-a",
          variant_label: "v1",
          result: makeResult("case-a", false, "timeout"),
        },
      ],
      total: 1,
      passed: 0,
      failed: 0,
      errored: 1,
      duration_ms: 10,
    };

    const grid = stripAnsi(renderMatrixGrid(summary));
    assert.ok(grid.includes("ERR"));
  });
});

function captureStderr(fn: () => void): string {
  const chunks: string[] = [];
  const originalWrite = process.stderr.write;

  const captureWrite: typeof process.stderr.write = (
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

  process.stderr.write = captureWrite;
  try {
    fn();
  } finally {
    process.stderr.write = originalWrite;
  }

  return chunks.join("");
}

async function captureStderrAsync(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const originalWrite = process.stderr.write;

  const captureWrite: typeof process.stderr.write = (
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

  process.stderr.write = captureWrite;
  try {
    await fn();
  } finally {
    process.stderr.write = originalWrite;
  }

  return chunks.join("");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(input: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape/control sequences include the ESC control character.
  return input.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

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
    trace: makeTrace(caseId),
    ...(error ? { error } : {}),
  };
}
