import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type OpenAI from "openai";
import { callJudge } from "../utils/judge-client.ts";

function makeFakeOpenAI(jsonContent: string): OpenAI {
  return {
    chat: {
      completions: {
        create: async () => ({
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [
                {
                  delta: {
                    content: jsonContent,
                  },
                },
              ],
            };
          },
        }),
      },
    },
  } as unknown as OpenAI;
}

describe("callJudge", () => {
  it("returns parsed score+reason when judge output is valid", async () => {
    const openai = makeFakeOpenAI('{"score":0.8,"reason":"ok"}');

    const result = await callJudge(openai, "judge-model", "sys", "user", 0);

    assert.deepEqual(result, { score: 0.8, reason: "ok" });
  });

  it("returns error when judge score is out of [0,1] range", async () => {
    const openai = makeFakeOpenAI('{"score":1.2,"reason":"too high"}');

    const result = await callJudge(openai, "judge-model", "sys", "user", 0);

    assert.equal("error" in result, true);
    if ("error" in result) {
      assert.match(result.error, /out of range \[0,1\]/);
    }
  });
});
