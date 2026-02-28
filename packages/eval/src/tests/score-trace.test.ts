import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreTrace } from "../scorers/index.ts";
import type { EvalTrace, PlainEvalCase } from "../types.ts";

const makeTrace = (toolNames: string[]): EvalTrace => ({
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
  status: "success",
  usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
  duration_ms: 1000,
});

describe("scoreTrace", () => {
  it("passes with matching tool criteria and no llm_judge", async () => {
    const evalCase: PlainEvalCase = {
      type: "plain",
      id: "test-1",
      description: "test",
      input: {
        system_prompt: "",
        model: "qwen-plus",
        openai_base_url: "https://example.com",
        messages: [{ role: "user", content: "hi" }],
      },
      criteria: {
        assertions: [
          {
            type: "tool_usage",
            expected_tools: ["make_image"],
          },
        ],
      },
    };

    const trace = makeTrace(["make_image"]);
    const result = await scoreTrace(evalCase, trace);

    assert.equal(result.passed, true);
    assert.equal(result.dimensions.length, 1);
    assert.equal(result.dimensions[0]?.dimension, "tool_usage");
    assert.equal(result.case_id, "test-1");
  });

  it("fails when tool criteria not met", async () => {
    const evalCase: PlainEvalCase = {
      type: "plain",
      id: "test-2",
      description: "test",
      input: {
        system_prompt: "",
        model: "qwen-plus",
        openai_base_url: "https://example.com",
        messages: [{ role: "user", content: "hi" }],
      },
      criteria: {
        assertions: [
          {
            type: "tool_usage",
            expected_tools: ["make_image"],
            forbidden_tools: ["delete_assign"],
          },
        ],
      },
    };

    const trace = makeTrace(["delete_assign"]);
    const result = await scoreTrace(evalCase, trace);

    assert.equal(result.passed, false);
    assert.equal(result.dimensions.length, 1);
  });

  it("passes with empty criteria", async () => {
    const evalCase: PlainEvalCase = {
      type: "plain",
      id: "test-3",
      description: "test",
      input: {
        system_prompt: "",
        model: "qwen-plus",
        openai_base_url: "https://example.com",
        messages: [{ role: "user", content: "hi" }],
      },
      criteria: {},
    };

    const trace = makeTrace(["make_image"]);
    const result = await scoreTrace(evalCase, trace);

    assert.equal(result.passed, true);
    assert.equal(result.dimensions.length, 0);
  });
});
