import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { caseNeedsJudge, getMissingRunConfig } from "../cli/config-check.ts";
import { normalizeAssertions } from "../utils/normalize-assertions.ts";
import type { EvalCase, EvalCriteria } from "../types.ts";

describe("normalizeAssertions", () => {
  it("returns assertions when criteria.assertions is defined", () => {
    const criteria: EvalCriteria = {
      assertions: [
        { type: "tool_usage", expected_tools: ["make_image"] },
        { type: "llm_judge", prompt: "Is it good?", pass_threshold: 0.7 },
      ],
    };

    const result = normalizeAssertions(criteria);
    assert.equal(result.length, 2);
    assert.equal(result[0]?.type, "tool_usage");
    assert.equal(result[1]?.type, "llm_judge");
  });

  it("ignores legacy fields when assertions are defined", () => {
    const criteria: EvalCriteria = {
      assertions: [{ type: "tool_usage", expected_tools: ["make_image"] }],
      // These legacy fields should be ignored
      expected_tools: ["legacy_tool"],
      llm_judge: { prompt: "legacy judge", pass_threshold: 0.5 },
    };

    const result = normalizeAssertions(criteria);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.type, "tool_usage");
    if (result[0]?.type === "tool_usage") {
      assert.deepEqual(result[0].expected_tools, ["make_image"]);
    }
  });

  it("converts legacy expected_tools to tool_usage assertion", () => {
    const criteria: EvalCriteria = {
      expected_tools: ["legacy_tool"],
    };

    const result = normalizeAssertions(criteria);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.type, "tool_usage");
    assert.deepEqual(result[0]?.expected_tools, ["legacy_tool"]);
  });

  it("converts legacy llm_judge to llm_judge assertion", () => {
    const criteria: EvalCriteria = {
      llm_judge: { prompt: "Is it helpful?", pass_threshold: 0.8 },
    };

    const result = normalizeAssertions(criteria);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.type, "llm_judge");
    assert.equal(result[0]?.prompt, "Is it helpful?");
  });

  it("combines multiple legacy fields into assertions", () => {
    const criteria: EvalCriteria = {
      expected_tools: ["tool_a"],
      expected_status: "SUCCESS",
      llm_judge: { prompt: "judge", pass_threshold: 0.5 },
    };

    const result = normalizeAssertions(criteria);
    assert.equal(result.length, 3);
    const types = result.map((a) => a.type);
    assert.ok(types.includes("tool_usage"));
    assert.ok(types.includes("final_status"));
    assert.ok(types.includes("llm_judge"));
  });

  it("returns empty array when no assertions or legacy fields", () => {
    const criteria: EvalCriteria = {};
    const result = normalizeAssertions(criteria);
    assert.equal(result.length, 0);
  });
});

describe("caseNeedsJudge", () => {
  function makePlainCase(criteria: EvalCriteria): EvalCase {
    return {
      type: "plain",
      id: "test-case",
      description: "test",
      input: {
        system_prompt: "sys",
        model: "qwen-plus",
        messages: [{ role: "user", content: "hi" }],
      },
      criteria,
    };
  }

  it("returns true when assertions contain llm_judge", () => {
    const evalCase = makePlainCase({
      assertions: [{ type: "llm_judge", prompt: "Is it good?", pass_threshold: 0.7 }],
    });
    assert.equal(caseNeedsJudge(evalCase), true);
  });

  it("returns true when assertions contain task_success", () => {
    const evalCase = makePlainCase({
      assertions: [{ type: "task_success", pass_threshold: 0.7 }],
    });
    assert.equal(caseNeedsJudge(evalCase), true);
  });

  it("returns true when assertions contain tool_parameter_accuracy", () => {
    const evalCase = makePlainCase({
      assertions: [{
        type: "tool_parameter_accuracy",
        tool_name: "make_image",
        expected_description: "prompt should mention cat",
        pass_threshold: 0.7,
      }],
    });
    assert.equal(caseNeedsJudge(evalCase), true);
  });

  it("returns false when assertions only contain tool_usage", () => {
    const evalCase = makePlainCase({
      assertions: [{ type: "tool_usage", expected_tools: ["make_image"] }],
    });
    assert.equal(caseNeedsJudge(evalCase), false);
  });

  it("returns true when legacy llm_judge is defined (and no assertions)", () => {
    const evalCase = makePlainCase({
      llm_judge: { prompt: "Is it good?", pass_threshold: 0.7 },
    });
    assert.equal(caseNeedsJudge(evalCase), true);
  });

  it("assertions take precedence over legacy llm_judge", () => {
    // When assertions are defined, legacy fields are ignored
    const evalCase = makePlainCase({
      assertions: [{ type: "tool_usage", expected_tools: ["make_image"] }],
      llm_judge: { prompt: "legacy judge", pass_threshold: 0.5 },
    });
    // Since assertions only contain tool_usage (no llm_judge), should return false
    assert.equal(caseNeedsJudge(evalCase), false);
  });

  it("respects tierMax parameter", () => {
    const evalCase = makePlainCase({
      assertions: [{ type: "llm_judge", tier: 2, prompt: "judge", pass_threshold: 0.7 }],
    });

    assert.equal(caseNeedsJudge(evalCase, { tierMax: 1 }), false);
    assert.equal(caseNeedsJudge(evalCase, { tierMax: 2 }), true);
  });
});

describe("getMissingRunConfig", () => {
  function makePlainCase(criteria: EvalCriteria): EvalCase {
    return {
      type: "plain",
      id: "test-case",
      description: "test",
      input: {
        system_prompt: "sys",
        model: "qwen-plus",
        messages: [{ role: "user", content: "hi" }],
      },
      criteria,
    };
  }

  it("returns empty array when no judge assertions", () => {
    const cases = [
      makePlainCase({
        assertions: [{ type: "tool_usage", expected_tools: ["make_image"] }],
      }),
    ];

    const missing = getMissingRunConfig(cases);
    assert.deepEqual(missing, []);
  });

  it("returns JUDGE_MODEL when llm_judge assertion present and no env", () => {
    // Clear env
    const orig = process.env["EVAL_JUDGE_MODEL"];
    delete process.env["EVAL_JUDGE_MODEL"];

    try {
      const cases = [
        makePlainCase({
          assertions: [{ type: "llm_judge", prompt: "judge", pass_threshold: 0.7 }],
        }),
      ];

      const missing = getMissingRunConfig(cases);
      assert.ok(missing.includes("EVAL_JUDGE_MODEL"));
    } finally {
      if (orig) process.env["EVAL_JUDGE_MODEL"] = orig;
    }
  });

  it("returns empty array in replay mode even with llm_judge", () => {
    const cases = [
      makePlainCase({
        assertions: [{ type: "llm_judge", prompt: "judge", pass_threshold: 0.7 }],
      }),
    ];

    const missing = getMissingRunConfig(cases, { replay: true });
    assert.deepEqual(missing, []);
  });
});