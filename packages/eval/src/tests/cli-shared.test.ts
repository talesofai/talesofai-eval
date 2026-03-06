import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectDoctorChecks,
  computeRunExitCode,
  shouldUseJsonErrors,
} from "../cli/shared.ts";

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
  it("passes when models.json exists in cwd", () => {
    // The test runs from packages/eval where models.json exists
    const checks = collectDoctorChecks({});
    assert.ok(
      checks.some(
        (check) =>
          check.key === "EVAL_MODELS_PATH or ./models.json" && check.ok,
      ),
    );
    assert.ok(
      checks.some(
        (check) =>
          check.key === "cli-name" &&
          check.ok &&
          check.hint.includes("eval run"),
      ),
    );
  });

  it("mode=all: no EVAL_UPSTREAM_API_BASE_URL check", () => {
    const checks = collectDoctorChecks({}, "all");
    assert.ok(
      !checks.some((c) => c.key === "EVAL_UPSTREAM_API_BASE_URL"),
      "EVAL_UPSTREAM_API_BASE_URL should be absent in all mode",
    );
  });

  it("mode=agent: no EVAL_UPSTREAM_API_BASE_URL check", () => {
    const checks = collectDoctorChecks({}, "agent");
    assert.ok(
      !checks.some((c) => c.key === "EVAL_UPSTREAM_API_BASE_URL"),
      "EVAL_UPSTREAM_API_BASE_URL should be absent in agent mode",
    );
  });

  it("mode=plain: no EVAL_PLAIN_BASE_URL check", () => {
    const checks = collectDoctorChecks({}, "plain");
    assert.ok(
      !checks.some((c) => c.key === "EVAL_PLAIN_BASE_URL"),
      "EVAL_PLAIN_BASE_URL should be absent in plain mode",
    );
  });

  it("mode=agent: no EVAL_PLAIN_BASE_URL check", () => {
    const checks = collectDoctorChecks({}, "agent");
    assert.ok(
      !checks.some((c) => c.key === "EVAL_PLAIN_BASE_URL"),
      "EVAL_PLAIN_BASE_URL should be absent in agent mode",
    );
  });

  it("mode=all: no EVAL_PLAIN_BASE_URL check", () => {
    const checks = collectDoctorChecks({}, "all");
    assert.ok(
      !checks.some((c) => c.key === "EVAL_PLAIN_BASE_URL"),
      "EVAL_PLAIN_BASE_URL should be absent in all mode",
    );
  });

  it("includes optional EVAL_SKILLS_DIR hint for skill runs", () => {
    const checks = collectDoctorChecks({}, "all");
    const skillCheck = checks.find((check) => check.key === "EVAL_SKILLS_DIR");

    assert.ok(skillCheck);
    assert.equal(skillCheck?.requiredFor, "skill run");
    assert.equal(skillCheck?.optional, true);
    assert.equal(skillCheck?.ok, false);
    assert.equal(skillCheck?.hint.includes("~/.agents/skills"), true);
  });
});

describe("shouldUseJsonErrors", () => {
  it("returns true when run format is json", () => {
    const value = shouldUseJsonErrors([
      "node",
      "src/cli/index.ts",
      "run",
      "--format",
      "json",
    ]);
    assert.equal(value, true);
  });

  it("returns true when pull-online format is json", () => {
    const value = shouldUseJsonErrors([
      "node",
      "src/cli/index.ts",
      "pull-online",
      "--format",
      "json",
    ]);
    assert.equal(value, true);
  });

  it("returns false for unrelated command", () => {
    const value = shouldUseJsonErrors([
      "node",
      "src/cli/index.ts",
      "doctor",
      "--format",
      "json",
    ]);
    assert.equal(value, false);
  });
});
