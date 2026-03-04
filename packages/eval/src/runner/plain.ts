import OpenAI from "openai";
import {
  resolveMcpXToken,
  resolveRunnerApiKey,
  resolveRunnerBaseURL,
} from "../config.ts";
import type {
  CommonLLMMessage,
  EvalMessage,
  EvalTrace,
  PlainEvalCase,
  RunnerOptions,
  ToolCallRecord,
} from "../types.ts";
import { safeParseJson } from "../utils/safe-parse-json.ts";
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

const isToolCallTimeoutError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("timeout") || message.includes("timed out");
};

export const runPlain = async (
  evalCase: PlainRunnableCase,
  opts: RunnerOptions,
): Promise<EvalTrace> => {
  const startTime = Date.now();
  const { input } = evalCase;

  // Model selection priority: CLI/ENV default > case.input.model
  const model = opts.defaultModel ?? input.model;
  if (!model) {
    throw new Error(
      "No model specified. Set model via:\n" +
        "  1. CLI: --model <model_id>\n" +
        "  2. ENV: EVAL_RUNNER_MODEL=<model_id>\n" +
        "  3. Case: input.model in .eval.yaml",
    );
  }

  // Determine tool requirement before connecting to MCP.
  // allowed_tool_names: [] means "no tools" — skip MCP entirely.
  const toolsExplicitlyDisabled =
    Array.isArray(input.allowed_tool_names) &&
    input.allowed_tool_names.length === 0;

  // 1. MCP client — list & filter tools (skipped when tools are explicitly disabled)
  let openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  let mcpClient: McpClient | null = null;

  if (!toolsExplicitlyDisabled) {
    mcpClient = await createMcpClient(
      opts.mcpServerBaseURL,
      resolveMcpXToken(),
    );
    const connectedMcpClient = mcpClient;

    const cacheKey = `${opts.mcpServerBaseURL}::${makeMcpToolFilterKey(input.allowed_tool_names)}`;
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

    // Convert MCP tools → OpenAI function-calling format
    openaiTools = filteredTools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: {
          type: t.inputSchema["type"] as "object",
          properties:
            (t.inputSchema["properties"] as
              | Record<string, unknown>
              | undefined) ?? {},
          required: (t.inputSchema["required"] as string[] | undefined) ?? [],
        },
      },
    }));
  }

  try {
    // 2. OpenAI client
    const baseURL = resolveRunnerBaseURL(input);
    if (!baseURL) {
      throw new Error(
        "invariant: OPENAI_BASE_URL not set — should have been caught at startup",
      );
    }

    const apiKey = resolveRunnerApiKey(input);
    if (!apiKey) {
      throw new Error(
        "invariant: OPENAI_API_KEY not set — should have been caught at startup",
      );
    }

    const openai = new OpenAI({
      apiKey,
      baseURL,
    });

    // 3. Build initial messages
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system" as const, content: input.system_prompt },
    ];

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
        messages.push({ role: "user" as const, content: text });
        conversation.push({ role: "user", content: text });
      } else if (msg.role === "assistant") {
        const text = extractMessageText(
          msg.content as EvalMessage["content"],
          "assistant",
        );
        messages.push({ role: "assistant" as const, content: text });
        conversation.push({ role: "assistant", content: text });
      }
    }
    const toolsCalled: ToolCallRecord[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalResponse: string | null = null;

    // 4. Agentic loop
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = await openai.chat.completions.create({
        model,
        messages,
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        stream: true,
        stream_options: { include_usage: true },
      });

      let assistantContent = "";
      let toolCalls: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[] = [];
      let finishReason: string | null = null;

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (choice) {
          // Content delta
          const delta = choice.delta;
          if (delta?.content) {
            assistantContent += delta.content;
            opts.onDelta?.(delta.content);
          }

          // Tool call deltas
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!toolCalls[tc.index]) {
                toolCalls[tc.index] = {
                  id: tc.id ?? "",
                  type: "function",
                  function: {
                    name: tc.function?.name ?? "",
                    arguments: tc.function?.arguments ?? "",
                  },
                };
              } else {
                const existing = toolCalls[tc.index];
                if (existing) {
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name)
                    existing.function.name = tc.function.name;
                  if (tc.function?.arguments)
                    existing.function.arguments += tc.function.arguments;
                }
              }
            }
          }

          if (choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        }

        // Usage
        if (chunk.usage) {
          totalInputTokens += chunk.usage.prompt_tokens;
          totalOutputTokens += chunk.usage.completion_tokens;
        }
      }

      // Compact toolCalls array (remove any sparse gaps)
      toolCalls = toolCalls.filter(Boolean);

      // Record assistant message in conversation
      const assistantMsg: CommonLLMMessage = {
        role: "assistant",
        content: assistantContent || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
      conversation.push(assistantMsg);

      // Push to OpenAI messages
      const oaiAssistant: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam =
        {
          role: "assistant",
          content: assistantContent || null,
        };
      if (toolCalls.length > 0) {
        oaiAssistant.tool_calls = toolCalls;
      }
      messages.push(oaiAssistant);

      // If stop → done
      if (finishReason === "stop" || toolCalls.length === 0) {
        finalResponse = assistantContent || null;
        break;
      }

      // Execute tool calls
      for (const tc of toolCalls) {
        const args = safeParseJson<Record<string, unknown>>(
          tc.function.arguments,
        );
        const toolArgs = args ?? {};
        opts.onToolStart?.({
          name: tc.function.name,
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
        try {
          result = await mcpClient.callTool(
            tc.function.name,
            toolArgs,
            MCP_TOOL_TIMEOUT_MS,
          );
        } catch (error) {
          const callDuration = Date.now() - callStart;
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          const isTimeout = isToolCallTimeoutError(error);

          const toolErrorRecord: ToolCallRecord = {
            tool_call_id: tc.id,
            name: tc.function.name,
            arguments: args ?? {},
            output: {
              error: isTimeout ? "timeout" : "tool_call_failed",
              message: isTimeout
                ? "Tool call exceeded 5 minute timeout"
                : errorMessage,
            },
            duration_ms: callDuration,
          };
          toolsCalled.push(toolErrorRecord);
          opts.onToolCall?.(toolErrorRecord);

          const toolErrorMsg = isTimeout
            ? "[timeout] Tool call exceeded 5 minute timeout"
            : `[tool_error] ${errorMessage}`;
          conversation.push({
            role: "tool",
            content: toolErrorMsg,
            tool_call_id: tc.id,
          });
          messages.push({
            role: "tool" as const,
            content: toolErrorMsg,
            tool_call_id: tc.id,
          });

          // Continue to next tool call instead of failing
          continue;
        }
        const callDuration = Date.now() - callStart;

        const outputStr =
          typeof result === "string"
            ? result
            : (JSON.stringify(result) ?? "null");

        const record: ToolCallRecord = {
          tool_call_id: tc.id,
          name: tc.function.name,
          arguments: args ?? {},
          output: result,
          duration_ms: callDuration,
        };
        toolsCalled.push(record);
        opts.onToolCall?.(record);

        // Record tool message
        conversation.push({
          role: "tool",
          content: outputStr,
          tool_call_id: tc.id,
        });

        messages.push({
          role: "tool" as const,
          content: outputStr,
          tool_call_id: tc.id,
        });
      }
    }

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
    };
  } finally {
    await mcpClient?.close().catch(() => {});
  }
};
