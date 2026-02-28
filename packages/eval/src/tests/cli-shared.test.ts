import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectDoctorChecks,
  computeRunExitCode,
  shouldUseJsonErrors,
} from "../cli-shared.ts";

describe("computeRunExitCode", () => {
  it("returns 0 when all pass", () => {
    const code = computeRunExitCode([
      {
        case_id: "ok",
        case_type: "plain",
        passed: true,
        dimensions: [],
        trace: {
          case_id: "ok",
          case_type: "plain",
          conversation: [],
          tools_called: [],
          final_response: null,
          status: "success",
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          duration_ms: 1,
        },
      },
    ]);
    assert.equal(code, 0);
  });

  it("returns 1 when business failure exists without runtime error", () => {
    const code = computeRunExitCode([
      {
        case_id: "failed",
        case_type: "plain",
        passed: false,
        dimensions: [
          {
            dimension: "final_status",
            passed: false,
            score: 0,
            reason: "mismatch",
          },
        ],
        trace: {
          case_id: "failed",
          case_type: "plain",
          conversation: [],
          tools_called: [],
          final_response: "no",
          status: "success",
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          duration_ms: 1,
        },
      },
    ]);
    assert.equal(code, 1);
  });

  it("returns 2 when runtime error exists", () => {
    const code = computeRunExitCode([
      {
        case_id: "err",
        case_type: "plain",
        passed: false,
        dimensions: [],
        trace: {
          case_id: "err",
          case_type: "plain",
          conversation: [],
          tools_called: [],
          final_response: null,
          status: "error",
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          duration_ms: 1,
        },
        error: "boom",
      },
    ]);
    assert.equal(code, 2);
  });
});

describe("collectDoctorChecks", () => {
  it("reports failures for missing env", () => {
    const checks = collectDoctorChecks({});
    assert.ok(
      checks.some((check) => check.key === "OPENAI_API_KEY" && !check.ok),
    );
    assert.ok(
      checks.some(
        (check) =>
          check.key === "cli-name" &&
          check.ok &&
          check.hint.includes("eval run"),
      ),
    );
    assert.ok(
      checks.some(
        (check) =>
          check.key === "OPENAI_BASE_URL" &&
          check.hint.includes("EVAL_PLAIN_BASE_URL"),
      ),
    );
  });

  it("mode=all (default): EVAL_UPSTREAM_API_BASE_URL missing → optional=true, ok=false", () => {
    const checks = collectDoctorChecks({});
    const c = checks.find((c) => c.key === "EVAL_UPSTREAM_API_BASE_URL");
    assert.ok(c, "check should be present");
    assert.equal(c.ok, false);
    assert.equal(c.optional, true);
  });

  it("mode=all (default): EVAL_UPSTREAM_API_BASE_URL set → ok=true", () => {
    const checks = collectDoctorChecks(
      { EVAL_UPSTREAM_API_BASE_URL: "http://x" },
      "all",
    );
    const c = checks.find((c) => c.key === "EVAL_UPSTREAM_API_BASE_URL");
    assert.ok(c);
    assert.equal(c.ok, true);
  });

  it("mode=agent: EVAL_UPSTREAM_API_BASE_URL missing → required (optional=false)", () => {
    const checks = collectDoctorChecks({}, "agent");
    const c = checks.find((c) => c.key === "EVAL_UPSTREAM_API_BASE_URL");
    assert.ok(c, "check should be present in agent mode");
    assert.equal(c.ok, false);
    assert.ok(!c.optional, "should be required (not optional)");
  });

  it("mode=plain: no EVAL_UPSTREAM_API_BASE_URL check", () => {
    const checks = collectDoctorChecks({}, "plain");
    assert.ok(
      !checks.some((c) => c.key === "EVAL_UPSTREAM_API_BASE_URL"),
      "EVAL_UPSTREAM_API_BASE_URL should be absent in plain mode",
    );
  });

  it("mode=plain: EVAL_PLAIN_BASE_URL not set → optional=true", () => {
    const checks = collectDoctorChecks({}, "plain");
    const c = checks.find((c) => c.key === "EVAL_PLAIN_BASE_URL");
    assert.ok(c, "check should be present in plain mode");
    assert.equal(c.ok, false);
    assert.equal(c.optional, true);
  });

  it("mode=plain: EVAL_PLAIN_BASE_URL set → ok=true", () => {
    const checks = collectDoctorChecks(
      { EVAL_PLAIN_BASE_URL: "http://direct-llm" },
      "plain",
    );
    const c = checks.find((c) => c.key === "EVAL_PLAIN_BASE_URL");
    assert.ok(c);
    assert.equal(c.ok, true);
  });

  it("mode=agent: no EVAL_PLAIN_BASE_URL check", () => {
    const checks = collectDoctorChecks({}, "agent");
    assert.ok(
      !checks.some((c) => c.key === "EVAL_PLAIN_BASE_URL"),
      "EVAL_PLAIN_BASE_URL should be absent in agent mode",
    );
  });

  it("mode=all: EVAL_PLAIN_BASE_URL present and optional", () => {
    const checks = collectDoctorChecks({}, "all");
    const c = checks.find((c) => c.key === "EVAL_PLAIN_BASE_URL");
    assert.ok(c);
    assert.equal(c.optional, true);
  });
});

describe("shouldUseJsonErrors", () => {
  it("returns true when run format is json", () => {
    const value = shouldUseJsonErrors([
      "node",
      "src/cli.ts",
      "run",
      "--format",
      "json",
    ]);
    assert.equal(value, true);
  });

  it("returns true when pull-online format is json", () => {
    const value = shouldUseJsonErrors([
      "node",
      "src/cli.ts",
      "pull-online",
      "--format",
      "json",
    ]);
    assert.equal(value, true);
  });

  it("returns false for unrelated command", () => {
    const value = shouldUseJsonErrors([
      "node",
      "src/cli.ts",
      "doctor",
      "--format",
      "json",
    ]);
    assert.equal(value, false);
  });
});
