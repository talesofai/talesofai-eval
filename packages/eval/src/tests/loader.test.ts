import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildFromFlags } from "../loader/inline.ts";
import { parseInlineJson, parseYamlFile } from "../loader/yaml.ts";

const FIXTURES_DIR = join(import.meta.dirname, "..", "cases");

describe("parseYamlFile", () => {
  it("parses plain example YAML", () => {
    const c = parseYamlFile(join(FIXTURES_DIR, "plain-example.eval.yaml"));
    assert.equal(c.type, "plain");
    assert.equal(c.id, "plain-tone-example");
    if (c.type === "plain") {
      assert.equal(c.input.model, "qwen-plus");
      assert.ok(c.input.system_prompt.length > 0);
      assert.equal(c.input.messages.length, 1);
    }
    const judge = c.criteria.assertions?.find((a) => a.type === "llm_judge");
    assert.ok(judge && judge.type === "llm_judge");
    assert.equal(judge.pass_threshold, 0.7);
  });

  it("parses agent example YAML", () => {
    const c = parseYamlFile(join(FIXTURES_DIR, "agent-example.eval.yaml"));
    assert.equal(c.type, "agent");
    assert.equal(c.id, "agent-make-image-example");
    if (c.type === "agent") {
      assert.equal(c.input.preset_key, "latitude://8|live|running_agent_new");
      assert.deepEqual(c.input.allowed_tool_names, [
        "make_image_v1",
        "make_video_v1",
        "make_song_v1",
        "remove_background_v1",
        "remove_background_nocrop_v1",
        "request_character_or_elementum_v1",
        "search_character_or_elementum_v1",
        "request_bgm_v1",
        "list_assigns_v1",
        "update_assign_v1",
        "get_assign_v1",
        "get_hashtag_collections",
        "get_hashtag_info",
        "edit_html_v1",
        "apply_html_v1",
        "see_html_v1",
      ]);
    }
    const toolUsage = c.criteria.assertions?.find(
      (a) => a.type === "tool_usage",
    );
    assert.ok(toolUsage && toolUsage.type === "tool_usage");
    assert.deepEqual(toolUsage.expected_tools, ["make_image_v1"]);
  });

  it("throws on invalid YAML", () => {
    assert.throws(() => {
      parseInlineJson('{"type":"invalid"}');
    });
  });

  it("parses valid skill case yaml", () => {
    const c = parseInlineJson(
      JSON.stringify({
        type: "skill",
        id: "skill-inline",
        description: "skill test",
        input: {
          skill: "write-judge-prompt",
          model: "qwen-plus",
          task: "do task",
          evaluation_mode: "discover",
        },
        criteria: {},
      }),
    );

    assert.equal(c.type, "skill");
    if (c.type === "skill") {
      assert.equal(c.input.skill, "write-judge-prompt");
      assert.equal(c.input.task, "do task");
      assert.equal(c.input.evaluation_mode, "discover");
    }
  });

  it("rejects invalid skill case yaml missing required fields", () => {
    assert.throws(() => {
      parseInlineJson(
        JSON.stringify({
          type: "skill",
          id: "skill-invalid",
          description: "bad",
          input: {
            model: "qwen-plus",
            task: "missing skill field",
          },
          criteria: {},
        }),
      );
    });
  });
});

