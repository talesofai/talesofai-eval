import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreFinalStatusAssertion } from "../scorers/status.ts";
import { scoreToolUsageAssertion } from "../scorers/tool.ts";
import type { AssertionConfig, EvalTrace } from "../types.ts";

const makeTrace = (
  toolNames: string[],
  status: EvalTrace["status"] = "success",
): EvalTrace => ({
  case_id: "test",
  case_type: "plain",
  conversation: [],
  tools_called: toolNames.map((name, index) => ({
    tool_call_id: `tool-${index + 1}`,
    name,
    arguments: {},
    output: "ok",
    duration_ms: 100,
  })),
  final_response: "done",
  status,
  usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
  duration_ms: 1000,
});

describe("scoreToolUsageAssertion", () => {
  it("passes when expected tools are present", () => {
    const trace = makeTrace(["make_image", "update_assign"]);
    const assertion: AssertionConfig = {
      type: "tool_usage",
      expected_tools: ["make_image"],
    };
    const result = scoreToolUsageAssertion(trace, assertion);
    assert.equal(result.passed, true);
    assert.equal(result.score, 1);
    assert.equal(result.dimension, "tool_usage");
  });

  it("fails when expected tool is missing", () => {
    const trace = makeTrace(["update_assign"]);
    const assertion: AssertionConfig = {
      type: "tool_usage",
      expected_tools: ["make_image"],
    };
    const result = scoreToolUsageAssertion(trace, assertion);
    assert.equal(result.passed, false);
    assert.equal(result.score, 0);
    assert.ok(result.reason.includes("missing"));
  });

  it("fails when forbidden tool is used", () => {
    const trace = makeTrace(["make_image", "delete_assign"]);
    const assertion: AssertionConfig = {
      type: "tool_usage",
      forbidden_tools: ["delete_assign"],
    };
    const result = scoreToolUsageAssertion(trace, assertion);
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes("forbidden"));
  });

  it("passes when expected + forbidden both satisfied", () => {
    const trace = makeTrace(["make_image"]);
    const assertion: AssertionConfig = {
      type: "tool_usage",
      expected_tools: ["make_image"],
      forbidden_tools: ["delete_assign"],
    };
    const result = scoreToolUsageAssertion(trace, assertion);
    assert.equal(result.passed, true);
  });

  it("fails with both missing and forbidden violations", () => {
    const trace = makeTrace(["delete_assign"]);
    const assertion: AssertionConfig = {
      type: "tool_usage",
      expected_tools: ["make_image"],
      forbidden_tools: ["delete_assign"],
    };
    const result = scoreToolUsageAssertion(trace, assertion);
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes("missing"));
    assert.ok(result.reason.includes("forbidden"));
  });
});

describe("scoreFinalStatusAssertion", () => {
  it("passes when status matches expected", () => {
    const trace = makeTrace([], "success");
    const assertion: AssertionConfig = {
      type: "final_status",
      expected_status: "SUCCESS",
    };
    const result = scoreFinalStatusAssertion(trace, assertion);
    assert.equal(result.passed, true);
    assert.equal(result.dimension, "final_status");
  });

  it("fails when status does not match", () => {
    const trace = makeTrace([], "failure");
    const assertion: AssertionConfig = {
      type: "final_status",
      expected_status: "SUCCESS",
    };
    const result = scoreFinalStatusAssertion(trace, assertion);
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes("expected SUCCESS"));
  });

  it("maps cancelled to STOP", () => {
    const trace = makeTrace([], "cancelled");
    const assertion: AssertionConfig = {
      type: "final_status",
      expected_status: "FAILURE",
    };
    const result = scoreFinalStatusAssertion(trace, assertion);
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes("STOP"));
  });
});
