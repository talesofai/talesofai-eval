import {
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Tool,
  type ToolCall,
  type ToolResultMessage,
  Type,
  type Usage,
} from "@mariozechner/pi-ai";
import { resolveMcpXToken, resolveUpstreamXToken } from "../config.ts";
import { streamEvents } from "../inference/index.ts";
import type { ModelConfig } from "../models/index.ts";
import { resolveModel } from "../models/index.ts";
import type {
  CommonLLMMessage,
  EvalMessage,
  EvalTrace,
  PlainEvalCase,
  RunnerOptions,
  ToolCallRecord,
} from "../types.ts";
import { SpanCollector } from "../utils/span-collector.ts";
import { createMcpClient, type McpClient, type McpTool } from "./mcp.ts";
import { extractMessageText } from "./message-utils.ts";

type PlainRunnableCase = Omit<PlainEvalCase, "type"> & {
  type: "plain" | "agent";
};

const MAX_TURNS = 20;

const RUN_MCP_TOOL_SCHEMA_CACHE = new WeakMap<
  RunnerOptions,
  Map<string, Promise<McpTool[]>>
>();

const makeMcpToolFilterKey = (allowedToolNames?: string[]): string => {
  if (!allowedToolNames) {
    return "*";
  }

  return [...new Set(allowedToolNames)].sort().join(",");
};

const loadRunCachedMcpTools = async (options: {
  runnerOptions: RunnerOptions;
  cacheKey: string;
  load: () => Promise<McpTool[]>;
}): Promise<McpTool[]> => {
  let runCache = RUN_MCP_TOOL_SCHEMA_CACHE.get(options.runnerOptions);
  if (!runCache) {
    runCache = new Map<string, Promise<McpTool[]>>();
    RUN_MCP_TOOL_SCHEMA_CACHE.set(options.runnerOptions, runCache);
  }

  const existing = runCache.get(options.cacheKey);
  if (existing) {
    return existing;
  }

  const pending = options.load().catch((error) => {
    runCache?.delete(options.cacheKey);
    throw error;
  });

  runCache.set(options.cacheKey, pending);
  return pending;
};

/**
 * Convert MCP tool to pi-ai Tool format.
 * Uses Type.Unsafe to wrap the JSON Schema input from MCP.
 */
function mcpToolToPiAiTool(tool: McpTool): Tool {
  return {
    name: tool.name,
    description: tool.description ?? "",
    parameters: Type.Unsafe(tool.inputSchema),
  };
}

const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

function safeParseToolArguments(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }

  return {};
}

/**
 * Convert EvalMessage to pi-ai Message format.
 */
function toPiAiMessage(msg: EvalMessage): Message {
  if (msg.role === "user") {
    return {
      role: "user",
      content: extractMessageText(
        msg.content as EvalMessage["content"],
        "user",
      ),
      timestamp: Date.now(),
    };
  }

  const text = extractMessageText(
    msg.content as EvalMessage["content"],
    "assistant",
  );

  const content: AssistantMessage["content"] = [
    ...(msg.tool_calls?.map((tc) => ({
      type: "toolCall" as const,
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseToolArguments(tc.function.arguments),
    })) ?? []),
    ...(text ? [{ type: "text" as const, text }] : []),
  ];

  return {
    role: "assistant",
    content,
    api: "openai-completions" as Api,
    provider: "unknown",
    model: "unknown",
    usage: ZERO_USAGE,
    stopReason: msg.tool_calls?.length ? "toolUse" : "stop",
    timestamp: Date.now(),
  };
}

