import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

const EVAL_ROOT = join(import.meta.dirname, "..", "..");

type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

function runCli(args: string[], env?: Record<string, string>): CliResult {
  const proc = spawnSync("node", ["src/cli.ts", ...args], {
    cwd: EVAL_ROOT,
    env: {
      ...process.env,
      AGENT_EVAL_DISABLE_ENV_AUTOLOAD: "1",
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

function createResultDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-eval-report-"));
  const result = {
    case_id: "case-a",
    case_type: "plain",
    passed: true,
    dimensions: [],
    trace: {
      case_id: "case-a",
      case_type: "plain",
      conversation: [],
      tools_called: [],
      final_response: "ok",
      status: "success",
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      duration_ms: 10,
    },
  };
  writeFileSync(
    join(dir, "case-a.result.json"),
    JSON.stringify(result),
    "utf8",
  );
  return dir;
}

describe("agent-eval CLI UX", () => {
  it("shows agent-eval in help", () => {
    const result = runCli(["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /agent-eval/);
    assert.doesNotMatch(result.stdout, /Usage:\n\s+\$ eval /);
  });

  it("shows help for -h", () => {
    const result = runCli(["-h"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /agent-eval/);
  });

  it("shows help when no args are provided", () => {
    const result = runCli([]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /agent-eval/);
  });

  // P0: root-level unknown flags must error, not silently succeed
  it("reports unknown root option --foo with exit 2", () => {
    const result = runCli(["--foo"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_UNKNOWN_OPTION/);
    assert.match(result.stderr, /no command given/);
    assert.doesNotMatch(result.stderr, /Unhandled rejection|node:internal/);
  });

  it("reports unknown root option --bar with exit 2", () => {
    const result = runCli(["--bar"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_UNKNOWN_OPTION/);
  });

  it("reports unknown command with did-you-mean", () => {
    const result = runCli(["rn"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_UNKNOWN_COMMAND/);
    assert.match(result.stderr, /Did you mean/);
    assert.doesNotMatch(
      result.stderr,
      /Unhandled rejection|CACError|node:internal/,
    );
  });

  it("reports unknown option without stack", () => {
    const result = runCli(["run", "--badopt"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_UNKNOWN_OPTION/);
    assert.doesNotMatch(result.stderr, /CACError|node:internal/);
  });

  it("reports case-not-found without stack", () => {
    const result = runCli(["run", "--case", "not-exist"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_CASE_NOT_FOUND/);
    assert.doesNotMatch(result.stderr, /Unhandled rejection|node:internal/);
  });

  it("reports invalid inline json in json format", () => {
    const result = runCli(["run", "--format", "json", "--inline", "{bad"]);
    assert.equal(result.status, 2);
    const line = result.stdout.trim();
    const parsed = JSON.parse(line);
    assert.equal(parsed.type, "error");
    assert.equal(parsed.code, "E_INVALID_JSON");
    assert.equal(typeof parsed.hint, "string");
    assert.doesNotMatch(result.stderr, /Unhandled rejection|node:internal/);
  });

  it("fails fast when config missing", () => {
    const result = runCli(["run", "--case", "all"], {
      OPENAI_BASE_URL: "",
      OPENAI_API_KEY: "",
      EVAL_MCP_SERVER_BASE_URL: "",
      EVAL_UPSTREAM_API_BASE_URL: "",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_MISSING_CONFIG/);
    assert.match(result.stderr, /OPENAI_BASE_URL/);
    assert.match(result.stderr, /OPENAI_API_KEY/);
  });

  // P2: tool-less plain cases (allowed_tool_names: []) don't require MCP config
  it("does not require EVAL_MCP_SERVER_BASE_URL for tool-free plain cases", () => {
    // system-prompt-tone has allowed_tool_names: [], so MCP is not needed.
    // With only OPENAI_* missing, error should be E_MISSING_CONFIG for OPENAI vars,
    // NOT for EVAL_MCP_SERVER_BASE_URL.
    const result = runCli(["run", "--case", "system-prompt-tone"], {
      OPENAI_BASE_URL: "",
      OPENAI_API_KEY: "",
      EVAL_MCP_SERVER_BASE_URL: "",
      EVAL_UPSTREAM_API_BASE_URL: "",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_MISSING_CONFIG/);
    assert.doesNotMatch(result.stderr, /EVAL_MCP_SERVER_BASE_URL/);
  });

  it("plain case accepts EVAL_PLAIN_* without requiring OPENAI_*", () => {
    const result = runCli(["run", "--case", "system-prompt-tone"], {
      OPENAI_BASE_URL: "",
      OPENAI_API_KEY: "",
      EVAL_PLAIN_BASE_URL: "http://127.0.0.1:9/v1",
      EVAL_PLAIN_API_KEY: "plain-key",
      EVAL_MCP_SERVER_BASE_URL: "",
      EVAL_UPSTREAM_API_BASE_URL: "",
      EVAL_JUDGE_BASE_URL: "http://127.0.0.1:9/v1",
      EVAL_JUDGE_API_KEY: "judge-key",
      EVAL_JUDGE_MODEL: "judge-model",
    });

    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stderr, /E_MISSING_CONFIG/);
    assert.doesNotMatch(result.stderr, /OPENAI_BASE_URL|OPENAI_API_KEY/);
  });

  // P2: glob pattern that matches no files reports the pattern name
  it("reports unmatched glob pattern in error hint", () => {
    const result = runCli(["run", "--file", "not-found-*.yaml"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_NO_CASES/);
    assert.match(result.stderr, /not-found-\*\.yaml/);
  });

  it("outputs diff error as NDJSON verdict=error in json mode", () => {
    const result = runCli(
      [
        "diff",
        "--case",
        "system-prompt-tone",
        "--base",
        '{"label":"base"}',
        "--candidate",
        '{"label":"candidate"}',
        "--format",
        "json",
      ],
      {
        OPENAI_BASE_URL: "http://127.0.0.1:9/v1",
        OPENAI_API_KEY: "test-key",
        EVAL_MCP_SERVER_BASE_URL: "",
        EVAL_UPSTREAM_API_BASE_URL: "",
        EVAL_JUDGE_BASE_URL: "http://127.0.0.1:9/v1",
        EVAL_JUDGE_API_KEY: "judge-key",
        EVAL_JUDGE_MODEL: "judge-model",
      },
    );

    assert.equal(result.status, 2);
    const lines = result.stdout
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    assert.ok(lines.some((line) => line.includes('"type":"diff"')));
    assert.ok(lines.some((line) => line.includes('"verdict":"error"')));
    assert.doesNotMatch(result.stderr, /^\s*error:/m);
  });

  it("rejects --record with --replay together", () => {
    const result = runCli([
      "run",
      "--case",
      "system-prompt-tone",
      "--record",
      "./tmp-record",
      "--replay",
      "./tmp-replay",
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_INVALID_ARGS/);
  });

  it("requires --replay when using --replay-write-metrics", () => {
    const result = runCli([
      "run",
      "--case",
      "system-prompt-tone",
      "--replay-write-metrics",
    ]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_INVALID_ARGS/);
    assert.match(result.stderr, /replay-write-metrics/);
  });

  it("pull-online appears in help", () => {
    const result = runCli(["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /pull-online/);
  });

  it("pull-online requires --collection-uuid (json mode)", () => {
    const result = runCli(["pull-online", "--format", "json"]);
    assert.equal(result.status, 2);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.type, "error");
    assert.equal(payload.code, "E_INVALID_ARGS");
    assert.match(String(payload.message), /collection-uuid/);
  });

  it("pull-online rejects invalid --page-index before network request", () => {
    const result = runCli([
      "pull-online",
      "--format",
      "json",
      "--collection-uuid",
      "dummy",
      "--base-url",
      "http://127.0.0.1:9",
      "--x-token",
      "test-token",
      "--page-index",
      "abc",
    ]);
    assert.equal(result.status, 2);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.type, "error");
    assert.equal(payload.code, "E_INVALID_ARGS");
    assert.match(String(payload.message), /page-index/);
  });

  it("doctor supports terminal output", () => {
    const result = runCli(["doctor"]);
    assert.match(result.stderr, /agent-eval doctor/);
    assert.match(result.stderr, /✅|❌|⚠/);
    assert.match(result.stderr, /do not use `eval run`/);
  });

  it("doctor supports json output", () => {
    const result = runCli(["doctor", "--format", "json"]);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.type, "doctor");
    assert.equal(Array.isArray(payload.checks), true);
    assert.equal(typeof payload.mode, "string");
  });

  it("doctor default (all): no EVAL_UPSTREAM_API_BASE_URL row", () => {
    const result = runCli(["doctor"], {
      OPENAI_BASE_URL: "http://fake-llm",
      OPENAI_API_KEY: "fake-key",
      EVAL_JUDGE_MODEL: "qwen3.5-plus",
      EVAL_MCP_SERVER_BASE_URL: "http://fake-mcp",
      EVAL_UPSTREAM_API_BASE_URL: "",
    });
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stderr, /EVAL_UPSTREAM_API_BASE_URL/);
  });

  it("doctor --mode agent: no EVAL_UPSTREAM_API_BASE_URL row", () => {
    const result = runCli(["doctor", "--mode", "agent"], {
      OPENAI_BASE_URL: "http://fake-llm",
      OPENAI_API_KEY: "fake-key",
      EVAL_JUDGE_MODEL: "qwen3.5-plus",
      EVAL_MCP_SERVER_BASE_URL: "http://fake-mcp",
      EVAL_UPSTREAM_API_BASE_URL: "",
    });
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stderr, /EVAL_UPSTREAM_API_BASE_URL/);
  });

  it("report appears in help", () => {
    const result = runCli(["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /report/);
  });

  it("inspect resolves --file with ./packages/eval prefix under package cwd", () => {
    const result = runCli([
      "inspect",
      "--file",
      "./packages/eval/cases/online-f0b3ab11-de5d-4076-bdd8-0b4d216ae144.eval.yaml",
    ]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /online-f0b3ab11-de5d-4076-bdd8-0b4d216ae144/);
  });

  it("report requires --from", () => {
    const result = runCli(["report"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_INVALID_ARGS/);
    assert.match(result.stderr, /--from/);
  });

  it("report errors when directory has no result files", () => {
    const result = runCli(["report", "--from", "/nonexistent-dir-12345"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_INVALID_ARGS/);
  });

  it("report shares by default and exposes share_error when service is not configured", () => {
    const dir = createResultDir();

    try {
      const result = runCli(["report", "--from", dir, "--format", "json"]);
      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout.trim());
      assert.equal(payload.type, "report");
      assert.equal(typeof payload.share_error, "string");
      assert.equal(payload.share_url, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("report --no-share disables upload", () => {
    const dir = createResultDir();

    try {
      const result = runCli([
        "report",
        "--from",
        dir,
        "--format",
        "json",
        "--no-share",
      ]);

      assert.equal(result.status, 0);
      const payload = JSON.parse(result.stdout.trim());
      assert.equal(payload.type, "report");
      assert.equal(payload.share_url, undefined);
      assert.equal(payload.share_error, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("doctor --mode plain: no EVAL_UPSTREAM_API_BASE_URL row", () => {
    const result = runCli(["doctor", "--mode", "plain"], {
      OPENAI_BASE_URL: "http://fake-llm",
      OPENAI_API_KEY: "fake-key",
      EVAL_MCP_SERVER_BASE_URL: "http://fake-mcp",
    });
    assert.doesNotMatch(result.stderr, /EVAL_UPSTREAM_API_BASE_URL/);
  });

  it("doctor --mode plain: EVAL_PLAIN_BASE_URL appears as ⚠️ when unset", () => {
    const result = runCli(["doctor", "--mode", "plain"], {
      OPENAI_BASE_URL: "http://fake-llm",
      OPENAI_API_KEY: "fake-key",
      EVAL_JUDGE_MODEL: "qwen3.5-plus",
      EVAL_MCP_SERVER_BASE_URL: "http://fake-mcp",
      EVAL_PLAIN_BASE_URL: "",
    });
    assert.match(result.stderr, /EVAL_PLAIN_BASE_URL/);
    assert.match(result.stderr, /⚠/);
    // exit 0 because EVAL_PLAIN_BASE_URL is optional
    assert.equal(result.status, 0);
  });

  it("doctor --format json includes mode and optional fields", () => {
    const result = runCli(["doctor", "--format", "json", "--mode", "all"]);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.mode, "all");
    assert.equal(
      payload.checks.some(
        (c: { key: string }) => c.key === "EVAL_UPSTREAM_API_BASE_URL",
      ),
      false,
    );

    const plainBaseCheck = payload.checks.find(
      (c: { key: string }) => c.key === "EVAL_PLAIN_BASE_URL",
    );
    assert.ok(plainBaseCheck, "EVAL_PLAIN_BASE_URL should be in checks");
    assert.equal(plainBaseCheck.optional, true);
  });

  it("matrix appears in help", () => {
    const result = runCli(["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /matrix/);
  });

  it("matrix --help includes --variant and --concurrency", () => {
    const result = runCli(["matrix", "--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--variant/);
    assert.match(result.stdout, /--concurrency/);
  });

  it("matrix without --variant returns E_INVALID_ARGS", () => {
    const result = runCli(["matrix", "--case", "all"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_INVALID_ARGS/);
    assert.match(result.stderr, /--variant/);
  });

  it("matrix duplicate labels returns E_VALIDATION", () => {
    const result = runCli([
      "matrix",
      "--case",
      "all",
      "--variant",
      '{"label":"v1","model":"a"}',
      "--variant",
      '{"label":"v1","model":"b"}',
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_VALIDATION/);
    assert.match(result.stderr, /duplicate variant label/);
  });

  it("matrix variant missing label returns E_VALIDATION", () => {
    const result = runCli([
      "matrix",
      "--case",
      "all",
      "--variant",
      '{"model":"qwen-plus"}',
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_VALIDATION/);
    assert.match(result.stderr, /label/);
  });

  it("matrix no cases returns E_NO_CASES", () => {
    const result = runCli([
      "matrix",
      "--file",
      "./nonexistent-*.yaml",
      "--variant",
      '{"label":"v1"}',
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_NO_CASES/);
  });

  it("matrix supports json error output", () => {
    const result = runCli([
      "matrix",
      "--format",
      "json",
      "--case",
      "all",
      "--variant",
      "{bad-json}",
    ]);
    assert.equal(result.status, 2);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.type, "error");
    assert.equal(payload.code, "E_INVALID_JSON");
  });
});
