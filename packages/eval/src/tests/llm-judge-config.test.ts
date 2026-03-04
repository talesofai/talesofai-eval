import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { scoreLlmJudgeAssertion } from "../scorers/llm-judge.ts";
import type { AssertionConfig, EvalTrace } from "../types.ts";

const trace: EvalTrace = {
  case_id: "judge-config",
  case_type: "plain",
  conversation: [],
  tools_called: [],
  final_response: "ok",
  status: "success",
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  duration_ms: 1,
};

const assertion: AssertionConfig = {
  type: "llm_judge",
  prompt: "score this",
  pass_threshold: 0.7,
};

describe("scoreLlmJudgeAssertion config errors", () => {
  afterEach(() => {
    delete process.env["EVAL_JUDGE_MODEL"];
    delete process.env["EVAL_JUDGE_BASE_URL"];
    delete process.env["EVAL_JUDGE_API_KEY"];
    delete process.env["OPENAI_BASE_URL"];
    delete process.env["OPENAI_API_KEY"];
  });

  it("returns error result when EVAL_JUDGE_MODEL is missing", async () => {
    process.env["EVAL_JUDGE_BASE_URL"] = "https://judge.example/v1";
    process.env["EVAL_JUDGE_API_KEY"] = "judge-key";

    const result = await scoreLlmJudgeAssertion(trace, assertion);

    assert.equal(result.passed, false);
    assert.equal(result.score, 0);
    assert.match(result.reason, /missing required EVAL_JUDGE_MODEL/);
  });
});
