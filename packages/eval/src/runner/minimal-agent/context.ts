import { type Api, type Context, type Message, type Tool, Type } from "@mariozechner/pi-ai";
import { resolveMcpXToken } from "../../config.ts";
import type { ModelConfig } from "../../models/index.ts";
import { resolveModel } from "../../models/index.ts";
import type {
  CommonLLMMessage,
  EvalMessage,
  RunnerOptions,
} from "../../types.ts";
import type { McpTool } from "../mcp.ts";
import { createMcpClient } from "../mcp.ts";
import { extractMessageText } from "../message-utils.ts";
import { SpanCollector } from "../../utils/span-collector.ts";
import {
  type BuiltinTool,
  type PlainRunnableCase,
  type RunContext,
  type RunContextWithoutTools,
  type RunContextWithBuiltinTools,
  type RunContextWithTools,
  ZERO_USAGE,
} from "./types.ts";

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
export function mcpToolToPiAiTool(tool: McpTool): Tool {
  return {
    name: tool.name,
    description: tool.description ?? "",
    parameters: Type.Unsafe(tool.inputSchema),
  };
}

/**
 * Safely parse tool arguments from JSON string.
 */
export function safeParseToolArguments(raw: string): Record<string, unknown> {
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
export function toPiAiMessage(msg: EvalMessage): Message {
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

  const content: import("@mariozechner/pi-ai").AssistantMessage["content"] = [
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

/**
 * Convert EvalMessage array to pi-ai Message array.
 */
export function convertMessages(messages: EvalMessage[]): Message[] {
  return messages.map(toPiAiMessage);
}

/**
 * Build pi-ai Context object.
 */
export function buildContext(
  systemPrompt: string,
  messages: Message[],
  tools: Tool[] | undefined,
): Context {
  return {
    systemPrompt,
    messages,
    ...(tools && tools.length > 0 ? { tools } : {}),
  };
}

/**
 * Initialize conversation from case messages.
 */
export function initializeConversation(
  systemPrompt: string,
  messages: EvalMessage[],
): CommonLLMMessage[] {
  const conversation: CommonLLMMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  for (const msg of messages) {
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

  return conversation;
}

/**
 * Resolve model from registry, handling errors.
 */
export function resolveModelOrThrow(input: { model: string }): ModelConfig | { error: string } {
  try {
    return resolveModel(input.model);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}

export type InitializeContextOptions = {
  builtinTools?: BuiltinTool[];
};

/**
 * Initialize run context, including MCP client and tools.
 * Returns either a context with tools or without tools.
 */
export async function initializeRunContext(
  evalCase: PlainRunnableCase,
  opts: RunnerOptions,
  contextOpts?: InitializeContextOptions,
): Promise<RunContext> {
  const startTime = Date.now();
  const spans = new SpanCollector();
  const { input } = evalCase;

  // Resolve model from registry
  const modelResult = resolveModelOrThrow(input);
  if ("error" in modelResult) {
    throw new Error(modelResult.error);
  }
  const model = modelResult;

  if (contextOpts?.builtinTools && contextOpts.builtinTools.length > 0) {
    const builtinTools = new Map(
      contextOpts.builtinTools.map((tool) => [tool.name, tool]),
    );
    const tools = contextOpts.builtinTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));

    const messages = convertMessages(input.messages);
    const context = buildContext(input.system_prompt, messages, tools);
    const conversation = initializeConversation(
      input.system_prompt,
      input.messages,
    );

    return {
      model,
      tools,
      builtinTools,
      mcpClient: null,
      context,
      conversation,
      spans,
      startTime,
      toolsExplicitlyDisabled: false,
    } as RunContextWithBuiltinTools;
  }

  // Determine tool requirement before connecting to MCP.
  // allowed_tool_names: [] means "no tools" — skip MCP entirely.
  const toolsExplicitlyDisabled =
    Array.isArray(input.allowed_tool_names) &&
    input.allowed_tool_names.length === 0;

  if (toolsExplicitlyDisabled) {
    // Build context without tools
    const messages = convertMessages(input.messages);
    const context = buildContext(input.system_prompt, messages, undefined);
    const conversation = initializeConversation(input.system_prompt, input.messages);

    return {
      model,
      tools: [],
      mcpClient: null,
      context,
      conversation,
      spans,
      startTime,
      toolsExplicitlyDisabled: true,
    } as RunContextWithoutTools;
  }

  // Connect to MCP and load tools
  spans.start("mcp_connect", "mcp_connect");
  const mcpClient = await createMcpClient(
    opts.mcpServerBaseURL,
    resolveMcpXToken(),
  );
  spans.end("mcp_connect");

  const cacheKey = `${opts.mcpServerBaseURL}::${makeMcpToolFilterKey(input.allowed_tool_names)}`;
  spans.start("mcp_list_tools", "mcp_list_tools");
  const connectedMcpClient = mcpClient;
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

  const tools = filteredTools.map(mcpToolToPiAiTool);

  // Build context with tools
  const messages = convertMessages(input.messages);
  const context = buildContext(input.system_prompt, messages, tools.length > 0 ? tools : undefined);
  const conversation = initializeConversation(input.system_prompt, input.messages);

  return {
    model,
    tools,
    mcpClient,
    context,
    conversation,
    spans,
    startTime,
    toolsExplicitlyDisabled: false,
  } as RunContextWithTools;
}
