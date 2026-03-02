import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { safeParseJson } from "../utils/safe-parse-json.ts";
import OpenAI from "openai";
import type {
  CommonLLMMessage,
  EvalMessage,
  EvalTrace,
  PlainEvalCase,
  RunnerOptions,
  ToolCallRecord,
} from "../types.ts";
import {
  resolveMcpXToken,
  resolveRunnerApiKey,
  resolveRunnerBaseURL,
  resolveRunnerXToken,
} from "../env.ts";

type PlainRunnableCase = Omit<PlainEvalCase, "type"> & {
  type: "plain" | "agent";
};
import { extractMessageText } from "./message-utils.ts";

const MAX_TURNS = 20;

export const runPlain = async (
  evalCase: PlainRunnableCase,
  opts: RunnerOptions,
): Promise<EvalTrace> => {
  const startTime = Date.now();
  const { input } = evalCase;

  // Determine tool requirement before connecting to MCP.
  // allowed_tool_names: [] means "no tools" — skip MCP entirely.
  const toolsExplicitlyDisabled =
    Array.isArray(input.allowed_tool_names) &&
    input.allowed_tool_names.length === 0;

  // 1. MCP client — list & filter tools (skipped when tools are explicitly disabled)
  let openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
  let mcpClient: Client | null = null;

  if (!toolsExplicitlyDisabled) {
    mcpClient = new Client({
      name: "eval-plain-runner",
      version: "0.0.1",
    });
    const mcpToken = resolveMcpXToken();
    const transport = new StreamableHTTPClientTransport(
      new URL(`${opts.mcpServerBaseURL}/mcp`),
      mcpToken
        ? {
            requestInit: {
              headers: {
                "x-token": mcpToken,
              },
            },
          }
        : undefined,
    );
    await mcpClient.connect(transport);

    const allTools = await mcpClient.listTools().then((r) => r.tools);
    const allowedNames = input.allowed_tool_names
      ? new Set(input.allowed_tool_names)
      : null;
    const filteredTools = allowedNames
      ? allTools.filter((t) => allowedNames.has(t.name))
      : allTools;

    // Convert MCP tools → OpenAI function-calling format
    openaiTools = filteredTools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: {
          type: t.inputSchema.type as "object",
          properties: t.inputSchema.properties ?? {},
          required: (t.inputSchema.required ?? []) as string[],
        },
      },
    }));
  }

  // 2. OpenAI client
  const openaiToken = resolveRunnerXToken();
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
    defaultHeaders: openaiToken
      ? {
          "x-token": openaiToken,
        }
      : undefined,
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
      model: input.model,
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
      const result = await mcpClient.callTool(
        { name: tc.function.name, arguments: toolArgs },
        undefined,
        { timeout: 60_000 * 20 },
      );
      const callDuration = Date.now() - callStart;

      const outputStr =
        typeof result.content === "string"
          ? result.content
          : JSON.stringify(result.content);

      const record: ToolCallRecord = {
        tool_call_id: tc.id,
        name: tc.function.name,
        arguments: args ?? {},
        output: result.content,
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
  };
};
