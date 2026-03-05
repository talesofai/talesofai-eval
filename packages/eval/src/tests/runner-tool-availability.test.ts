import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { loadModels, resetRegistry } from "../models/index.ts";
import { runPlain } from "../runner/plain/index.ts";
import type { PlainEvalCase } from "../types.ts";

type ChatRequestBody = {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: Array<{ type: string; function: { name: string } }>;
};

type ToolCallChunk = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

async function startFakeOpenAIServer(options: {
  onRequest?: (body: ChatRequestBody) => void;
  responseContent?: string;
  toolCalls?: ToolCallChunk[];
}) {
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
        options.onRequest?.(body);

        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");

        if (options.toolCalls && options.toolCalls.length > 0) {
          for (const tc of options.toolCalls) {
            res.write(
              `data: ${JSON.stringify({
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                choices: [
                  {
                    index: 0,
                    delta: {
                      tool_calls: [tc],
                    },
                    finish_reason: null,
                  },
                ],
              })}\n\n`,
            );
          }
          res.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-test",
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: "tool_calls",
                },
              ],
            })}\n\n`,
          );
        } else {
          const content = options.responseContent ?? "hello";
          res.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-test",
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: { content },
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
        }

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

describe("runner tool availability behavior", () => {
  const cleanups: Array<() => Promise<void>> = [];
  const originalConnect = Client.prototype.connect;
  const originalListTools = Client.prototype.listTools;
  const originalCallTool = Client.prototype.callTool;
  const originalClose = Client.prototype.close;
  let modelsFile: string | null = null;

  beforeEach(() => {
    resetRegistry();
  });

  afterEach(async () => {
    resetRegistry();
    Client.prototype.connect = originalConnect;
    Client.prototype.listTools = originalListTools;
    Client.prototype.callTool = originalCallTool;
    Client.prototype.close = originalClose;

    for (const cleanup of cleanups.splice(0)) {
      await cleanup();
    }
    if (modelsFile) {
      try {
        await unlink(modelsFile);
      } catch {
        // ignore
      }
      modelsFile = null;
    }
  });

  async function setupTestModels(baseURL: string) {
    modelsFile = join(tmpdir(), `models-test-${Date.now()}.json`);
    await writeFile(
      modelsFile,
      JSON.stringify({
        models: {
          "test-model": {
            id: "test-model",
            name: "Test Model",
            api: "openai-completions",
            provider: "test",
            baseUrl: baseURL,
            apiKey: "test-key",
          },
        },
      }),
    );
    await loadModels(modelsFile);
  }

  it("returns error trace when model returns tool calls but tools are explicitly disabled (allowed_tool_names: [])", async () => {
    const fakeServer = await startFakeOpenAIServer({
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "make_image", arguments: '{"prompt": "cat"}' },
        },
      ],
    });
    cleanups.push(fakeServer.close);
    await setupTestModels(fakeServer.baseURL);

    const evalCase: PlainEvalCase = {
      type: "plain",
      id: "tool-disabled-error",
      description: "test",
      input: {
        system_prompt: "sys",
        model: "test-model",
        messages: [{ role: "user", content: "make a cat" }],
        allowed_tool_names: [],
      },
      criteria: {},
    };

    const trace = await runPlain(evalCase, {
      mcpServerBaseURL: "http://127.0.0.1:65535",
    });

    assert.equal(trace.status, "error");
    assert.ok(trace.error?.includes("tool calls but tools are not available"));
  });

  it("returns error trace when model returns tool calls but no MCP client available", async () => {
    const fakeServer = await startFakeOpenAIServer({
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "search_web", arguments: '{"query": "cats"}' },
        },
      ],
    });
    cleanups.push(fakeServer.close);
    await setupTestModels(fakeServer.baseURL);

    const evalCase: PlainEvalCase = {
      type: "plain",
      id: "no-mcp-error",
      description: "test",
      input: {
        system_prompt: "sys",
        model: "test-model",
        messages: [{ role: "user", content: "search for cats" }],
      },
      criteria: {},
    };

    const trace = await runPlain(evalCase, {
      mcpServerBaseURL: "http://127.0.0.1:65535",
    });

    assert.equal(trace.status, "error");
    assert.ok(trace.error);
  });

  it("succeeds when model returns text response and tools are disabled", async () => {
    const fakeServer = await startFakeOpenAIServer({
      responseContent: "I cannot make images right now.",
    });
    cleanups.push(fakeServer.close);
    await setupTestModels(fakeServer.baseURL);

    const evalCase: PlainEvalCase = {
      type: "plain",
      id: "tool-disabled-success",
      description: "test",
      input: {
        system_prompt: "sys",
        model: "test-model",
        messages: [{ role: "user", content: "make a cat" }],
        allowed_tool_names: [],
      },
      criteria: {},
    };

    const trace = await runPlain(evalCase, {
      mcpServerBaseURL: "http://127.0.0.1:65535",
    });

    assert.equal(trace.status, "success");
    assert.equal(trace.final_response, "I cannot make images right now.");
    assert.equal(trace.tools_called.length, 0);
  });
});
