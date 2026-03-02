import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { sanitizeCaseId, saveResult } from "../traces.ts";
import type { EvalResult, EvalTrace } from "../types.ts";

const EVAL_ROOT = join(import.meta.dirname, "..", "..");

type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function runCli(args: string[], env?: Record<string, string>): CliResult {
  const proc = spawnSync("node", ["src/cli.ts", ...args], {
    cwd: EVAL_ROOT,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
  });

  return {
    status: proc.status,
    stdout: proc.stdout,
    stderr: proc.stderr,
  };
}

function extractReportPath(stderr: string): string {
  const match = stderr.match(/report:\s+(.+)\n?/);
  if (!match?.[1]) {
    throw new Error(`report path not found in stderr: ${stderr}`);
  }

  return match[1].trim();
}

async function runCliAsync(
  args: string[],
  env?: Record<string, string>,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["src/cli.ts", ...args], {
      cwd: EVAL_ROOT,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const stdoutStream = proc.stdout;
    const stderrStream = proc.stderr;
    if (!stdoutStream || !stderrStream) {
      reject(new Error("failed to capture child stdio"));
      return;
    }

    stdoutStream.setEncoding("utf8");
    stdoutStream.on("data", (chunk: string) => {
      stdout += chunk;
    });

    stderrStream.setEncoding("utf8");
    stderrStream.on("data", (chunk: string) => {
      stderr += chunk;
    });

    proc.on("error", reject);
    proc.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function makeTrace(caseId: string): EvalTrace {
  return {
    case_id: caseId,
    case_type: "plain",
    conversation: [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "ok" },
    ],
    tools_called: [],
    final_response: "ok",
    status: "success",
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    duration_ms: 10,
  };
}

function makeResult(caseId: string): EvalResult {
  return {
    case_id: caseId,
    case_type: "plain",
    passed: true,
    dimensions: [
      {
        dimension: "llm_judge",
        passed: true,
        score: 0.95,
        reason: "cached judge result",
      },
    ],
    trace: makeTrace(caseId),
  };
}

function writeCaseFile(path: string, id: string): void {
  const payload = {
    type: "plain",
    id,
    description: id,
    input: {
      system_prompt: "sys",
      model: "qwen-plus",
      messages: [{ role: "user", content: "hello" }],
      allowed_tool_names: [],
    },
    criteria: {},
  };
  writeFileSync(path, JSON.stringify(payload, null, 2));
}

async function startFakeOpenAiServer(): Promise<{
  baseURL: string;
  close: () => Promise<void>;
}> {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    const firstChunk = {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: "qwen-plus",
      choices: [
        {
          index: 0,
          delta: { content: "hi from fake server" },
          finish_reason: null,
        },
      ],
    };

    const stopChunk = {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: "qwen-plus",
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "stop",
        },
      ],
    };

    const usageChunk = {
      id: "chatcmpl-test",
      object: "chat.completion.chunk",
      created: 0,
      model: "qwen-plus",
      choices: [],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
      },
    };

    res.write(`data: ${JSON.stringify(firstChunk)}\n\n`);
    res.write(`data: ${JSON.stringify(stopChunk)}\n\n`);
    res.write(`data: ${JSON.stringify(usageChunk)}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      reject(error);
    };

    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start fake openai server");
  }

  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

describe("agent-eval replay mode", () => {
  it("records trace files with --record", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "agent-eval-record-"));
    const fake = await startFakeOpenAiServer();

    try {
      const recordDir = join(tempRoot, "traces");
      const caseId = "record-case";
      const inlineCase = JSON.stringify({
        type: "plain",
        id: caseId,
        description: "record test",
        input: {
          system_prompt: "sys",
          model: "qwen-plus",
          messages: [{ role: "user", content: "hello" }],
          allowed_tool_names: [],
        },
        criteria: {},
      });

      const result = await runCliAsync(
        ["run", "--inline", inlineCase, "--record", recordDir],
        {
          OPENAI_BASE_URL: fake.baseURL,
          OPENAI_API_KEY: "test-key",
          EVAL_MCP_SERVER_BASE_URL: "",
          EVAL_UPSTREAM_API_BASE_URL: "",
        },
      );

      assert.equal(result.status, 0);
      const tracePath = join(recordDir, `${sanitizeCaseId(caseId)}.trace.json`);
      const raw = readFileSync(tracePath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) {
        throw new Error("recorded trace must be an object");
      }
      assert.equal(parsed["case_id"], caseId);
      assert.equal(parsed["case_type"], "plain");
      assert.equal(typeof parsed["final_response"], "string");
    } finally {
      await fake.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("generates both markdown and HTML reports with --record", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "agent-eval-record-"));
    const fake = await startFakeOpenAiServer();

    try {
      const recordDir = join(tempRoot, "traces");
      const caseId = "record-case-html";
      const inlineCase = JSON.stringify({
        type: "plain",
        id: caseId,
        description: "record test for html report",
        input: {
          system_prompt: "sys",
          model: "qwen-plus",
          messages: [{ role: "user", content: "hello" }],
          allowed_tool_names: [],
        },
        criteria: {},
      });

      const result = await runCliAsync(
        ["run", "--inline", inlineCase, "--record", recordDir],
        {
          OPENAI_BASE_URL: fake.baseURL,
          OPENAI_API_KEY: "test-key",
          EVAL_MCP_SERVER_BASE_URL: "",
          EVAL_UPSTREAM_API_BASE_URL: "",
        },
      );

      assert.equal(result.status, 0);

      // Check markdown report exists
      const mdPath = join(recordDir, "run-report.md");
      assert.ok(existsSync(mdPath), "markdown report should exist");

      // Check HTML report exists
      const htmlPath = join(recordDir, "run-report.html");
      assert.ok(existsSync(htmlPath), "HTML report should exist");

      // Verify HTML report content
      const htmlContent = readFileSync(htmlPath, "utf8");
      assert.ok(
        htmlContent.includes("<!DOCTYPE html>"),
        "should be valid HTML",
      );
      assert.ok(
        htmlContent.includes("REPORT_DATA"),
        "should have embedded data",
      );

      // Verify the embedded data is valid base64 and contains case data
      const match = htmlContent.match(/const REPORT_DATA = "([^"]+)";/);
      assert.ok(match, "should have REPORT_DATA variable");
      const base64Data = match[1];
      assert.ok(base64Data);
      const decoded = Buffer.from(base64Data, "base64").toString("utf8");
      const payload = JSON.parse(decoded);
      assert.equal(payload.summary.total, 1);
      assert.equal(payload.cases[0].result.case_id, caseId);
    } finally {
      await fake.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not generate HTML report when all cases fail", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "agent-eval-record-all-fail-"));
    const fake = await startFakeOpenAiServer();

    try {
      const recordDir = join(tempRoot, "traces");
      const caseId = "record-case-all-fail";
      const inlineCase = JSON.stringify({
        type: "plain",
        id: caseId,
        description: "record test for all failed",
        input: {
          system_prompt: "sys",
          model: "qwen-plus",
          messages: [{ role: "user", content: "hello" }],
          allowed_tool_names: [],
        },
        criteria: {
          expected_status: "FAILURE",
        },
      });

      const result = await runCliAsync(
        ["run", "--inline", inlineCase, "--record", recordDir],
        {
          OPENAI_BASE_URL: fake.baseURL,
          OPENAI_API_KEY: "test-key",
          EVAL_MCP_SERVER_BASE_URL: "",
          EVAL_UPSTREAM_API_BASE_URL: "",
        },
      );

      assert.equal(result.status, 1);

      const mdPath = join(recordDir, "run-report.md");
      assert.ok(existsSync(mdPath), "markdown report should still exist");

      const htmlPath = join(recordDir, "run-report.html");
      assert.equal(
        existsSync(htmlPath),
        false,
        "HTML report should be skipped",
      );
    } finally {
      await fake.close();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("replays from trace files without requiring runner config for judge-free cases", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "agent-eval-replay-"));

    try {
      const replayDir = join(tempRoot, "traces");
      mkdirSync(replayDir, { recursive: true });

      const caseId = "replay-offline-case";
      const inlineCase = JSON.stringify({
        type: "plain",
        id: caseId,
        description: "replay offline",
        input: {
          system_prompt: "sys",
          model: "qwen-plus",
          messages: [{ role: "user", content: "hello" }],
          allowed_tool_names: [],
        },
        criteria: {},
      });

      const tracePath = join(replayDir, `${sanitizeCaseId(caseId)}.trace.json`);
      writeFileSync(tracePath, JSON.stringify(makeTrace(caseId), null, 2));

      const result = runCli(
        ["run", "--inline", inlineCase, "--replay", replayDir],
        {
          OPENAI_BASE_URL: "",
          OPENAI_API_KEY: "",
          EVAL_MCP_SERVER_BASE_URL: "",
          EVAL_UPSTREAM_API_BASE_URL: "",
        },
      );

      assert.equal(result.status, 0);
      assert.doesNotMatch(result.stderr, /E_MISSING_CONFIG/);
      assert.match(result.stderr, /1 passed/);

      const reportPath = extractReportPath(result.stderr);
      assert.match(reportPath, /\.eval-records\/replay-/);

      const report = readFileSync(reportPath, "utf8");
      assert.match(report, /# agent-eval run report/);
      assert.match(
        report,
        /\| case \| status \| judge \| duration \| tokens \| detail \|/,
      );
      assert.match(report, /replay-offline-case/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("defaults concurrency to case count (capped at 8) when flag is omitted", () => {
    const tempRoot = mkdtempSync(
      join(tmpdir(), "agent-eval-replay-concurrency-"),
    );

    try {
      const replayDir = join(tempRoot, "traces");
      const casesDir = join(tempRoot, "cases");
      mkdirSync(replayDir, { recursive: true });
      mkdirSync(casesDir, { recursive: true });

      const caseA = "replay-concurrency-a";
      const caseB = "replay-concurrency-b";
      writeCaseFile(join(casesDir, `${caseA}.json`), caseA);
      writeCaseFile(join(casesDir, `${caseB}.json`), caseB);
      writeFileSync(
        join(replayDir, `${sanitizeCaseId(caseA)}.trace.json`),
        JSON.stringify(makeTrace(caseA), null, 2),
      );
      writeFileSync(
        join(replayDir, `${sanitizeCaseId(caseB)}.trace.json`),
        JSON.stringify(makeTrace(caseB), null, 2),
      );

      const result = runCli(
        ["run", "--file", join(casesDir, "*.json"), "--replay", replayDir],
        {
          OPENAI_BASE_URL: "",
          OPENAI_API_KEY: "",
          EVAL_MCP_SERVER_BASE_URL: "",
          EVAL_UPSTREAM_API_BASE_URL: "",
        },
      );

      assert.equal(result.status, 0);
      assert.match(result.stderr, /running\.\.\./);
      assert.match(result.stderr, /\[1\/2\]/);
      assert.match(result.stderr, /\[2\/2\]/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("replay uses cached result and skips judge env requirement", async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "agent-eval-replay-cache-"));

    try {
      const replayDir = join(tempRoot, "traces");
      mkdirSync(replayDir, { recursive: true });

      const caseId = "replay-cache-case";
      const inlineCase = JSON.stringify({
        type: "plain",
        id: caseId,
        description: "replay cache",
        input: {
          system_prompt: "sys",
          model: "qwen-plus",
          messages: [{ role: "user", content: "hello" }],
          allowed_tool_names: [],
        },
        criteria: {
          llm_judge: {
            prompt: "judge",
            pass_threshold: 0.7,
          },
        },
      });

      const tracePath = join(replayDir, `${sanitizeCaseId(caseId)}.trace.json`);
      writeFileSync(tracePath, JSON.stringify(makeTrace(caseId), null, 2));
      await saveResult(makeResult(caseId), replayDir);

      const result = runCli(
        ["run", "--inline", inlineCase, "--replay", replayDir],
        {
          OPENAI_BASE_URL: "",
          OPENAI_API_KEY: "",
          EVAL_JUDGE_BASE_URL: "",
          EVAL_JUDGE_API_KEY: "",
          EVAL_MCP_SERVER_BASE_URL: "",
          EVAL_UPSTREAM_API_BASE_URL: "",
        },
      );

      assert.equal(result.status, 0);
      assert.doesNotMatch(result.stderr, /E_MISSING_CONFIG/);
      assert.match(result.stderr, /1 passed/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("replay cache-miss with llm_judge and missing model returns error result (no score-0 dimension)", () => {
    const tempRoot = mkdtempSync(
      join(tmpdir(), "agent-eval-replay-judge-miss-"),
    );

    try {
      const replayDir = join(tempRoot, "traces");
      mkdirSync(replayDir, { recursive: true });

      const caseId = "replay-judge-miss-case";
      const inlineCase = JSON.stringify({
        type: "plain",
        id: caseId,
        description: "replay judge miss",
        input: {
          system_prompt: "sys",
          model: "qwen-plus",
          messages: [{ role: "user", content: "hello" }],
          allowed_tool_names: [],
        },
        criteria: {
          assertions: [
            {
              type: "llm_judge",
              prompt: "judge",
              pass_threshold: 0.7,
            },
          ],
        },
      });

      writeFileSync(
        join(replayDir, `${sanitizeCaseId(caseId)}.trace.json`),
        JSON.stringify(makeTrace(caseId), null, 2),
      );

      const result = runCli(
        [
          "run",
          "--inline",
          inlineCase,
          "--replay",
          replayDir,
          "--format",
          "json",
        ],
        {
          OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
          OPENAI_API_KEY: "test-key",
          EVAL_JUDGE_BASE_URL: "",
          EVAL_JUDGE_API_KEY: "",
          EVAL_JUDGE_MODEL: "",
          EVAL_MCP_SERVER_BASE_URL: "",
          EVAL_UPSTREAM_API_BASE_URL: "",
        },
      );

      assert.equal(result.status, 2);
      assert.doesNotMatch(result.stderr, /E_MISSING_CONFIG/);

      const lines = result.stdout
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              return [parsed as Record<string, unknown>];
            }
          } catch {
            // ignore non-json noise in stdout (e.g. dotenv notices)
          }
          return [];
        });

      const caseResult = lines.find((line) => line["type"] === "result");
      assert.ok(caseResult, "should output result line in json mode");
      assert.equal(caseResult?.["passed"], false);
      assert.deepEqual(caseResult?.["dimensions"], []);
      assert.equal(typeof caseResult?.["error"], "string");
      assert.match(String(caseResult?.["error"]), /Replay cache miss/);
      assert.match(String(caseResult?.["error"]), /EVAL_JUDGE_MODEL/);

      const summary = lines.find((line) => line["type"] === "summary");
      assert.ok(summary, "should output summary line in json mode");
      assert.equal(summary?.["errored"], 1);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("replay applies --tier-max and skips judge requirement for filtered judge assertions", () => {
    const tempRoot = mkdtempSync(
      join(tmpdir(), "agent-eval-replay-tiermax-filter-"),
    );

    try {
      const replayDir = join(tempRoot, "traces");
      mkdirSync(replayDir, { recursive: true });

      const caseId = "replay-tiermax-filter-case";
      const inlineCase = JSON.stringify({
        type: "plain",
        id: caseId,
        description: "replay tiermax filter",
        input: {
          system_prompt: "sys",
          model: "qwen-plus",
          messages: [{ role: "user", content: "hello" }],
          allowed_tool_names: [],
        },
        criteria: {
          assertions: [
            {
              type: "final_status",
              tier: 1,
              expected_status: "SUCCESS",
            },
            {
              type: "llm_judge",
              tier: 2,
              prompt: "judge",
              pass_threshold: 0.7,
            },
          ],
        },
      });

      writeFileSync(
        join(replayDir, `${sanitizeCaseId(caseId)}.trace.json`),
        JSON.stringify(makeTrace(caseId), null, 2),
      );

      const result = runCli(
        [
          "run",
          "--inline",
          inlineCase,
          "--replay",
          replayDir,
          "--tier-max",
          "1",
          "--format",
          "json",
        ],
        {
          OPENAI_BASE_URL: "",
          OPENAI_API_KEY: "",
          EVAL_JUDGE_BASE_URL: "",
          EVAL_JUDGE_API_KEY: "",
          EVAL_JUDGE_MODEL: "",
          EVAL_MCP_SERVER_BASE_URL: "",
          EVAL_UPSTREAM_API_BASE_URL: "",
        },
      );

      assert.equal(result.status, 0);
      assert.doesNotMatch(result.stderr, /Replay cache miss/);
      assert.doesNotMatch(result.stderr, /E_MISSING_CONFIG/);

      const lines = result.stdout
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line) as unknown;
            if (
              parsed &&
              typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              return [parsed as Record<string, unknown>];
            }
          } catch {
            // ignore non-json noise in stdout (e.g. dotenv notices)
          }
          return [];
        });

      const caseResult = lines.find((line) => line["type"] === "result");
      assert.ok(caseResult, "should output result line in json mode");
      assert.equal(caseResult?.["passed"], true);

      const dimensions = Array.isArray(caseResult?.["dimensions"])
        ? caseResult["dimensions"]
        : [];
      const dimensionNames = dimensions
        .map((d) =>
          d && typeof d === "object" && !Array.isArray(d)
            ? String((d as Record<string, unknown>)["dimension"])
            : "",
        )
        .filter(Boolean);

      assert.deepEqual(dimensionNames, ["final_status"]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("replay is read-only by default when cached result has no metrics", async () => {
    const tempRoot = mkdtempSync(
      join(tmpdir(), "agent-eval-replay-readonly-metrics-"),
    );

    try {
      const replayDir = join(tempRoot, "traces");
      mkdirSync(replayDir, { recursive: true });

      const caseId = "replay-readonly-metrics-case";
      const inlineCase = JSON.stringify({
        type: "plain",
        id: caseId,
        description: "replay readonly metrics",
        input: {
          system_prompt: "sys",
          model: "qwen-plus",
          messages: [{ role: "user", content: "hello" }],
          allowed_tool_names: [],
        },
        criteria: {},
      });

      writeFileSync(
        join(replayDir, `${sanitizeCaseId(caseId)}.trace.json`),
        JSON.stringify(makeTrace(caseId), null, 2),
      );
      await saveResult(makeResult(caseId), replayDir);

      const cliResult = runCli(
        ["run", "--inline", inlineCase, "--replay", replayDir],
        {
          OPENAI_BASE_URL: "",
          OPENAI_API_KEY: "",
          EVAL_MCP_SERVER_BASE_URL: "",
          EVAL_UPSTREAM_API_BASE_URL: "",
        },
      );

      assert.equal(cliResult.status, 0);

      const cached = JSON.parse(
        readFileSync(
          join(replayDir, `${sanitizeCaseId(caseId)}.result.json`),
          "utf8",
        ),
      ) as unknown;

      if (!isRecord(cached)) {
        throw new Error("cached result must be an object");
      }

      assert.equal("metrics" in cached, false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("--replay-write-metrics backfills metrics into cached result", async () => {
    const tempRoot = mkdtempSync(
      join(tmpdir(), "agent-eval-replay-writeback-metrics-"),
    );

    try {
      const replayDir = join(tempRoot, "traces");
      mkdirSync(replayDir, { recursive: true });

      const caseId = "replay-writeback-metrics-case";
      const inlineCase = JSON.stringify({
        type: "plain",
        id: caseId,
        description: "replay writeback metrics",
        input: {
          system_prompt: "sys",
          model: "qwen-plus",
          messages: [{ role: "user", content: "hello" }],
          allowed_tool_names: [],
        },
        criteria: {},
      });

      writeFileSync(
        join(replayDir, `${sanitizeCaseId(caseId)}.trace.json`),
        JSON.stringify(makeTrace(caseId), null, 2),
      );
      await saveResult(makeResult(caseId), replayDir);

      const cliResult = runCli(
        [
          "run",
          "--inline",
          inlineCase,
          "--replay",
          replayDir,
          "--replay-write-metrics",
        ],
        {
          OPENAI_BASE_URL: "",
          OPENAI_API_KEY: "",
          EVAL_MCP_SERVER_BASE_URL: "",
          EVAL_UPSTREAM_API_BASE_URL: "",
        },
      );

      assert.equal(cliResult.status, 0);

      const cached = JSON.parse(
        readFileSync(
          join(replayDir, `${sanitizeCaseId(caseId)}.result.json`),
          "utf8",
        ),
      ) as unknown;

      if (!isRecord(cached)) {
        throw new Error("cached result must be an object");
      }

      assert.equal(isRecord(cached["metrics"]), true);
      if (!isRecord(cached["metrics"])) {
        throw new Error("metrics should be an object");
      }
      assert.equal("debug" in cached["metrics"], false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("result.json metrics stay stable between verbose/non-verbose replay writeback", async () => {
    const tempRoot = mkdtempSync(
      join(tmpdir(), "agent-eval-replay-metrics-stability-"),
    );

    try {
      const plainDir = join(tempRoot, "plain");
      const verboseDir = join(tempRoot, "verbose");
      mkdirSync(plainDir, { recursive: true });
      mkdirSync(verboseDir, { recursive: true });

      const caseId = "replay-metrics-stability-case";
      const inlineCase = JSON.stringify({
        type: "plain",
        id: caseId,
        description: "replay metrics stability",
        input: {
          system_prompt: "sys",
          model: "qwen-plus",
          messages: [{ role: "user", content: "hello" }],
          allowed_tool_names: [],
        },
        criteria: {},
      });

      const traceJson = JSON.stringify(makeTrace(caseId), null, 2);
      writeFileSync(
        join(plainDir, `${sanitizeCaseId(caseId)}.trace.json`),
        traceJson,
      );
      writeFileSync(
        join(verboseDir, `${sanitizeCaseId(caseId)}.trace.json`),
        traceJson,
      );
      await saveResult(makeResult(caseId), plainDir);
      await saveResult(makeResult(caseId), verboseDir);

      const baseEnv = {
        OPENAI_BASE_URL: "",
        OPENAI_API_KEY: "",
        EVAL_MCP_SERVER_BASE_URL: "",
        EVAL_UPSTREAM_API_BASE_URL: "",
      };

      const plainRun = runCli(
        [
          "run",
          "--inline",
          inlineCase,
          "--replay",
          plainDir,
          "--replay-write-metrics",
        ],
        baseEnv,
      );
      assert.equal(plainRun.status, 0);

      const verboseRun = runCli(
        [
          "run",
          "--inline",
          inlineCase,
          "--replay",
          verboseDir,
          "--replay-write-metrics",
          "--verbose",
        ],
        baseEnv,
      );
      assert.equal(verboseRun.status, 0);

      const plainResult = JSON.parse(
        readFileSync(
          join(plainDir, `${sanitizeCaseId(caseId)}.result.json`),
          "utf8",
        ),
      ) as unknown;
      const verboseResult = JSON.parse(
        readFileSync(
          join(verboseDir, `${sanitizeCaseId(caseId)}.result.json`),
          "utf8",
        ),
      ) as unknown;

      if (!isRecord(plainResult) || !isRecord(verboseResult)) {
        throw new Error("cached result must be an object");
      }

      assert.deepEqual(plainResult["metrics"], verboseResult["metrics"]);
      if (!isRecord(plainResult["metrics"])) {
        throw new Error("metrics should be an object");
      }
      assert.equal("debug" in plainResult["metrics"], false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("replay error trace skips llm judge and reports runner error", () => {
    const tempRoot = mkdtempSync(
      join(tmpdir(), "agent-eval-replay-error-trace-"),
    );

    try {
      const replayDir = join(tempRoot, "traces");
      mkdirSync(replayDir, { recursive: true });

      const caseId = "replay-error-case";
      const inlineCase = JSON.stringify({
        type: "plain",
        id: caseId,
        description: "replay error trace",
        input: {
          system_prompt: "sys",
          model: "qwen-plus",
          messages: [{ role: "user", content: "hello" }],
          allowed_tool_names: [],
        },
        criteria: {
          llm_judge: {
            prompt: "judge",
            pass_threshold: 0.7,
          },
        },
      });

      const errorTrace: EvalTrace = {
        case_id: caseId,
        case_type: "plain",
        conversation: [],
        tools_called: [],
        final_response: null,
        status: "error",
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        duration_ms: 1234,
        error: "Max turns (10) exceeded",
      };

      writeFileSync(
        join(replayDir, `${sanitizeCaseId(caseId)}.trace.json`),
        JSON.stringify(errorTrace, null, 2),
      );

      const result = runCli(
        ["run", "--inline", inlineCase, "--replay", replayDir],
        {
          OPENAI_BASE_URL: "",
          OPENAI_API_KEY: "",
          EVAL_JUDGE_BASE_URL: "",
          EVAL_JUDGE_API_KEY: "",
          EVAL_MCP_SERVER_BASE_URL: "",
          EVAL_UPSTREAM_API_BASE_URL: "",
        },
      );

      assert.equal(result.status, 2);
      assert.doesNotMatch(result.stderr, /E_MISSING_CONFIG/);
      assert.match(result.stderr, /1 errored/);
      assert.match(result.stderr, /Max turns \(10\) exceeded/);

      const reportPath = extractReportPath(result.stderr);
      const report = readFileSync(reportPath, "utf8");
      assert.match(
        report,
        /\| replay-error-case \| ERR \| --- \| 1.2s \| 0 tok \| Max turns \(10\) exceeded \|/,
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("continues other cases when one replay trace file is missing", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "agent-eval-replay-missing-"));

    try {
      const caseA = "case-a";
      const caseB = "case-b";
      const caseAPath = join(tempRoot, "case-a.eval.yaml");
      const caseBPath = join(tempRoot, "case-b.eval.yaml");
      writeCaseFile(caseAPath, caseA);
      writeCaseFile(caseBPath, caseB);

      const replayDir = join(tempRoot, "traces");
      mkdirSync(replayDir, { recursive: true });
      writeFileSync(
        join(replayDir, `${sanitizeCaseId(caseA)}.trace.json`),
        JSON.stringify(makeTrace(caseA), null, 2),
      );

      const result = runCli(
        [
          "run",
          "--file",
          caseAPath,
          "--file",
          caseBPath,
          "--replay",
          replayDir,
        ],
        {
          OPENAI_BASE_URL: "",
          OPENAI_API_KEY: "",
          EVAL_MCP_SERVER_BASE_URL: "",
          EVAL_UPSTREAM_API_BASE_URL: "",
        },
      );

      assert.equal(result.status, 2);
      assert.match(result.stderr, /Trace not found/);
      assert.match(result.stderr, /1 passed/);
      assert.match(result.stderr, /1 errored/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
