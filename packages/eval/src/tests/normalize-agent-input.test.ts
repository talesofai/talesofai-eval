import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getMissingRunConfig } from "../cli/config-check.ts";
import { normalizeAgentInput } from "../runners/normalize-agent-input.ts";
import type { AgentEvalCase } from "../types.ts";

const baseLegacyCase = (): AgentEvalCase => ({
  type: "agent",
  id: "agent-legacy",
  description: "legacy",
  input: {
    preset_key: "legacy-key",
    model: "gpt-5.2",
    parameters: {
      preset_description: "desc",
      reference_planning: "plan",
      reference_content: "content",
      reference_content_schema: "schema",
    },
    messages: [{ role: "user", content: "hello" }],
  },
  criteria: {},
});

describe("normalizeAgentInput", () => {
  afterEach(() => {
    delete process.env["OPENAI_BASE_URL"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["EVAL_UPSTREAM_API_BASE_URL"];
  });

  it("legacy path: renders inline legacy template with required params", () => {
    const result = normalizeAgentInput(baseLegacyCase());
    assert.equal(result.type, "agent");
    assert.equal(result.input.model, "gpt-5.2");
    assert.ok(result.input.system_prompt.includes("desc"));
    assert.ok(result.input.system_prompt.includes("plan"));
    assert.ok(result.input.system_prompt.includes("content"));
  });

  it("oss path: renders system_prompt template with parameters", () => {
    const evalCase: AgentEvalCase = {
      ...baseLegacyCase(),
      id: "agent-oss",
      input: {
        ...baseLegacyCase().input,
        system_prompt: "you are {{name}}",
        model: "gpt-5.2",
        parameters: { name: "neo" },
      },
    };

    const result = normalizeAgentInput(evalCase);
    assert.equal(result.input.system_prompt, "you are neo");
    assert.equal(result.input.model, "gpt-5.2");
  });

  it("legacy validation: missing required parameter throws", () => {
    const evalCase: AgentEvalCase = {
      ...baseLegacyCase(),
      input: {
        ...baseLegacyCase().input,
        parameters: {
          preset_description: "desc",
          reference_planning: "plan",
        },
      },
    };

    assert.throws(() => normalizeAgentInput(evalCase), /missing required keys/);
  });

  it("legacy validation: model absent throws", () => {
    const evalCase: AgentEvalCase = {
      ...baseLegacyCase(),
      input: {
        ...baseLegacyCase().input,
        model: undefined,
      },
    };

    assert.throws(() => normalizeAgentInput(evalCase), /legacy preset_key mode/);
  });

  it("validation: system_prompt empty string throws", () => {
    const evalCase: AgentEvalCase = {
      ...baseLegacyCase(),
      input: {
        ...baseLegacyCase().input,
        system_prompt: "  ",
        model: "gpt-5.2",
      },
    };

    assert.throws(() => normalizeAgentInput(evalCase), /non-empty string/);
  });

  it("oss validation: model absent throws when system_prompt exists", () => {
    const evalCase: AgentEvalCase = {
      ...baseLegacyCase(),
      input: {
        ...baseLegacyCase().input,
        system_prompt: "hello {{name}}",
        model: undefined,
        parameters: { name: "neo" },
      },
    };

    assert.throws(() => normalizeAgentInput(evalCase), /input\.model is required/);
  });

  it("unknown template key: keeps placeholder and logs warn", () => {
    const warns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(" "));
    };

    try {
      const evalCase: AgentEvalCase = {
        ...baseLegacyCase(),
        input: {
          ...baseLegacyCase().input,
          system_prompt: "hello {{missing_key}}",
          model: "gpt-5.2",
          parameters: {},
        },
      };

      const result = normalizeAgentInput(evalCase);
      assert.equal(result.input.system_prompt, "hello {{missing_key}}");
      assert.ok(warns.some((line) => line.includes("missing template parameter")));
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe("getMissingRunConfig for agent", () => {
  it("requires OPENAI_BASE_URL + OPENAI_API_KEY and not EVAL_UPSTREAM_API_BASE_URL", () => {
    const cases: AgentEvalCase[] = [baseLegacyCase()];

    const missing = getMissingRunConfig(cases);
    assert.ok(missing.includes("OPENAI_BASE_URL"));
    assert.ok(missing.includes("OPENAI_API_KEY"));
    assert.ok(!missing.includes("EVAL_UPSTREAM_API_BASE_URL"));
  });
});
