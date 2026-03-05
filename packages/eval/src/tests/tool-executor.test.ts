import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseToolOutput } from "../metrics/trace-metrics.ts";
import { executeSingleToolCall } from "../runner/minimal-agent/tool-executor.ts";
import { SpanCollector } from "../utils/span-collector.ts";

const makeCtx = (mcpClient: {
  listTools: () => Promise<unknown[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  close: () => Promise<void>;
}) =>
  ({
    model: {} as any,
    tools: [],
    mcpClient,
    context: { systemPrompt: "", messages: [] },
    conversation: [],
    spans: new SpanCollector(),
    startTime: Date.now(),
    toolsExplicitlyDisabled: false,
  }) as any;

describe("executeSingleToolCall isError propagation", () => {
  it("propagates MCP isError=true to ToolResultMessage and trace output", async () => {
    const result = await executeSingleToolCall({
      toolCall: {
        id: "call-1",
        name: "make_image",
        arguments: { prompt: "cat" },
      } as any,
      ctx: makeCtx({
        listTools: async () => [],
        callTool: async () => ({
          content: [{ type: "text", text: "rate limited" }],
          isError: true,
        }),
        close: async () => {},
      }),
      spanCollector: new SpanCollector(),
      parentSpanName: "turn_0",
      opts: { mcpServerBaseURL: "http://fake-mcp" },
    });

    assert.equal(result.toolResult.isError, true);
    assert.equal(parseToolOutput(result.record.output).explicitError, true);
  });

  it("propagates MCP isError=false to ToolResultMessage", async () => {
    const content = [{ type: "text", text: "ok" }];
    const result = await executeSingleToolCall({
      toolCall: {
        id: "call-1",
        name: "make_image",
        arguments: { prompt: "cat" },
      } as any,
      ctx: makeCtx({
        listTools: async () => [],
        callTool: async () => ({
          content,
          isError: false,
        }),
        close: async () => {},
      }),
      spanCollector: new SpanCollector(),
      parentSpanName: "turn_0",
      opts: { mcpServerBaseURL: "http://fake-mcp" },
    });

    assert.equal(result.toolResult.isError, false);
    assert.deepEqual(result.record.output, content);
  });

  it("sets timeout span error when MCP call throws timeout", async () => {
    const spans = new SpanCollector();
    const result = await executeSingleToolCall({
      toolCall: {
        id: "call-1",
        name: "make_image",
        arguments: { prompt: "cat" },
      } as any,
      ctx: makeCtx({
        listTools: async () => [],
        callTool: async () => {
          throw new Error("timeout");
        },
        close: async () => {},
      }),
      spanCollector: spans,
      parentSpanName: "turn_0",
      opts: { mcpServerBaseURL: "http://fake-mcp" },
    });

    assert.equal(result.toolResult.isError, true);
    assert.equal(parseToolOutput(result.record.output).explicitError, true);
    assert.equal(spans.getSpans()[0]?.attributes?.error, "timeout");
  });

  it("sets generic tool_error span error when MCP call throws non-timeout", async () => {
    const spans = new SpanCollector();
    const result = await executeSingleToolCall({
      toolCall: {
        id: "call-1",
        name: "make_image",
        arguments: { prompt: "cat" },
      } as any,
      ctx: makeCtx({
        listTools: async () => [],
        callTool: async () => {
          throw new Error("connection reset");
        },
        close: async () => {},
      }),
      spanCollector: spans,
      parentSpanName: "turn_0",
      opts: { mcpServerBaseURL: "http://fake-mcp" },
    });

    assert.equal(result.toolResult.isError, true);
    assert.equal(spans.getSpans()[0]?.attributes?.error, "tool_error");
    const output = result.record.output as { error?: string };
    assert.equal(output.error, "tool_call_failed");
  });
});