describe("parseInlineJson", () => {
  it("fills default preset_key for agent inline JSON", () => {
    const c = parseInlineJson(
      JSON.stringify({
        type: "agent",
        id: "agent-inline-default-preset",
        description: "test",
        input: {
          parameters: {
            preset_description: "",
            reference_planning: "",
            reference_content: "",
            reference_content_schema: "",
          },
          messages: [{ role: "user", content: "hi" }],
        },
        criteria: {},
      }),
    );

    assert.equal(c.type, "agent");
    if (c.type === "agent") {
      assert.equal(c.input.preset_key, "latitude://8|live|running_agent_new");
    }
  });

  it("rejects agent inline JSON missing required parameters", () => {
    assert.throws(() => {
      parseInlineJson(
        JSON.stringify({
          type: "agent",
          id: "agent-inline-missing-params",
          description: "test",
          input: {
            parameters: {},
            messages: [{ role: "user", content: "hi" }],
          },
          criteria: {},
        }),
      );
    });
  });

  it("parses agent auto_followup config", () => {
    const c = parseInlineJson(
      JSON.stringify({
        type: "agent",
        id: "agent-inline-auto-followup",
        description: "test",
        input: {
          parameters: {
            preset_description: "",
            reference_planning: "",
            reference_content: "",
            reference_content_schema: "",
          },
          messages: [{ role: "user", content: "hi" }],
          auto_followup: {
            mode: "adversarial_help_choose",
            max_turns: 1,
          },
        },
        criteria: {},
      }),
    );

    assert.equal(c.type, "agent");
    if (c.type === "agent") {
      assert.equal(c.input.auto_followup?.mode, "adversarial_help_choose");
      assert.equal(c.input.auto_followup?.max_turns, 1);
    }
  });

  it("parses oss agent inline JSON with system_prompt + model", () => {
    const c = parseInlineJson(
      JSON.stringify({
        type: "agent",
        id: "agent-inline-oss",
        description: "test",
        input: {
          system_prompt: "you are {{name}}",
          model: "gpt-5.2",
          parameters: { name: "neo" },
          messages: [{ role: "user", content: "hi" }],
        },
        criteria: {},
      }),
    );

    assert.equal(c.type, "agent");
    if (c.type === "agent") {
      assert.equal(c.input.system_prompt, "you are {{name}}");
      assert.equal(c.input.model, "gpt-5.2");
    }
  });

  it("parses valid inline JSON", () => {
    const c = parseInlineJson(
      JSON.stringify({
        type: "plain",
        id: "test-inline",
        description: "test",
        input: {
          system_prompt: "hello",
          model: "qwen-plus",
          messages: [{ role: "user", content: "hi" }],
        },
        criteria: {},
      }),
    );
    assert.equal(c.type, "plain");
    assert.equal(c.id, "test-inline");
  });

  it("rejects invalid JSON structure", () => {
    assert.throws(() => {
      parseInlineJson('{"type":"plain","id":"x"}');
    });
  });

  it("rejects unknown assertion type at load time", () => {
    assert.throws(() => {
      parseInlineJson(
        JSON.stringify({
          type: "plain",
          id: "plain-unknown-assertion",
          description: "test",
          input: {
            system_prompt: "hi",
            model: "qwen-plus",
            messages: [{ role: "user", content: "hi" }],
          },
          criteria: {
            assertions: [
              {
                type: "unknown",
              },
            ],
          },
        }),
      );
    });
  });
});

describe("buildFromFlags", () => {
  it("builds a plain case from flags", () => {
    const c = buildFromFlags({
      type: "plain",
      systemPrompt: "you are a helper",
      model: "qwen-plus",
      messages: ["user:hello", "assistant:hi there", "user:help me"],
      expectedTools: ["make_image"],
      judgePrompt: "should be helpful",
    });
    assert.equal(c.type, "plain");
    if (c.type === "plain") {
      assert.equal(c.input.system_prompt, "you are a helper");
      assert.equal(c.input.model, "qwen-plus");
      assert.equal(c.input.messages.length, 3);
      assert.equal(c.input.messages[0]?.role, "user");
      assert.equal(c.input.messages[1]?.role, "assistant");
      assert.equal(c.input.messages[2]?.role, "user");
    }
    const toolUsage = c.criteria.assertions?.find(
      (a) => a.type === "tool_usage",
    );
    assert.ok(toolUsage && toolUsage.type === "tool_usage");
    assert.deepEqual(toolUsage.expected_tools, ["make_image"]);

    const judge = c.criteria.assertions?.find((a) => a.type === "llm_judge");
    assert.ok(judge && judge.type === "llm_judge");
  });

  it("builds an agent case when presetKey provided", () => {
    const c = buildFromFlags({
      type: "agent",
      presetKey: "verse_creator",
      parameters: {
        preset_description: "",
        reference_planning: "",
        reference_content: "",
        reference_content_schema: "",
      },
      messages: ["user:make a cat image"],
    });
    assert.equal(c.type, "agent");
    if (c.type === "agent") {
      assert.equal(c.input.preset_key, "verse_creator");
    }
  });

  it("builds an oss agent case when systemPrompt is provided", () => {
    const c = buildFromFlags({
      type: "agent",
      systemPrompt: "you are {{name}}",
      model: "gpt-5.2",
      parameters: { name: "neo" },
      messages: ["user:hello"],
    });
    assert.equal(c.type, "agent");
    if (c.type === "agent") {
      assert.equal(c.input.system_prompt, "you are {{name}}");
      assert.equal(c.input.model, "gpt-5.2");
    }
  });

  it("uses default preset key for agent when presetKey missing", () => {
    const c = buildFromFlags({
      type: "agent",
      parameters: {
        preset_description: "",
        reference_planning: "",
        reference_content: "",
        reference_content_schema: "",
      },
      messages: ["user:make a cat image"],
    });
    assert.equal(c.type, "agent");
    if (c.type === "agent") {
      assert.equal(c.input.preset_key, "latitude://8|live|running_agent_new");
    }
  });

  it("generates tmp id when not specified", () => {
    const c = buildFromFlags({
      messages: ["hello"],
    });
    assert.ok(c.id.startsWith("tmp-"));
  });

  it("rejects agent case missing required parameters", () => {
    assert.throws(() => {
      buildFromFlags({
        type: "agent",
        messages: ["user:make a cat image"],
      });
    });
  });

  it("defaults role to user when no prefix", () => {
    const c = buildFromFlags({
      messages: ["just text without role prefix"],
    });
    if (c.type !== "skill") {
      assert.equal(c.input.messages[0]?.role, "user");
    }
  });
});
