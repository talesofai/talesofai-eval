import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractAgentCaseFromCollection } from "../online/extract.ts";
import { DEFAULT_AGENT_PRESET_KEY } from "../types.ts";

type JsonMap = Record<string, unknown>;

function jsonResponse(status: number, body: JsonMap): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("extractAgentCaseFromCollection", () => {
  it("uses verse_uuid to fetch preset and maps fields into agent eval case", async () => {
    const collectionUUID = "collection-1";
    const manuscriptUUID = "manuscript-1";
    const verseUUID = "verse-1";

    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = typeof input === "string" ? new URL(input) : input;
      if (url.pathname === "/v1/home/feed/interactive") {
        return jsonResponse(200, {
          module_list: [
            {
              json_data: {
                cta_info: {
                  launch_prompt: { core_input: "请帮我生成图" },
                  interactive_config: {
                    manuscript_uuid: manuscriptUUID,
                    verse_uuid: verseUUID,
                  },
                },
              },
            },
          ],
        });
      }

      if (url.pathname === `/v1/verse/preset/${verseUUID}`) {
        return jsonResponse(200, {
          uuid: verseUUID,
          name: "preset-a",
          toolset_keys: ["make_image_v1"],
          preset_description: "desc",
          reference_planning: "plan",
          reference_content: "content",
          preset_content_schema: "schema",
        });
      }

      return jsonResponse(404, { detail: "not found" });
    };

    const result = await extractAgentCaseFromCollection({
      baseURL: "https://example.com",
      token: "token",
      collectionUUID,
      fetchFn,
    });

    assert.equal(result.evalCase.type, "agent");
    assert.equal(result.evalCase.id, "online-collection-1");
    assert.equal(result.evalCase.input.preset_key, DEFAULT_AGENT_PRESET_KEY);
    assert.deepEqual(result.evalCase.input.allowed_tool_names, [
      "make_image_v1",
    ]);
    assert.deepEqual(result.evalCase.input.auto_followup, {
      mode: "adversarial_help_choose",
      max_turns: 1,
    });
    assert.deepEqual(result.evalCase.input.parameters, {
      preset_description: "desc",
      reference_planning: "plan",
      reference_content: "content",
      reference_content_schema: "schema",
    });

    const message = result.evalCase.input.messages[0];
    assert.ok(message);
    assert.equal(message.role, "user");
    assert.equal(message.content, "请帮我生成图");

    assert.equal(result.metadata.collectionUUID, collectionUUID);
    assert.equal(result.metadata.manuscriptUUID, manuscriptUUID);
    assert.equal(result.metadata.verseUUID, verseUUID);
    const judge = result.evalCase.criteria.assertions?.find(
      (a) => a.type === "llm_judge",
    );
    assert.ok(judge && judge.type === "llm_judge");
    assert.equal(judge.pass_threshold, 0.7);
  });

  it("fails when verse_uuid missing in feed", async () => {
    const fetchFn = async (input: string | URL): Promise<Response> => {
      const url = typeof input === "string" ? new URL(input) : input;
      if (url.pathname === "/v1/home/feed/interactive") {
        return jsonResponse(200, {
          module_list: [
            {
              json_data: {
                cta_info: {
                  launch_prompt: { core_input: "core input" },
                  interactive_config: {
                    manuscript_uuid: "manuscript-only",
                  },
                },
              },
            },
          ],
        });
      }

      return jsonResponse(404, { detail: "not found" });
    };

    await assert.rejects(
      extractAgentCaseFromCollection({
        baseURL: "https://example.com",
        token: "token",
        collectionUUID: "collection-2",
        fetchFn,
      }),
      /cta_info\.interactive_config\.verse_uuid/,
    );
  });
});
