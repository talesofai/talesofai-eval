import assert from "node:assert/strict";
import type { AssertionConfig, EvalTrace, PlainEvalCase, SkillEvalCase } from "../types.ts";
import { describe, it } from "node:test";
import { scoreSkillUsageAssertion } from "../scorers/skill-usage.ts";

function makeTrace(overrides: Partial<EvalTrace> = {}): EvalTrace {
  return {
    case_id: "skill-case",
    case_type: "skill",
    conversation: [],
    tools_called: [],
    final_response: "done",
    status: "success",
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    duration_ms: 1000,
    ...overrides,
  };
}

function makeSkillCase(
  evaluationMode: "inject" | "discover" = "discover",
): SkillEvalCase {
  return {
    type: "skill",
    id: "skill-case",
    description: "test",
    input: {
      skill: "write-judge-prompt",
      model: "qwen-plus",
      task: "use the skill",
      evaluation_mode: evaluationMode,
    },
    criteria: { assertions: [] },
  };
}

function makePlainCase(): PlainEvalCase {
  return {
    type: "plain",
    id: "plain-case",
    description: "test",
    input: {
      system_prompt: "",
      model: "qwen-plus",
      messages: [{ role: "user", content: "hi" }],
    },
    criteria: { assertions: [] },
  };
}

