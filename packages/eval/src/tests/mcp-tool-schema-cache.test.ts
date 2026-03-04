import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { runPlain } from "../runner/plain.ts";
import type { PlainEvalCase } from "../types.ts";

type ChatRequestBody = {
  model: string;
  messages: Array<{ role: string; content: unknown }>;
};

type McpTool = {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
};

async function startFakeOpenAIServer(
  onRequest: (body: ChatRequestBody) => void,
) {
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
                delta: { content: "ok" },
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

async function startFakeOpenAIToolCallServer() {
  let requestCount = 0;

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
        JSON.parse(raw);

        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");

        if (requestCount === 0) {
          res.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-test",
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_1",
                        type: "function",
                        function: {
                          name: "tool_alpha",
                          arguments: '{"x":1}',
                        },
                      },
                    ],
                  },
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
                  finish_reason: "tool_calls",
                },
              ],
            })}\n\n`,
          );
        } else {
          res.write(
            `data: ${JSON.stringify({
              id: "chatcmpl-test",
              object: "chat.completion.chunk",
              choices: [
                {
                  index: 0,
                  delta: { content: "done" },
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

        requestCount += 1;

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

async function startFailingOpenAIServer() {
  const server = createServer(
    (_req: IncomingMessage, res: ServerResponse<IncomingMessage>) => {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "boom" }));
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

function makePlainCase(allowedToolNames?: string[]): PlainEvalCase {
  return {
    type: "plain",
    id: "plain-mcp-cache",
    description: "mcp cache",
    input: {
      system_prompt: "sys",
      model: "gpt-5.2",
      messages: [{ role: "user", content: "hello" }],
      ...(allowedToolNames ? { allowed_tool_names: allowedToolNames } : {}),
    },
    criteria: {},
  };
}

describe("run-level MCP tool schema cache", () => {
  const cleanups: Array<() => Promise<void>> = [];
  const originalConnect = Client.prototype.connect;
  const originalListTools = Client.prototype.listTools;
  const originalCallTool = Client.prototype.callTool;
  const originalClose = Client.prototype.close;

  afterEach(async () => {
    delete process.env["OPENAI_BASE_URL"];
    delete process.env["OPENAI_API_KEY"];

    Client.prototype.connect = originalConnect;
    Client.prototype.listTools = originalListTools;
    Client.prototype.callTool = originalCallTool;
    Client.prototype.close = originalClose;

    for (const cleanup of cleanups.splice(0)) {
      await cleanup();
    }
  });

  it("reuses listTools result for same baseURL + filter key within one run", async () => {
    const fakeOpenai = await startFakeOpenAIServer(() => {});
    cleanups.push(fakeOpenai.close);

    process.env["OPENAI_BASE_URL"] = fakeOpenai.baseURL;
    process.env["OPENAI_API_KEY"] = "test-key";

    let listToolsCalls = 0;
    const toolSchemas: McpTool[] = [
      {
        name: "tool_alpha",
        description: "alpha",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ];

    Client.prototype.connect = (async () => {}) as Client["connect"];
    Client.prototype.listTools = (async () => {
      listToolsCalls += 1;
      return { tools: toolSchemas };
    }) as Client["listTools"];
    Client.prototype.close = (async () => {}) as Client["close"];

    const runnerOpts = {
      mcpServerBaseURL: "http://fake-mcp",
    };

    await runPlain(makePlainCase(["tool_alpha"]), runnerOpts);
    await runPlain(makePlainCase(["tool_alpha"]), runnerOpts);

    assert.equal(listToolsCalls, 1);
  });

  it("does not reuse cache when tool filter changes", async () => {
    const fakeOpenai = await startFakeOpenAIServer(() => {});
    cleanups.push(fakeOpenai.close);

    process.env["OPENAI_BASE_URL"] = fakeOpenai.baseURL;
    process.env["OPENAI_API_KEY"] = "test-key";

    let listToolsCalls = 0;
    const toolSchemas: McpTool[] = [
      {
        name: "tool_alpha",
        description: "alpha",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "tool_beta",
        description: "beta",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
    ];

    Client.prototype.connect = (async () => {}) as Client["connect"];
    Client.prototype.listTools = (async () => {
      listToolsCalls += 1;
      return { tools: toolSchemas };
    }) as Client["listTools"];
    Client.prototype.close = (async () => {}) as Client["close"];

    const runnerOpts = {
      mcpServerBaseURL: "http://fake-mcp",
    };

    await runPlain(makePlainCase(["tool_alpha"]), runnerOpts);
    await runPlain(makePlainCase(["tool_beta"]), runnerOpts);
    await runPlain(makePlainCase(["tool_alpha"]), runnerOpts);

    assert.equal(listToolsCalls, 2);
  });

  it("records non-timeout MCP errors as tool_call_failed", async () => {
    const fakeOpenai = await startFakeOpenAIToolCallServer();
    cleanups.push(fakeOpenai.close);

    process.env["OPENAI_BASE_URL"] = fakeOpenai.baseURL;
    process.env["OPENAI_API_KEY"] = "test-key";

    Client.prototype.connect = (async () => {}) as Client["connect"];
    Client.prototype.listTools = (async () => ({
      tools: [
        {
          name: "tool_alpha",
          description: "alpha",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
    })) as Client["listTools"];
    Client.prototype.callTool = (async () => {
      throw new Error("upstream exploded");
    }) as Client["callTool"];
    Client.prototype.close = (async () => {}) as Client["close"];

    const trace = await runPlain(makePlainCase(["tool_alpha"]), {
      mcpServerBaseURL: "http://fake-mcp",
    });

    assert.deepEqual(trace.tools_called[0]?.output, {
      error: "tool_call_failed",
      message: "upstream exploded",
    });
    assert.equal(trace.final_response, "done");
  });

  it("closes MCP client even when runPlain throws", async () => {
    const fakeOpenai = await startFailingOpenAIServer();
    cleanups.push(fakeOpenai.close);

    process.env["OPENAI_BASE_URL"] = fakeOpenai.baseURL;
    process.env["OPENAI_API_KEY"] = "test-key";

    let closeCalls = 0;

    Client.prototype.connect = (async () => {}) as Client["connect"];
    Client.prototype.listTools = (async () => ({
      tools: [
        {
          name: "tool_alpha",
          description: "alpha",
          inputSchema: { type: "object", properties: {}, required: [] },
        },
      ],
    })) as Client["listTools"];
    Client.prototype.callTool = (async () => {
      return { content: [] };
    }) as Client["callTool"];
    Client.prototype.close = (async () => {
      closeCalls += 1;
    }) as Client["close"];

    await assert.rejects(
      runPlain(makePlainCase(["tool_alpha"]), {
        mcpServerBaseURL: "http://fake-mcp",
      }),
    );

    assert.equal(closeCalls, 1);
  });
});
