import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  const proc = spawnSync("node", ["src/cli/index.ts", ...args], {
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

function createSkillsRootWithSkill(skillName = "write-judge-prompt"): string {
  const root = mkdtempSync(join(tmpdir(), "agent-eval-skills-"));
  const skillDir = join(root, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: Write concise judge prompts for structured eval rubrics.\n---\n\n# Examples\nUser request: Draft a concise judge prompt for scoring customer support replies.`,
    "utf8",
  );
  return root;
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

  it("error trace maps to FAILURE status", () => {
    // When model is not found, runner returns error trace (status: "error")
    // which maps to FAILURE for final_status assertions
    const inlineCase = JSON.stringify({
      type: "plain",
      id: "model-not-found-test",
      description: "test model not found",
      input: {
        system_prompt: "sys",
        model: "nonexistent-model",
        messages: [{ role: "user", content: "hello" }],
        allowed_tool_names: [],
      },
      criteria: {
        assertions: [
          {
            type: "final_status",
            expected_status: "FAILURE",
          },
        ],
      },
    });
    const result = runCli(["run", "--inline", inlineCase], {
      EVAL_MODELS_PATH: "",
      EVAL_MCP_SERVER_BASE_URL: "",
      EVAL_UPSTREAM_API_BASE_URL: "",
    });
    // Test passes because error → FAILURE
    assert.equal(result.status, 0);
    assert.match(result.stderr, /status matched: FAILURE/);
  });

  it("fails fast when judge model is missing for llm_judge case", () => {
    const inlineCase = JSON.stringify({
      type: "plain",
      id: "judge-missing-model",
      description: "judge missing model",
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
            prompt: "score it",
            pass_threshold: 0.7,
          },
        ],
      },
    });

    const result = runCli(["run", "--inline", inlineCase], {
      EVAL_JUDGE_BASE_URL: "http://127.0.0.1:9/v1",
      EVAL_JUDGE_API_KEY: "judge-key",
      EVAL_JUDGE_MODEL: "",
      EVAL_MCP_SERVER_BASE_URL: "",
      EVAL_UPSTREAM_API_BASE_URL: "",
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_MISSING_CONFIG/);
    assert.match(result.stderr, /EVAL_JUDGE_MODEL/);
  });

  it("run rejects invalid --tier-max value", () => {
    const result = runCli([
      "run",
      "--case",
      "system-prompt-tone",
      "--tier-max",
      "4",
    ]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_INVALID_ARGS/);
    assert.match(result.stderr, /--tier-max must be 1, 2, or 3/);
  });

  // P2: tool-less plain cases (allowed_tool_names: []) don't require MCP config
  it("does not require EVAL_MCP_SERVER_BASE_URL for tool-free plain cases", () => {
    // system-prompt-tone has allowed_tool_names: [], so MCP is not needed.
    // With models.json missing, error should be E_MISSING_CONFIG for models.json,
    // NOT for EVAL_MCP_SERVER_BASE_URL.
    const result = runCli(["run", "--case", "system-prompt-tone"], {
      EVAL_MODELS_PATH: "",
      EVAL_MCP_SERVER_BASE_URL: "",
      EVAL_UPSTREAM_API_BASE_URL: "",
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_MISSING_CONFIG/);
    assert.doesNotMatch(result.stderr, /EVAL_MCP_SERVER_BASE_URL/);
  });

  it("missing judge model in registry fails llm_judge assertions", () => {
    const result = runCli(["run", "--case", "system-prompt-tone"], {
      EVAL_MODELS_PATH: "",
      EVAL_MCP_SERVER_BASE_URL: "",
      EVAL_UPSTREAM_API_BASE_URL: "",
      EVAL_JUDGE_BASE_URL: "http://127.0.0.1:9/v1",
      EVAL_JUDGE_API_KEY: "judge-key",
      EVAL_JUDGE_MODEL: "judge-model",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /judge model resolution failed/);
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

  it("draft-skill-case appears in help", () => {
    const result = runCli(["--help"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /draft-skill-case/);
  });

  // Note: Successful draft-skill-case tests require LLM model configuration.
  // Those tests are in skill-case-generator.test.ts as unit tests.

  it("draft-skill-case reports useful error for missing skill", () => {
    const skillsRoot = createSkillsRootWithSkill();

    try {
      const result = runCli([
        "draft-skill-case",
        "--skill",
        "missing-skill",
        "--skills-dir",
        skillsRoot,
      ]);

      assert.equal(result.status, 2);
      assert.match(result.stderr, /E_INVALID_ARGS/);
      assert.match(result.stderr, /Skill not found/i);
    } finally {
      rmSync(skillsRoot, { recursive: true, force: true });
    }
  });

  it("draft-skill-case reports invalid skill name before root fallback", () => {
    const result = runCli([
      "draft-skill-case",
      "--skill",
      "Bad--Skill",
      "--format",
      "json",
    ]);

    assert.equal(result.status, 2);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.type, "error");
    assert.equal(payload.code, "E_INVALID_ARGS");
    assert.match(String(payload.message), /Invalid skill name/i);
  });

  it("draft-skill-case rejects invalid explicit skills dir without fallback", () => {
    const result = runCli([
      "draft-skill-case",
      "--skill",
      "write-judge-prompt",
      "--skills-dir",
      "/definitely/missing/path",
      "--format",
      "json",
    ]);

    assert.equal(result.status, 2);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.type, "error");
    assert.equal(payload.code, "E_INVALID_ARGS");
    assert.match(String(payload.message), /does not exist|not a directory/i);
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
      EVAL_JUDGE_MODEL: "qwen3.5-plus",
      EVAL_MCP_SERVER_BASE_URL: "http://fake-mcp",
      EVAL_UPSTREAM_API_BASE_URL: "",
    });
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stderr, /EVAL_UPSTREAM_API_BASE_URL/);
  });

  it("doctor --mode agent: no EVAL_UPSTREAM_API_BASE_URL row", () => {
    const result = runCli(["doctor", "--mode", "agent"], {
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
      assert.equal(typeof payload.output, "string");
      assert.equal(typeof payload.output_list, "string");
      assert.equal(existsSync(payload.output), true);
      assert.equal(existsSync(payload.output_list), true);
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
      assert.equal(typeof payload.output, "string");
      assert.equal(typeof payload.output_list, "string");
      assert.equal(existsSync(payload.output), true);
      assert.equal(existsSync(payload.output_list), true);
      assert.equal(payload.share_url, undefined);
      assert.equal(payload.share_error, undefined);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("doctor --mode plain: no EVAL_UPSTREAM_API_BASE_URL row", () => {
    const result = runCli(["doctor", "--mode", "plain"], {
      EVAL_MCP_SERVER_BASE_URL: "http://fake-mcp",
    });
    assert.doesNotMatch(result.stderr, /EVAL_UPSTREAM_API_BASE_URL/);
  });

  it("doctor --mode plain: no EVAL_PLAIN_BASE_URL row", () => {
    const result = runCli(["doctor", "--mode", "plain"], {
      EVAL_JUDGE_MODEL: "qwen3.5-plus",
      EVAL_MCP_SERVER_BASE_URL: "http://fake-mcp",
      EVAL_PLAIN_BASE_URL: "",
    });
    assert.doesNotMatch(result.stderr, /EVAL_PLAIN_BASE_URL/);
    assert.equal(result.status, 0);
  });

  it("doctor --format json includes mode without legacy plain checks", () => {
    const result = runCli(["doctor", "--format", "json", "--mode", "all"]);
    const payload = JSON.parse(result.stdout.trim());
    assert.equal(payload.mode, "all");
    assert.equal(
      payload.checks.some(
        (c: { key: string }) => c.key === "EVAL_UPSTREAM_API_BASE_URL",
      ),
      false,
    );
    assert.equal(
      payload.checks.some(
        (c: { key: string }) => c.key === "EVAL_PLAIN_BASE_URL",
      ),
      false,
    );
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

  it("matrix rejects invalid --tier-max value", () => {
    const result = runCli([
      "matrix",
      "--case",
      "all",
      "--variant",
      '{"label":"v1"}',
      "--tier-max",
      "0",
    ]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_INVALID_ARGS/);
    assert.match(result.stderr, /--tier-max must be 1, 2, or 3/);
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
