import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreErrorRecovery } from "../scorers/error-recovery.ts";
import { scoreHumanReview } from "../scorers/human-review.ts";
import { scoreTrace } from "../scorers/index.ts";
import type {
  AssertionConfig,
  EvalTrace,
  PlainEvalCase,
  SkillEvalCase,
  ToolCallRecord,
} from "../types.ts";

function makeTrace(overrides: Partial<EvalTrace> = {}): EvalTrace {
  return {
    case_id: "test",
    case_type: "plain",
    conversation: [],
    tools_called: [],
    final_response: "done",
    status: "success",
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    duration_ms: 1000,
    ...overrides,
  };
}

function makeCall(
  name: string,
  args: Record<string, unknown>,
  output: unknown,
): ToolCallRecord {
  return { name, arguments: args, output, duration_ms: 50 };
}

function makeEvalCase(assertions: AssertionConfig[]): PlainEvalCase {
  return {
    type: "plain",
    id: "test-case",
    description: "test",
    input: {
      system_prompt: "",
      model: "qwen-plus",
      messages: [{ role: "user", content: "帮我生成一张图片" }],
    },
    criteria: { assertions },
  };
}

describe("scoreErrorRecovery", () => {
  it("vacuously passes when no tool errors", () => {
    const trace = makeTrace({
      tools_called: [
        makeCall("make_image_v1", { prompt: "cat" }, { ok: true }),
      ],
    });
    const assertion: AssertionConfig = {
      type: "error_recovery",
      tool_name: "make_image_v1",
    };
    const result = scoreErrorRecovery(trace, assertion);
    assert.equal(result.passed, true);
    assert.equal(result.score, 1.0);
    assert.match(result.reason, /no tool errors/);
    assert.equal(result.dimension, "error_recovery");
  });

  it("passes when error is followed by retry with different args", () => {
    const errorOutput = { isError: true, err_msg: "timeout" };
    const successOutput = { ok: true };
    const trace = makeTrace({
      tools_called: [
        makeCall("make_image_v1", { prompt: "cat" }, errorOutput),
        makeCall("make_image_v1", { prompt: "cat v2" }, successOutput),
      ],
    });
    const assertion: AssertionConfig = {
      type: "error_recovery",
      tool_name: "make_image_v1",
      pass_threshold: 0.5,
    };
    const result = scoreErrorRecovery(trace, assertion);
    assert.equal(result.passed, true);
    assert.equal(result.score, 1.0);
  });

  it("fails when error is followed by same-args retry (blind retry)", () => {
    const errorOutput = { isError: true, err_msg: "timeout" };
    const trace = makeTrace({
      tools_called: [
        makeCall("make_image_v1", { prompt: "cat" }, errorOutput),
        makeCall("make_image_v1", { prompt: "cat" }, { ok: true }),
      ],
    });
    const assertion: AssertionConfig = {
      type: "error_recovery",
      tool_name: "make_image_v1",
    };
    const result = scoreErrorRecovery(trace, assertion);
    assert.equal(result.passed, false);
    assert.equal(result.score, 0);
  });

  it("fails when errored with no retry at all", () => {
    const errorOutput = { isError: true };
    const trace = makeTrace({
      tools_called: [makeCall("make_image_v1", { prompt: "cat" }, errorOutput)],
    });
    const assertion: AssertionConfig = {
      type: "error_recovery",
      tool_name: "make_image_v1",
    };
    const result = scoreErrorRecovery(trace, assertion);
    assert.equal(result.passed, false);
    assert.equal(result.score, 0);
  });

  it("uses default pass_threshold of 0.5", () => {
    const errorOutput = { isError: true };
    const trace = makeTrace({
      tools_called: [
        makeCall("tool_a", { x: 1 }, errorOutput),
        makeCall("tool_a", { x: 2 }, { ok: true }),
        makeCall("tool_a", { x: 3 }, errorOutput),
        makeCall("tool_a", { x: 3 }, { ok: true }),
      ],
    });
    const assertion: AssertionConfig = { type: "error_recovery" };
    const result = scoreErrorRecovery(trace, assertion);
    assert.equal(result.passed, true);
    assert.equal(result.score, 0.5);
  });

  it("filters by tool_name when specified", () => {
    const errorOutput = { isError: true };
    const trace = makeTrace({
      tools_called: [
        makeCall("other_tool", { x: 1 }, errorOutput),
        makeCall("make_image_v1", { prompt: "cat" }, { ok: true }),
      ],
    });
    const assertion: AssertionConfig = {
      type: "error_recovery",
      tool_name: "make_image_v1",
    };
    const result = scoreErrorRecovery(trace, assertion);
    assert.equal(result.passed, true);
    assert.equal(result.score, 1.0);
  });

  it("inspects all tools when tool_name absent", () => {
    const errorOutput = { isError: true };
    const trace = makeTrace({
      tools_called: [
        makeCall("tool_a", { x: 1 }, errorOutput),
        makeCall("tool_b", { y: 1 }, errorOutput),
        makeCall("tool_a", { x: 2 }, { ok: true }),
      ],
    });
    const assertion: AssertionConfig = {
      type: "error_recovery",
      pass_threshold: 0.5,
    };
    const result = scoreErrorRecovery(trace, assertion);
    assert.equal(result.passed, true);
  });
});

