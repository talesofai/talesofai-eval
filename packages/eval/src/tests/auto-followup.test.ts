import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAdversarialHelpChooseMessage,
  shouldInjectAdversarialHelpChooseFollowup,
} from "../runner/auto-followup.ts";
import type { AgentEvalCase } from "../types.ts";

function makeAgentCase(overrides?: {
  auto_followup?: AgentEvalCase["input"]["auto_followup"];
}): AgentEvalCase {
  return {
    type: "agent",
    id: "followup-case",
    description: "test",
    input: {
      preset_key: "latitude://8|live|running_agent_new",
      parameters: {
        preset_description: "",
        reference_planning: "",
        reference_content: "",
        reference_content_schema: "",
      },
      messages: [{ role: "user", content: "开始" }],
      auto_followup: overrides?.auto_followup,
    },
    criteria: {},
  };
}

describe("auto followup policy", () => {
  it("builds adversarial followup message", () => {
    assert.deepEqual(buildAdversarialHelpChooseMessage(), {
      role: "user",
      content: "你帮我选两个角色，直接继续。",
    });
  });

  it("injects when combined signals match", () => {
    const evalCase = makeAgentCase({
      auto_followup: { mode: "adversarial_help_choose", max_turns: 1 },
    });

    const decision = shouldInjectAdversarialHelpChooseFollowup({
      evalCase,
      followupTurnsUsed: 0,
      turnStatus: "success",
      turnFinalResponse: "请先选两个角色吧，我来继续。",
      turnToolCalls: 0,
    });

    assert.equal(decision, true);
  });

  it("does not inject when only role word appears without request tone", () => {
    const evalCase = makeAgentCase({
      auto_followup: { mode: "adversarial_help_choose", max_turns: 1 },
    });

    const decision = shouldInjectAdversarialHelpChooseFollowup({
      evalCase,
      followupTurnsUsed: 0,
      turnStatus: "success",
      turnFinalResponse: "我已经完成角色设定。",
      turnToolCalls: 0,
    });

    assert.equal(decision, false);
  });

  it("does not inject when tool already called", () => {
    const evalCase = makeAgentCase({
      auto_followup: { mode: "adversarial_help_choose", max_turns: 1 },
    });

    const decision = shouldInjectAdversarialHelpChooseFollowup({
      evalCase,
      followupTurnsUsed: 0,
      turnStatus: "success",
      turnFinalResponse: "请选两个角色。",
      turnToolCalls: 1,
    });

    assert.equal(decision, false);
  });
});