export const runPlain = async (
  evalCase: PlainRunnableCase,
  opts: RunnerOptions,
): Promise<EvalTrace> => {
  const startTime = Date.now();
  const spans = new SpanCollector();
  const { input } = evalCase;

  // Resolve model from registry
  let model: ModelConfig;
  try {
    model = resolveModel(input.model);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      case_id: evalCase.id,
      case_type: evalCase.type,
      conversation: [{ role: "system", content: input.system_prompt }],
      tools_called: [],
      final_response: null,
      status: "error",
      error: message,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      duration_ms: Date.now() - startTime,
      spans: spans.getSpans(),
    };
  }

  // Determine tool requirement before connecting to MCP.
  // allowed_tool_names: [] means "no tools" — skip MCP entirely.
  const toolsExplicitlyDisabled =
    Array.isArray(input.allowed_tool_names) &&
    input.allowed_tool_names.length === 0;

  // 1. MCP client — list & filter tools (skipped when tools are explicitly disabled)
  let tools: Tool[] = [];
  let mcpClient: McpClient | null = null;

  if (!toolsExplicitlyDisabled) {
    spans.start("mcp_connect", "mcp_connect");
    mcpClient = await createMcpClient(
      opts.mcpServerBaseURL,
      resolveMcpXToken(),
    );
    spans.end("mcp_connect");
    const connectedMcpClient = mcpClient;

    const cacheKey = `${opts.mcpServerBaseURL}::${makeMcpToolFilterKey(input.allowed_tool_names)}`;
    spans.start("mcp_list_tools", "mcp_list_tools");
    const filteredTools = await loadRunCachedMcpTools({
      runnerOptions: opts,
      cacheKey,
      load: async () => {
        const allTools = await connectedMcpClient.listTools();
        if (!input.allowed_tool_names) {
          return allTools;
        }

        const allowedNames = new Set(input.allowed_tool_names);
        return allTools.filter((tool) => allowedNames.has(tool.name));
      },
    });
    spans.end("mcp_list_tools");

    tools = filteredTools.map(mcpToolToPiAiTool);
  }

  // 2. Build context
  const messages: Message[] = input.messages.map(toPiAiMessage);

  // Resolve x-token header
  const xToken = resolveUpstreamXToken();
  const headers = xToken ? { "x-token": xToken } : undefined;

  const context: Context = {
    systemPrompt: input.system_prompt,
    messages,
    tools: tools.length > 0 ? tools : undefined,
  };

  // Collect trace data
  const conversation: CommonLLMMessage[] = [
    { role: "system", content: input.system_prompt },
  ];

  // Seed conversation from case messages
  for (const msg of input.messages) {
    if (msg.role === "user") {
      const text = extractMessageText(
        msg.content as EvalMessage["content"],
        "user",
      );
      conversation.push({ role: "user", content: text });
    } else if (msg.role === "assistant") {
      const text = extractMessageText(
        msg.content as EvalMessage["content"],
        "assistant",
      );
      conversation.push({ role: "assistant", content: text });
    }
  }

  const toolsCalled: ToolCallRecord[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalResponse: string | null = null;

  // 3. Agentic loop
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const turnSpanName = `turn_${turn}`;
    spans.start(turnSpanName, "llm_turn");

    const eventStream = streamEvents(model, context, { headers });

    let assistantContent = "";
    let assistantMessage: AssistantMessage | null = null;
    const toolCalls: ToolCall[] = [];
    let firstTokenMs: number | null = null;

    // Process event stream
    for await (const event of eventStream) {
      switch (event.type) {
        case "text_delta":
          if (firstTokenMs === null) {
            firstTokenMs = Date.now();
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
          spans.end(turnSpanName, {
            input_tokens: assistantMessage?.usage.input,
            output_tokens: assistantMessage?.usage.output,
          });
          await mcpClient?.close();
          return {
            case_id: evalCase.id,
            case_type: evalCase.type,
            conversation,
            tools_called: toolsCalled,
            final_response: null,
            status: "error",
            error: event.error.errorMessage ?? "Unknown error",
            usage: {
              input_tokens: totalInputTokens,
              output_tokens: totalOutputTokens,
              total_tokens: totalInputTokens + totalOutputTokens,
            },
            duration_ms: Date.now() - startTime,
            spans: spans.getSpans(),
          };
      }
    }

    // Accumulate usage
    if (assistantMessage) {
      totalInputTokens += assistantMessage.usage.input;
      totalOutputTokens += assistantMessage.usage.output;
    }

    // End turn span with timing data
    spans.end(turnSpanName, {
      first_token_ms: firstTokenMs ?? undefined,
      input_tokens: assistantMessage?.usage.input,
      output_tokens: assistantMessage?.usage.output,
    });

    // Record assistant message in conversation
    const assistantMsg: CommonLLMMessage = {
      role: "assistant",
      content: assistantContent || null,
      ...(toolCalls.length > 0
        ? {
            tool_calls: toolCalls.map((tc) => ({
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
    context.messages.push({
      role: "assistant",
      content: [
        ...toolCalls,
        ...(assistantContent
          ? [{ type: "text" as const, text: assistantContent }]
          : []),
      ] as AssistantMessage["content"],
      api: model.api as Api,
      provider: model.provider,
      model: model.id,
      usage: assistantMessage?.usage ?? ZERO_USAGE,
      stopReason: assistantMessage?.stopReason ?? "stop",
      timestamp: Date.now(),
    });

    // If stop → done
    if (assistantMessage?.stopReason === "stop" || toolCalls.length === 0) {
      finalResponse = assistantContent || null;
      break;
    }

    // Execute tool calls
    for (const tc of toolCalls) {
      const toolSpanName = `tool_${tc.name}_${tc.id}`;
      spans.start(toolSpanName, "tool_call", turnSpanName);

      const toolArgs = tc.arguments;
      opts.onToolStart?.({
        name: tc.name,
        arguments: toolArgs,
      });

      const callStart = Date.now();
      if (!mcpClient) {
        throw new Error(
          "invariant: tool call attempted but MCP client is not connected",
        );
      }

      // 5 minute timeout for MCP tool calls
      const MCP_TOOL_TIMEOUT_MS = 60_000 * 5;

      let result: unknown;
      let isError = false;
      try {
        result = await mcpClient.callTool(
          tc.name,
          toolArgs,
          MCP_TOOL_TIMEOUT_MS,
        );
      } catch (_error) {
        isError = true;
        result = {
          error: "timeout",
          message: "Tool call exceeded 5 minute timeout",
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
      toolsCalled.push(record);
      opts.onToolCall?.(record);

      // Build tool result content
      const toolResultContent = [{ type: "text" as const, text: outputStr }];

      // Record tool message in conversation
      conversation.push({
        role: "tool",
        content: outputStr,
        tool_call_id: tc.id,
      });

      // Add to context for next turn
      const toolResult: ToolResultMessage = {
        role: "toolResult",
        toolCallId: tc.id,
        toolName: tc.name,
        content: toolResultContent,
        isError,
        timestamp: Date.now(),
      };
      context.messages.push(toolResult);
    }
  }

  await mcpClient?.close();

  return {
    case_id: evalCase.id,
    case_type: evalCase.type,
    conversation,
    tools_called: toolsCalled,
    final_response: finalResponse,
    status: "success",
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
    },
    duration_ms: Date.now() - startTime,
    spans: spans.getSpans(),
  };
};
