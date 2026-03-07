import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreBashExecutionAssertion } from "../scorers/bash-execution.ts";
import type { AssertionConfig, EvalCase, EvalTrace } from "../types.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeTrace(overrides: Partial<EvalTrace> = {}): EvalTrace {
  return {
    case_id: "test-case",
    case_type: "skill",
    conversation: [],
    tools_called: [],
    final_response: "done",
    status: "success",
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    duration_ms: 100,
    skill_resolution: {
      source: "cli",
      root_dir: "/tmp/skills",
      skill_name: "my-skill",
      skill_path: "/tmp/skills/my-skill/SKILL.md",
      skill_content:
        "---\nname: my-skill\ndescription: test skill\n---\nSkill body.",
    },
    ...overrides,
  };
}

function makeCase(): EvalCase {
  return {
    type: "skill",
    id: "test-case",
    description: "test",
    input: {
      skill: "my-skill",
      task: "do something",
      evaluation_mode: "discover",
    },
    criteria: { assertions: [] },
  };
}

function makeAssertion(
  overrides: Partial<Extract<AssertionConfig, { type: "bash_execution" }>> = {},
): AssertionConfig {
  return {
    type: "bash_execution",
    pass_threshold: 0.7,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("scoreBashExecutionAssertion", () => {
  it("returns dimension = bash_execution", async () => {
    // Judge will error without real env vars — that's expected, we just check the dimension.
    const result = await scoreBashExecutionAssertion(
      makeTrace(),
      makeAssertion(),
      makeCase(),
    );
    assert.equal(result.dimension, "bash_execution");
  });

  it("returns passed=false when assertion type is wrong", async () => {
    const result = await scoreBashExecutionAssertion(
      makeTrace(),
      { type: "llm_judge", prompt: "x", pass_threshold: 0.7 },
      makeCase(),
    );
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes("internal error"));
  });

  it("returns passed=false when trace status is error", async () => {
    const result = await scoreBashExecutionAssertion(
      makeTrace({ status: "error", error: "runner crash" }),
      makeAssertion(),
      makeCase(),
    );
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes("runner error"));
  });

  it("returns passed=false with a reason when skill_resolution is missing", async () => {
    // Build trace without skill_resolution (omit the key entirely for exactOptionalPropertyTypes)
    const { skill_resolution: _omit, ...traceWithoutResolution } = makeTrace();
    const result = await scoreBashExecutionAssertion(
      traceWithoutResolution as EvalTrace,
      makeAssertion(),
      makeCase(),
    );
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes("skill_resolution"));
  });

  it("does not throw — returns a DimensionResult even when judge fails", async () => {
    // Without EVAL_JUDGE_MODEL set the judge returns an error,
    // but scoreBashExecutionAssertion must NOT throw.
    let threw = false;
    try {
      await scoreBashExecutionAssertion(makeTrace(), makeAssertion(), makeCase());
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
  });
});