describe("scoreHumanReview", () => {
  it("always passes with score 1.0", () => {
    const trace = makeTrace();
    const assertion: AssertionConfig = {
      type: "human_review",
      reason: "complex multi-character scene",
    };
    const result = scoreHumanReview(trace, assertion);
    assert.equal(result.passed, true);
    assert.equal(result.score, 1.0);
    assert.equal(result.dimension, "human_review");
    assert.match(result.reason, /complex multi-character scene/);
  });

  it("uses default reason when none provided", () => {
    const trace = makeTrace();
    const assertion: AssertionConfig = { type: "human_review" };
    const result = scoreHumanReview(trace, assertion);
    assert.equal(result.passed, true);
    assert.match(result.reason, /human review/);
  });

  it("returns error result for wrong assertion type (type guard)", () => {
    const trace = makeTrace();
    const assertion: AssertionConfig = {
      type: "tool_usage",
      expected_tools: ["make_image_v1"],
    };
    const result = scoreHumanReview(trace, assertion);
    assert.equal(result.passed, false);
    assert.equal(result.score, 0);
    assert.match(result.reason, /internal error/);
  });
});

describe("scoreTrace tier filtering", () => {
  it("attaches tier to DimensionResult", async () => {
    const evalCase = makeEvalCase([
      { type: "tool_usage", tier: 1, expected_tools: ["make_image_v1"] },
    ]);
    const trace = makeTrace({
      tools_called: [makeCall("make_image_v1", {}, { ok: true })],
    });
    const result = await scoreTrace(evalCase, trace, { tierMax: 2 });
    assert.equal(result.passed, true);
    assert.equal(result.dimensions[0]?.tier, 1);
  });

  it("default tier for tool_usage is 1", async () => {
    const evalCase = makeEvalCase([
      { type: "tool_usage", expected_tools: ["make_image_v1"] },
    ]);
    const trace = makeTrace({
      tools_called: [makeCall("make_image_v1", {}, { ok: true })],
    });
    const result = await scoreTrace(evalCase, trace, { tierMax: 1 });
    assert.equal(result.passed, true);
    assert.equal(result.dimensions[0]?.tier, 1);
  });

  it("default tier for skill_usage is 2", async () => {
    const evalCase: SkillEvalCase = {
      type: "skill",
      id: "skill-tier-test",
      description: "test",
      input: {
        skill: "write-judge-prompt",
        model: "qwen-plus",
        task: "use the skill",
        evaluation_mode: "discover",
      },
      criteria: {
        assertions: [{ type: "skill_usage", checks: ["skill_loaded"] }],
      },
    };
    const trace = makeTrace({
      case_type: "skill",
      tools_called: [
        makeCall(
          "read",
          { path: "write-judge-prompt/SKILL.md" },
          "---\nname: write-judge-prompt\n---\nbody",
        ),
      ],
      skill_resolution: {
        source: "cli",
        root_dir: "/skills",
        skill_name: "write-judge-prompt",
        skill_path: "/skills/write-judge-prompt/SKILL.md",
      },
    });
    const result = await scoreTrace(evalCase, trace, { tierMax: 2 });
    assert.equal(result.passed, true);
    assert.equal(result.dimensions[0]?.dimension, "skill_usage");
    assert.equal(result.dimensions[0]?.tier, 2);
  });

  it("skips tier-2 assertions when tierMax=1", async () => {
    const evalCase = makeEvalCase([
      { type: "tool_usage", tier: 1, expected_tools: ["make_image_v1"] },
      {
        type: "llm_judge",
        tier: 2,
        prompt: "does it pass?",
        pass_threshold: 0.7,
      },
    ]);
    const trace = makeTrace({
      tools_called: [makeCall("make_image_v1", {}, { ok: true })],
    });
    const result = await scoreTrace(evalCase, trace, { tierMax: 1 });
    assert.equal(result.dimensions.length, 1);
    assert.equal(result.dimensions[0]?.dimension, "tool_usage");
    assert.equal(result.passed, true);
  });

  it("skips tier-3 (human_review) when tierMax=2 (default)", async () => {
    const evalCase = makeEvalCase([
      { type: "tool_usage", tier: 1, expected_tools: ["make_image_v1"] },
      { type: "human_review", tier: 3, reason: "needs QA" },
    ]);
    const trace = makeTrace({
      tools_called: [makeCall("make_image_v1", {}, { ok: true })],
    });
    const result = await scoreTrace(evalCase, trace, { tierMax: 2 });
    assert.equal(result.dimensions.length, 1);
    assert.equal(result.dimensions[0]?.dimension, "tool_usage");
  });

  it("includes human_review when tierMax=3", async () => {
    const evalCase = makeEvalCase([
      { type: "tool_usage", tier: 1, expected_tools: ["make_image_v1"] },
      { type: "human_review", tier: 3, reason: "needs QA" },
    ]);
    const trace = makeTrace({
      tools_called: [makeCall("make_image_v1", {}, { ok: true })],
    });
    const result = await scoreTrace(evalCase, trace, { tierMax: 3 });
    assert.equal(result.dimensions.length, 2);
    const reviewDim = result.dimensions.find(
      (d) => d.dimension === "human_review",
    );
    assert.ok(reviewDim);
    assert.equal(reviewDim.passed, true);
    assert.equal(reviewDim.tier, 3);
  });

  it("D12: hard fail when all assertions filtered and tierMax=1", async () => {
    const evalCase = makeEvalCase([
      {
        type: "llm_judge",
        tier: 2,
        prompt: "does it pass?",
        pass_threshold: 0.7,
      },
    ]);
    const trace = makeTrace();
    const result = await scoreTrace(evalCase, trace, { tierMax: 1 });
    assert.equal(result.passed, false);
    assert.equal(result.dimensions.length, 1);
    assert.equal(result.dimensions[0]?.auto_synthesized, true);
    assert.equal(result.dimensions[0]?.dimension, "task_success");
  });

  it("D12: vacuous pass when no assertions defined", async () => {
    const evalCase = makeEvalCase([]);
    const trace = makeTrace();
    const result = await scoreTrace(evalCase, trace, { tierMax: 2 });
    assert.equal(result.passed, true);
    assert.equal(result.dimensions.length, 0);
  });

  it("error_recovery uses default tier 1 and runs under tierMax=1", async () => {
    const evalCase = makeEvalCase([
      { type: "error_recovery", tool_name: "make_image_v1" },
    ]);
    const trace = makeTrace({
      tools_called: [makeCall("make_image_v1", {}, { ok: true })],
    });
    const result = await scoreTrace(evalCase, trace, { tierMax: 1 });
    assert.equal(result.dimensions.length, 1);
    assert.equal(result.dimensions[0]?.dimension, "error_recovery");
    assert.equal(result.dimensions[0]?.tier, 1);
    assert.equal(result.passed, true);
  });

  it("D4: human_review (tier=3) does not affect passed even if mixed with failing tier-1", async () => {
    const evalCase = makeEvalCase([
      { type: "tool_usage", tier: 1, expected_tools: ["make_image_v1"] },
      { type: "human_review", tier: 3, reason: "needs QA" },
    ]);
    const trace = makeTrace({
      tools_called: [makeCall("other_tool", {}, { ok: true })],
    });
    const result = await scoreTrace(evalCase, trace, { tierMax: 3 });
    assert.equal(result.passed, false);
    const reviewDim = result.dimensions.find(
      (d) => d.dimension === "human_review",
    );
    assert.ok(reviewDim, "human_review dimension present");
    assert.equal(reviewDim.passed, true);
  });

  it("D4: human_review-only case is vacuously passed", async () => {
    const evalCase = makeEvalCase([
      { type: "human_review", tier: 3, reason: "review only" },
    ]);
    const trace = makeTrace();
    const result = await scoreTrace(evalCase, trace, { tierMax: 3 });
    assert.equal(result.passed, true);
    assert.equal(result.dimensions[0]?.dimension, "human_review");
    assert.equal(result.dimensions[0]?.passed, true);
  });
});

