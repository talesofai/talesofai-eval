import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

function makePlainCase(allowedToolNames?: string[]): PlainEvalCase {
  return {
    type: "plain",
    id: "plain-mcp-cache",
    description: "mcp cache",
    input: {
      system_prompt: "sys",
      model: "test-model",
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
  const originalClose = Client.prototype.close;
  let modelsFile: string | null = null;

  beforeEach(() => {
    resetRegistry();
  });

  afterEach(async () => {
    resetRegistry();
    Client.prototype.connect = originalConnect;
    Client.prototype.listTools = originalListTools;
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
    modelsFile = join(tmpdir(), `models-test-${randomUUID()}.json`);
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

  it("reuses listTools result for same baseURL + filter key within one run", async () => {
    const fakeOpenai = await startFakeOpenAIServer(() => {});
    cleanups.push(fakeOpenai.close);
    await setupTestModels(fakeOpenai.baseURL);

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
    await setupTestModels(fakeOpenai.baseURL);

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
});
