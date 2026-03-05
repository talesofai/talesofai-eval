import type { ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";
import type { CommonLLMMessage, RunnerOptions, ToolCallRecord } from "../../types.ts";
import type { McpClient } from "../mcp.ts";
import type { RunContextWithTools } from "./types.ts";
import { RUNNER_DEFAULTS } from "./types.ts";

/**
 * Result of a single tool call execution.
 */
export interface SingleToolCallResult {
  record: ToolCallRecord;
  toolResult: ToolResultMessage;
  conversationMessage: CommonLLMMessage;
}

/**
 * Execute a single tool call via MCP.
 */
export async function executeSingleToolCall(params: {
  toolCall: ToolCall;
  mcpClient: McpClient;
  spanCollector: import("../../utils/span-collector.ts").SpanCollector;
  parentSpanName: string;
  opts: RunnerOptions;
  timeoutMs?: number;
}): Promise<SingleToolCallResult> {
  const {
    toolCall: tc,
    mcpClient,
    spanCollector: spans,
    parentSpanName,
    opts,
    timeoutMs = RUNNER_DEFAULTS.mcpToolTimeoutMs,
  } = params;

  const toolSpanName = `tool_${tc.name}_${tc.id}`;
  spans.start(toolSpanName, "tool_call", parentSpanName);

  const toolArgs = tc.arguments;
  opts.onToolStart?.({
    name: tc.name,
    arguments: toolArgs,
  });

  const callStart = Date.now();

  let result: unknown;
  let isError = false;
  try {
    result = await mcpClient.callTool(tc.name, toolArgs, timeoutMs);
  } catch (_error) {
    isError = true;
    result = {
      error: "timeout",
      message: "Tool call exceeded timeout",
    };
  }
  const callDuration = Date.now() - callStart;

  spans.end(toolSpanName, {
    tool_call_id: tc.id,
    ...(isError ? { error: "timeout" } : {}),
  });

  const outputStr =
    typeof result === "string"
      ? result
      : (JSON.stringify(result) ?? "null");

  const record: ToolCallRecord = {
    tool_call_id: tc.id,
    name: tc.name,
    arguments: toolArgs,
    output: result,
    duration_ms: callDuration,
  };

  opts.onToolCall?.(record);

  // Build tool result content
  const toolResultContent = [{ type: "text" as const, text: outputStr }];

  // Build conversation message
  const conversationMessage: CommonLLMMessage = {
    role: "tool",
    content: outputStr,
    tool_call_id: tc.id,
  };

  // Build tool result for context
  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: tc.id,
    toolName: tc.name,
    content: toolResultContent,
    isError,
    timestamp: Date.now(),
  };

  return {
    record,
    toolResult,
    conversationMessage,
  };
}

/**
 * Execute multiple tool calls in sequence.
 */
export async function executeToolCalls(params: {
  toolCalls: readonly ToolCall[];
  ctx: RunContextWithTools;
  opts: RunnerOptions;
  spanCollector: import("../../utils/span-collector.ts").SpanCollector;
  parentSpanName: string;
}): Promise<{
  records: ToolCallRecord[];
  toolResults: ToolResultMessage[];
  conversationMessages: CommonLLMMessage[];
}> {
  const { toolCalls, ctx, opts, spanCollector, parentSpanName } = params;

  const records: ToolCallRecord[] = [];
  const toolResults: ToolResultMessage[] = [];
  const conversationMessages: CommonLLMMessage[] = [];

  for (const tc of toolCalls) {
    const result = await executeSingleToolCall({
      toolCall: tc,
      mcpClient: ctx.mcpClient,
      spanCollector,
      parentSpanName,
      opts,
    });

    records.push(result.record);
    toolResults.push(result.toolResult);
    conversationMessages.push(result.conversationMessage);
  }

  return {
    records,
    toolResults,
    conversationMessages,
  };
}