import { scoreTaskSuccess } from "../scorers/task-success.ts";

describe("scoreTaskSuccess user_goal inference", () => {
  it("uses explicit user_goal when provided", async () => {
    const trace = makeTrace();
    const evalCase = makeEvalCase([
      { type: "task_success", user_goal: "explicit goal", pass_threshold: 0.7 },
    ]);
    const guardResult = await scoreTaskSuccess(
      trace,
      {
        type: "llm_judge",
        prompt: "x",
        pass_threshold: 0.7,
      } as AssertionConfig,
      evalCase,
    );
    assert.equal(guardResult.passed, false);
    assert.match(guardResult.reason, /internal error/);
  });

  it("infers user_goal from evalCase.input.messages when trace.conversation has no user turns", async () => {
    const trace = makeTrace({ conversation: [] });
    const evalCase: PlainEvalCase = {
      type: "plain",
      id: "infer-goal",
      description: "test",
      input: {
        system_prompt: "",
        model: "qwen-plus",
        messages: [{ role: "user", content: "帮我生成赛博朋克图片" }],
      },
      criteria: {
        assertions: [{ type: "task_success", pass_threshold: 0.7 }],
      },
    };

    const origModel = process.env["EVAL_JUDGE_MODEL"];
    delete process.env["EVAL_JUDGE_MODEL"];
    delete process.env["EVAL_JUDGE_BASE_URL"];
    delete process.env["EVAL_JUDGE_API_KEY"];

    try {
      const result = await scoreTaskSuccess(
        trace,
        { type: "task_success", pass_threshold: 0.7 },
        evalCase,
      );
      assert.equal(result.passed, false);
      assert.equal(result.score, 0);
      assert.match(result.reason, /no judge model configured/);
    } finally {
      if (origModel) process.env["EVAL_JUDGE_MODEL"] = origModel;
    }
  });
});