describe("scoreSkillUsageAssertion", () => {
  it("passes skill_loaded when discover trace reads the target skill", async () => {
    const trace = makeTrace({
      tools_called: [
        {
          name: "read",
          arguments: { path: "write-judge-prompt/SKILL.md" },
          output: "---\nname: write-judge-prompt\n---\nbody",
          duration_ms: 5,
        },
      ],
      skill_resolution: {
        source: "cli",
        root_dir: "/skills",
        skill_name: "write-judge-prompt",
        skill_path: "/skills/write-judge-prompt/SKILL.md",
      },
    });

    const result = await scoreSkillUsageAssertion(
      trace,
      { type: "skill_usage", checks: ["skill_loaded"] },
      makeSkillCase("discover"),
    );

    assert.equal(result.dimension, "skill_usage");
    assert.equal(result.passed, true);
    assert.equal(result.score, 1);
    assert.match(result.reason, /skill_loaded/);
  });

  it("fails skill_loaded when discover trace reads only another skill", async () => {
    const trace = makeTrace({
      tools_called: [
        {
          name: "read",
          arguments: { path: "different-skill/SKILL.md" },
          output: "---\nname: different-skill\n---\nbody",
          duration_ms: 5,
        },
      ],
      skill_resolution: {
        source: "cli",
        root_dir: "/skills",
        skill_name: "write-judge-prompt",
        skill_path: "/skills/write-judge-prompt/SKILL.md",
      },
    });

    const result = await scoreSkillUsageAssertion(
      trace,
      { type: "skill_usage", checks: ["skill_loaded"] },
      makeSkillCase("discover"),
    );

    assert.equal(result.passed, false);
    assert.equal(result.score, 0);
    assert.match(result.reason, /skill_loaded/);
  });

  it("does not count failed read output as skill_loaded", async () => {
    const trace = makeTrace({
      tools_called: [
        {
          name: "read",
          arguments: { path: "write-judge-prompt/SKILL.md" },
          output: "Error: File not found: write-judge-prompt/SKILL.md",
          duration_ms: 5,
        },
      ],
      skill_resolution: {
        source: "cli",
        root_dir: "/skills",
        skill_name: "write-judge-prompt",
        skill_path: "/skills/write-judge-prompt/SKILL.md",
      },
    });

    const result = await scoreSkillUsageAssertion(
      trace,
      { type: "skill_usage", checks: ["skill_loaded"] },
      makeSkillCase("discover"),
    );

    assert.equal(result.passed, false);
    assert.equal(result.score, 0);
  });

  it("fails gracefully for non-skill cases", async () => {
    const result = await scoreSkillUsageAssertion(
      makeTrace(),
      { type: "skill_usage", checks: ["workflow_followed"] },
      makePlainCase(),
    );

    assert.equal(result.passed, false);
    assert.equal(result.score, 0);
    assert.match(result.reason, /skill case/i);
  });

  it("fails gracefully when trace has no skill_resolution", async () => {
    const result = await scoreSkillUsageAssertion(
      makeTrace(),
      { type: "skill_usage", checks: ["workflow_followed"] },
      makeSkillCase("discover"),
    );

    assert.equal(result.passed, false);
    assert.equal(result.score, 0);
    assert.match(result.reason, /skill_resolution/);
  });

  it("semantic checks reach the judge path and fail cleanly without judge config", async () => {
    const trace = makeTrace({
      final_response: "I used the skill",
      skill_resolution: {
        source: "cli",
        root_dir: "/missing-root",
        skill_name: "write-judge-prompt",
        skill_path: "/missing-root/write-judge-prompt/SKILL.md",
        skill_content: "---\nname: write-judge-prompt\n---\nFollow the workflow.",
      } as EvalTrace["skill_resolution"] & { skill_content: string },
    });

    const assertion: AssertionConfig = {
      type: "skill_usage",
      checks: ["workflow_followed", "skill_influenced_output"],
      pass_threshold: 0.7,
    };

    const originalJudgeModel = process.env["EVAL_JUDGE_MODEL"];
    const originalJudgeModels = process.env["EVAL_JUDGE_MODELS"];

    delete process.env["EVAL_JUDGE_MODEL"];
    delete process.env["EVAL_JUDGE_MODELS"];

    try {
      const result = await scoreSkillUsageAssertion(
        trace,
        assertion,
        makeSkillCase("discover"),
      );

      assert.equal(result.passed, false);
      assert.equal(result.score, 0);
      assert.match(result.reason, /no judge model configured/);
    } finally {
      if (originalJudgeModel === undefined) {
        delete process.env["EVAL_JUDGE_MODEL"];
      } else {
        process.env["EVAL_JUDGE_MODEL"] = originalJudgeModel;
      }

      if (originalJudgeModels === undefined) {
        delete process.env["EVAL_JUDGE_MODELS"];
      } else {
        process.env["EVAL_JUDGE_MODELS"] = originalJudgeModels;
      }
    }
  });

  it("prefers embedded skill_content over disk fallback when present", async () => {
    const trace = makeTrace({
      final_response: "I used the skill",
      skill_resolution: {
        source: "cli",
        root_dir: "/definitely-missing-root",
        skill_name: "write-judge-prompt",
        skill_path: "/definitely-missing-root/write-judge-prompt/SKILL.md",
        skill_content: "---\nname: write-judge-prompt\n---\nUse the workflow.",
      } as EvalTrace["skill_resolution"] & { skill_content: string },
    });

    const originalJudgeModel = process.env["EVAL_JUDGE_MODEL"];
    const originalJudgeModels = process.env["EVAL_JUDGE_MODELS"];

    delete process.env["EVAL_JUDGE_MODEL"];
    delete process.env["EVAL_JUDGE_MODELS"];

    try {
      const result = await scoreSkillUsageAssertion(
        trace,
        {
          type: "skill_usage",
          checks: ["workflow_followed"],
          pass_threshold: 0.7,
        },
        makeSkillCase("discover"),
      );

      assert.equal(result.passed, false);
      assert.equal(result.score, 0);
      assert.match(result.reason, /no judge model configured/);
    } finally {
      if (originalJudgeModel === undefined) {
        delete process.env["EVAL_JUDGE_MODEL"];
      } else {
        process.env["EVAL_JUDGE_MODEL"] = originalJudgeModel;
      }

      if (originalJudgeModels === undefined) {
        delete process.env["EVAL_JUDGE_MODELS"];
      } else {
        process.env["EVAL_JUDGE_MODELS"] = originalJudgeModels;
      }
    }
  });
});
