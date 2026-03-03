import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { afterEach, describe, it } from "node:test";
import { runAgent } from "../runner/agent.ts";
import { runPlain } from "../runner/plain.ts";
import type { AgentEvalCase } from "../types.ts";

type ChatRequestBody = {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
};

async function startFakeOpenAIServer(onRequest: (body: ChatRequestBody) => void) {
  const server = createServer(
    (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
      if (req.method !== "POST" || req.url !== "/chat/completions") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      let raw = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        const body = JSON.parse(raw) as ChatRequestBody;
        onRequest(body);

        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: { content: "hello" },
                finish_reason: null,
              },
            ],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: "stop",
              },
            ],
          })}\n\n`,
        );
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            choices: [],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
        res.end();
      });
    },
  );

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to get test server address");
  }

  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

describe("agent runtime oss flow", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    delete process.env["OPENAI_BASE_URL"];
    delete process.env["OPENAI_API_KEY"];
    for (const cleanup of cleanups.splice(0)) {
      await cleanup();
    }
  });

  it("runPlain supports type=agent and keeps EvalTrace.case_type=agent", async () => {
    let seenBody: ChatRequestBody | null = null;
    const fakeServer = await startFakeOpenAIServer((body) => {
      seenBody = body;
    });
    cleanups.push(fakeServer.close);

    process.env["OPENAI_BASE_URL"] = fakeServer.baseURL;
    process.env["OPENAI_API_KEY"] = "test-key";

    const trace = await runPlain(
      {
        type: "agent",
        id: "agent-plain-shape",
        description: "test",
        input: {
          system_prompt: "sys",
          model: "gpt-5.2",
          messages: [{ role: "user", content: "hi" }],
          allowed_tool_names: [],
        },
        criteria: {},
      },
      {
        mcpServerBaseURL: "http://127.0.0.1:65535",
      },
    );

    assert.equal(trace.case_type, "agent");
    assert.equal(trace.final_response, "hello");
    assert.equal(trace.conversation[0]?.role, "system");
    assert.equal(trace.conversation[1]?.role, "user");
    if (trace.conversation[1]?.role === "user") {
      assert.equal(trace.conversation[1].content, "hi");
    }

    assert.ok(seenBody, "expected openai request body");
    const captured = seenBody as ChatRequestBody;
    assert.equal(captured.messages[0]?.role, "system");
    assert.equal(captured.messages[1]?.role, "user");
    assert.equal(captured.messages[1]?.content, "hi");
  });

  it("runAgent executes Inject -> Normalize -> runPlain and keeps case_type=agent", async () => {
    let seenBody: ChatRequestBody | null = null;
    const fakeServer = await startFakeOpenAIServer((body) => {
      seenBody = body;
    });
    cleanups.push(fakeServer.close);

    process.env["OPENAI_BASE_URL"] = fakeServer.baseURL;
    process.env["OPENAI_API_KEY"] = "test-key";

    const evalCase: AgentEvalCase = {
      type: "agent",
      id: "agent-oss-runtime",
      description: "test",
      input: {
        preset_key: "legacy-key",
        system_prompt: "greet {{hero}}",
        model: "gpt-5.2",
        parameters: {
          hero: "{@character}",
        },
        messages: [{ role: "user", content: "hello {@character}" }],
        allowed_tool_names: [],
      },
      criteria: {},
    };

    const trace = await runAgent(evalCase, {
      mcpServerBaseURL: "http://127.0.0.1:65535",
      characterProvider: {
        getRandomCharacters: async () => [
          {
            uuid: "c1",
            name: "Alice",
          },
        ],
      },
    });

    assert.equal(trace.case_type, "agent");
    assert.equal(trace.final_response, "hello");
    assert.ok(seenBody, "expected openai request body");
    const captured = seenBody as ChatRequestBody;
    assert.equal(captured.messages[0]?.role, "system");
    assert.equal(captured.messages[0]?.content, "greet Alice");
    assert.equal(captured.messages[1]?.role, "user");
    assert.equal(captured.messages[1]?.content, "hello Alice");

    assert.equal(trace.conversation[1]?.role, "user");
    if (trace.conversation[1]?.role === "user") {
      assert.equal(trace.conversation[1].content, "hello Alice");
    }
  });
});
