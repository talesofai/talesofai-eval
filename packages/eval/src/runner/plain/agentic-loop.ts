import { type Api, type AssistantMessage, type AssistantMessageEventStream, type ToolCall } from "@mariozechner/pi-ai";
import type { CommonLLMMessage, RunnerOptions } from "../../types.ts";
import { streamEvents } from "../../inference/index.ts";
import type { ModelConfig } from "../../models/index.ts";
import type { SpanCollector } from "../../utils/span-collector.ts";
import { type RunContext, type TurnResult, RUNNER_DEFAULTS, ZERO_USAGE } from "./types.ts";
import { executeToolCalls } from "./tool-executor.ts";

/**
 * Process the event stream from the LLM.
 */
export async function processEventStream(params: {
  eventStream: AssistantMessageEventStream;
  opts: RunnerOptions;
  turnStartTime: number;
}): Promise<TurnResult> {
  const { eventStream, opts, turnStartTime } = params;

  let assistantContent = "";
  let assistantMessage: AssistantMessage | null = null;
  const toolCalls: ToolCall[] = [];
  let firstTokenMs: number | null = null;

  for await (const event of eventStream) {
    switch (event.type) {
      case "text_delta":
        if (firstTokenMs === null) {
          firstTokenMs = Date.now() - turnStartTime;
        }
        assistantContent += event.delta;
        opts.onDelta?.(event.delta);
        break;

      case "toolcall_end":
        toolCalls.push(event.toolCall);
        break;

      case "done":
        assistantMessage = event.message;
        break;

      case "error":
        return {
          assistantContent,
          assistantMessage,
          toolCalls,
          firstTokenMs,
          stopReason: "error",
          error: event.error.errorMessage ?? "Unknown error",
        };
    }
  }

  const stopReason: TurnResult["stopReason"] =
    assistantMessage?.stopReason === "stop" || toolCalls.length === 0
      ? "stop"
      : "toolUse";

  return {
    assistantContent,
    assistantMessage,
    toolCalls,
    firstTokenMs,
    stopReason,
  };
}

/**
 * Execute a single turn in the agentic loop.
 */
export async function executeTurn(params: {
  turn: number;
  ctx: RunContext;
  opts: RunnerOptions;
  headers: Record<string, string> | undefined;
  spans: SpanCollector;
  model: ModelConfig;
}): Promise<TurnResult & { shouldStop: boolean }> {
  const { turn, ctx, opts, headers, spans, model } = params;

  const turnSpanName = `turn_${turn}`;
  const turnStartTime = Date.now();
  spans.start(turnSpanName, "llm_turn");

  const eventStream = streamEvents(model, ctx.context, { headers });

  const turnResult = await processEventStream({
    eventStream,
    opts,
    turnStartTime,
  });

  // End turn span with timing data
  spans.end(turnSpanName, {
    first_token_ms: turnResult.firstTokenMs ?? undefined,
    input_tokens: turnResult.assistantMessage?.usage.input,
    output_tokens: turnResult.assistantMessage?.usage.output,
  });

  return {
    ...turnResult,
    shouldStop: turnResult.stopReason === "stop" || turnResult.stopReason === "error",
  };
}

/**
 * Execute the main agentic loop.
 */
export async function executeAgenticLoop(params: {
  ctx: RunContext;
  opts: RunnerOptions;
  headers: Record<string, string> | undefined;
  model: ModelConfig;
}): Promise<{
  conversation: CommonLLMMessage[];
  toolsCalled: import("../../types.ts").ToolCallRecord[];
  finalResponse: string | null;
  status: "success" | "error";
  error?: string;
  totalInputTokens: number;
  totalOutputTokens: number;
}> {
  const { ctx, opts, headers, model } = params;

  const { conversation, spans } = ctx;
  const toolsCalled: import("../../types.ts").ToolCallRecord[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalResponse: string | null = null;
  let status: "success" | "error" = "success";
  let error: string | undefined;

  for (let turn = 0; turn < RUNNER_DEFAULTS.maxTurns; turn++) {
    const turnSpanName = `turn_${turn}`;

    const turnResult = await executeTurn({
      turn,
      ctx,
      opts,
      headers,
      spans,
      model,
    });

    // Accumulate usage
    if (turnResult.assistantMessage) {
      totalInputTokens += turnResult.assistantMessage.usage.input;
      totalOutputTokens += turnResult.assistantMessage.usage.output;
    }

    // Handle error case
    if (turnResult.stopReason === "error") {
      status = "error";
      error = (turnResult as TurnResult & { error?: string }).error;
      break;
    }

    // Record assistant message in conversation
    const assistantMsg: CommonLLMMessage = {
      role: "assistant",
      content: turnResult.assistantContent || null,
      ...(turnResult.toolCalls.length > 0
        ? {
            tool_calls: turnResult.toolCalls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              },
            })),
          }
        : {}),
    };
    conversation.push(assistantMsg);

    // Add to context for next turn
    ctx.context.messages.push({
      role: "assistant",
      content: [
        ...turnResult.toolCalls,
        ...(turnResult.assistantContent
          ? [{ type: "text" as const, text: turnResult.assistantContent }]
          : []),
      ] as AssistantMessage["content"],
      api: model.api as Api,
      provider: model.provider,
      model: model.id,
      usage: turnResult.assistantMessage?.usage ?? ZERO_USAGE,
      stopReason: turnResult.assistantMessage?.stopReason ?? "stop",
      timestamp: Date.now(),
    });

    // If stop → done
    if (turnResult.shouldStop && turnResult.stopReason === "stop") {
      finalResponse = turnResult.assistantContent || null;
      break;
    }

    // Execute tool calls if we have tools and tool calls
    if (turnResult.toolCalls.length > 0) {
      // Check if we have MCP client available
      if (ctx.toolsExplicitlyDisabled || !ctx.mcpClient) {
        // No tools available, but model made tool calls - this is an error
        status = "error";
        error = "Model attempted tool calls but tools are not available";
        break;
      }

      const toolResults = await executeToolCalls({
        toolCalls: turnResult.toolCalls,
        ctx: ctx as import("./types.ts").RunContextWithTools,
        opts,
        spanCollector: spans,
        parentSpanName: turnSpanName,
      });

      toolsCalled.push(...toolResults.records);
      conversation.push(...toolResults.conversationMessages);
      ctx.context.messages.push(...toolResults.toolResults);
    }
  }

  return {
    conversation,
    toolsCalled,
    finalResponse,
    status,
    error,
    totalInputTokens,
    totalOutputTokens,
  };
}
