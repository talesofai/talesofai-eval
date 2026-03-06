import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseToolOutput } from "../metrics/trace-metrics.ts";
import { createReadFileTool } from "../runner/builtin-tools/read-file.ts";
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

const makeBuiltinCtx = (skillsRoot: string) => {
  const readFileTool = createReadFileTool(skillsRoot);

  return {
    model: {} as any,
    tools: [],
    builtinTools: new Map([[readFileTool.name, readFileTool]]),
    mcpClient: null,
    context: { systemPrompt: "", messages: [] },
    conversation: [],
    spans: new SpanCollector(),
    startTime: Date.now(),
    toolsExplicitlyDisabled: false,
  } as any;
};

function createSkillsRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(root, { recursive: true });
  return root;
}

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

  it("executes builtin read tool from explicit skills root and records call", async () => {
    const skillsRoot = createSkillsRoot("tool-executor-builtin-");
    const skillName = `test-builtin-${Date.now()}`;
    const skillDir = join(skillsRoot, skillName);
    mkdirSync(skillDir, { recursive: true });

    try {
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\nname: ${skillName}\ndescription: sample\n---\nbuiltin body`,
        "utf8",
      );

      const result = await executeSingleToolCall({
        toolCall: {
          id: "call-read-file",
          name: "read",
          arguments: { path: `${skillName}/SKILL.md` },
        } as any,
        ctx: makeBuiltinCtx(skillsRoot),
        spanCollector: new SpanCollector(),
        parentSpanName: "turn_0",
        opts: { mcpServerBaseURL: "http://fake-mcp" },
      });

      assert.equal(result.record.name, "read");
      assert.equal(result.toolResult.isError, false);
      assert.equal(
        typeof result.conversationMessage.content === "string" &&
          result.conversationMessage.content.includes("builtin body"),
        true,
      );
    } finally {
      rmSync(skillsRoot, { recursive: true, force: true });
    }
  });

  it("marks builtin tool error results as isError", async () => {
    const skillsRoot = createSkillsRoot("tool-executor-builtin-missing-");

    try {
      const result = await executeSingleToolCall({
        toolCall: {
          id: "call-read-file-missing",
          name: "read",
          arguments: { path: `missing-${Date.now()}.md` },
        } as any,
        ctx: makeBuiltinCtx(skillsRoot),
        spanCollector: new SpanCollector(),
        parentSpanName: "turn_0",
        opts: { mcpServerBaseURL: "http://fake-mcp" },
      });

      assert.equal(result.toolResult.isError, true);
      assert.equal(parseToolOutput(result.record.output).explicitError, true);
    } finally {
      rmSync(skillsRoot, { recursive: true, force: true });
    }
  });
});
