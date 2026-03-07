import type { ToolCall, ToolResultMessage } from "@mariozechner/pi-ai";
import type {
  CommonLLMMessage,
  RunnerOptions,
  ToolCallRecord,
} from "../../types.ts";
import { RUNNER_DEFAULTS, type RunContext } from "./types.ts";

function isBuiltinErrorResult(result: unknown): boolean {
  return typeof result === "string" && result.startsWith("Error:");
}

function buildTraceToolOutput(result: unknown, isError: boolean): unknown {
  if (!isError) {
    return result;
  }

  if (result && typeof result === "object" && !Array.isArray(result)) {
    return {
      ...(result as Record<string, unknown>),
      isError: true,
    };
  }

  return {
    isError: true,
    content: result,
  };
}

/**
 * Result of a single tool call execution.
 */
export interface SingleToolCallResult {
  record: ToolCallRecord;
  toolResult: ToolResultMessage;
  conversationMessage: CommonLLMMessage;
}

/**
 * Execute a single tool call via builtin tool or MCP.
 */
export async function executeSingleToolCall(params: {
  toolCall: ToolCall;
  ctx: RunContext;
  spanCollector: import("../../utils/span-collector.ts").SpanCollector;
  parentSpanName: string;
  opts: RunnerOptions;
  timeoutMs?: number;
}): Promise<SingleToolCallResult> {
  const {
    toolCall: tc,
    ctx,
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
  let spanError: "timeout" | "tool_error" | undefined;

  try {
    if ("builtinTools" in ctx && ctx.builtinTools.has(tc.name)) {
      result = await ctx.builtinTools.get(tc.name)!.execute(toolArgs);
      isError = isBuiltinErrorResult(result);
      if (isError) {
        spanError = "tool_error";
      }
    } else if (ctx.mcpClient) {
      const toolResult = await ctx.mcpClient.callTool(tc.name, toolArgs, timeoutMs);
      result = toolResult.content;
      isError = toolResult.isError;
      if (isError) {
        spanError = "tool_error";
      }
    } else {
      isError = true;
      spanError = "tool_error";
      result = { error: `No executor for tool: ${tc.name}` };
    }
  } catch (error) {
    isError = true;
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = /\btimeout\b|timed out/i.test(message);
    spanError = isTimeout ? "timeout" : "tool_error";
    result = {
      error: isTimeout ? "timeout" : "tool_call_failed",
      message,
    };
  }

  const callDuration = Date.now() - callStart;

  spans.end(toolSpanName, {
    tool_call_id: tc.id,
    ...(spanError ? { error: spanError } : {}),
  });

  const outputStr =
    typeof result === "string"
      ? result
      : (JSON.stringify(result) ?? "null");

  const record: ToolCallRecord = {
    tool_call_id: tc.id,
    name: tc.name,
    arguments: toolArgs,
    output: buildTraceToolOutput(result, isError),
    duration_ms: callDuration,
  };

  opts.onToolCall?.(record);

  const toolResultContent = [{ type: "text" as const, text: outputStr }];

  const conversationMessage: CommonLLMMessage = {
    role: "tool",
    content: outputStr,
    tool_call_id: tc.id,
  };

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
  ctx: RunContext;
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
      ctx,
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
