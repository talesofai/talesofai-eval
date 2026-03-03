import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { getMissingRunConfig } from "../cli/config-check.ts";
import { normalizeAgentInput } from "../runner/normalize-agent-input.ts";
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

const temporaryDirs: string[] = [];

describe("normalizeAgentInput", () => {
  afterEach(() => {
    delete process.env["OPENAI_BASE_URL"];
    delete process.env["OPENAI_API_KEY"];
    delete process.env["EVAL_UPSTREAM_API_BASE_URL"];
    delete process.env["EVAL_LEGACY_AGENT_PROMPT_FILE"];

    for (const dir of temporaryDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("legacy path: renders inline legacy template with required params", () => {
    const result = normalizeAgentInput(baseLegacyCase());
    assert.equal(result.type, "agent");
    assert.equal(result.input.model, "gpt-5.2");
    assert.ok(result.input.system_prompt.includes("desc"));
    assert.ok(result.input.system_prompt.includes("plan"));
    assert.ok(result.input.system_prompt.includes("content"));
  });

  it("legacy path: uses EVAL_LEGACY_AGENT_PROMPT_FILE override when set", () => {
    const dir = mkdtempSync(join(tmpdir(), "legacy-prompt-"));
    temporaryDirs.push(dir);
    const templatePath = join(dir, "legacy-template.txt");
    writeFileSync(
      templatePath,
      "OVERRIDE {{preset_description}} / {{reference_planning}} / {{reference_content}}",
      "utf8",
    );
    process.env["EVAL_LEGACY_AGENT_PROMPT_FILE"] = templatePath;

    const result = normalizeAgentInput(baseLegacyCase());
    assert.equal(result.input.system_prompt, "OVERRIDE desc / plan / content");
  });

  it("legacy path: invalid override file path throws", () => {
    process.env["EVAL_LEGACY_AGENT_PROMPT_FILE"] =
      "/tmp/not-exists-legacy-template.txt";
    assert.throws(
      () => normalizeAgentInput(baseLegacyCase()),
      /failed to read legacy prompt template file/,
    );
  });

  it("legacy path: empty override file throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "legacy-prompt-empty-"));
    temporaryDirs.push(dir);
    const templatePath = join(dir, "legacy-template-empty.txt");
    writeFileSync(templatePath, "\n\n", "utf8");
    process.env["EVAL_LEGACY_AGENT_PROMPT_FILE"] = templatePath;

    assert.throws(
      () => normalizeAgentInput(baseLegacyCase()),
      /legacy prompt template file is empty/,
    );
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

  it("renders template variables in input messages", () => {
    const evalCase: AgentEvalCase = {
      ...baseLegacyCase(),
      id: "agent-message-template",
      input: {
        ...baseLegacyCase().input,
        system_prompt: "sys",
        model: "gpt-5.2",
        parameters: { item: "magic pencil" },
        messages: [
          { role: "user", content: "draw {{item}}" },
          {
            role: "assistant",
            content: [{ type: "output_text", text: "ok {{item}}" }],
          },
        ],
      },
    };

    const result = normalizeAgentInput(evalCase);
    assert.equal(result.input.messages[0]?.role, "user");
    if (result.input.messages[0]?.role === "user") {
      assert.equal(result.input.messages[0].content, "draw magic pencil");
    }
    assert.equal(result.input.messages[1]?.role, "assistant");
    if (
      result.input.messages[1]?.role === "assistant" &&
      Array.isArray(result.input.messages[1].content)
    ) {
      assert.equal(result.input.messages[1].content[0]?.type, "output_text");
      if (result.input.messages[1].content[0]?.type === "output_text") {
        assert.equal(
          result.input.messages[1].content[0].text,
          "ok magic pencil",
        );
      }
    }
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

    assert.throws(
      () => normalizeAgentInput(evalCase),
      /legacy preset_key mode/,
    );
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

    assert.throws(
      () => normalizeAgentInput(evalCase),
      /input\.model is required/,
    );
  });

  it("unknown template key: keeps placeholder and writes stderr", () => {
    const stderrMessages: string[] = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: unknown) => {
      stderrMessages.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

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
      assert.ok(
        stderrMessages.some((line) =>
          line.includes("missing template parameter"),
        ),
      );
    } finally {
      process.stderr.write = originalWrite;
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

  it("does not require judge config when tierMax filters out judge assertions", () => {
    const cases: AgentEvalCase[] = [
      {
        ...baseLegacyCase(),
        criteria: {
          assertions: [
            {
              type: "llm_judge",
              tier: 2,
              prompt: "judge",
              pass_threshold: 0.7,
            },
          ],
        },
      },
    ];

    const missing = getMissingRunConfig(cases, { tierMax: 1 });
    assert.ok(!missing.includes("EVAL_JUDGE_MODEL"));
    assert.ok(
      !missing.includes("EVAL_JUDGE_BASE_URL|OPENAI_BASE_URL"),
      "judge base url should not be required at tierMax=1",
    );
    assert.ok(
      !missing.includes("EVAL_JUDGE_API_KEY|OPENAI_API_KEY"),
      "judge api key should not be required at tierMax=1",
    );
  });

  it("requires judge config when tierMax includes judge assertions", () => {
    const cases: AgentEvalCase[] = [
      {
        ...baseLegacyCase(),
        criteria: {
          assertions: [
            {
              type: "llm_judge",
              tier: 2,
              prompt: "judge",
              pass_threshold: 0.7,
            },
          ],
        },
      },
    ];

    const missing = getMissingRunConfig(cases, { tierMax: 2 });
    assert.ok(missing.includes("EVAL_JUDGE_MODEL"));
  });
});
