import { setTimeout } from "node:timers/promises";
import {
  Agent,
  type AgentInputItem,
  OpenAIProvider,
  Runner,
  RunState,
  type RunStreamEvent,
  type StreamRunOptions,
  setTraceProcessors,
  type TextOutput,
  tool,
} from "@openai/agents";
import type { Logger } from "pino";
import type { AgentEvent } from "./events.ts";
import type { AgentContext, AgentRunOptions } from "./utils/context.ts";
import { createMcpServer, type McpServerOptions } from "./utils/mcp.ts";
import {
  type CommonLLMMessage,
  createOpenaiClient,
  type OpenaiClientOptions,
  parseCommonLLMMessages,
} from "./utils/openai.ts";

export type AgentRunCallOptions = {
  mcpServerOptions: McpServerOptions;
  openaiClientOptions: OpenaiClientOptions;
  agentRunOptions: AgentRunOptions;
  context: AgentContext;
  signal: AbortSignal;
  onStreamEvent: (
    event: RunStreamEvent,
    result: { currentTurn: number },
  ) => Promise<void>;
  updateEvents: (
    newEvents: AgentEvent[],
    cb: (events: AgentEvent[]) => AgentEvent[],
  ) => Promise<void>;
};

const toRecord = (input: unknown): Record<string, unknown> | undefined => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    record[key] = value;
  }
  return record;
};

export const run = async (
  inputs: AgentInputItem[],
  history: CommonLLMMessage[],
  options: AgentRunCallOptions,
  logger?: Logger,
) => {
  const {
    context,
    signal,
    mcpServerOptions,
    openaiClientOptions,
    agentRunOptions,
  } = options;

  setTraceProcessors([]);

  const openaiClient = createOpenaiClient(openaiClientOptions, logger);
  const mcpServer = createMcpServer(mcpServerOptions);

  const runner = new Runner({
    model: "DON'T USE",
    modelSettings: {
      providerData: {
        preset_key: agentRunOptions.presetKey,
        parameters: agentRunOptions.parameters,
      },
    },
    workflowName: agentRunOptions.workflowName,
    traceId: agentRunOptions.traceId,
    groupId: agentRunOptions.groupId,
    traceMetadata: agentRunOptions.traceMetadata,
    modelProvider: new OpenAIProvider({
      openAIClient:
        openaiClient as unknown as NonNullable<
          ConstructorParameters<typeof OpenAIProvider>[0]
        >["openAIClient"],
      useResponses: false,
    }),
  });

  runner.on("agent_start", context.eventsHandler.handleAgentStart);
  runner.on("agent_end", context.eventsHandler.handleAgentEnd);
  runner.on("agent_tool_start", context.eventsHandler.handleAgentToolStart);
  runner.on("agent_tool_end", context.eventsHandler.handleAgentToolEnd);
  runner.on("agent_handoff", context.eventsHandler.handleAgentHandoff);

  try {
    await mcpServer.connect();
    const mcpTools = await mcpServer.listTools();
    const tools = mcpTools.map((mcpTool) => {
      return tool({
        name: mcpTool.name,
        description: mcpTool.description ?? "",
        parameters: {
          type: mcpTool.inputSchema.type,
          properties: mcpTool.inputSchema.properties,
          required: mcpTool.inputSchema.required ?? [],
          additionalProperties: false,
        },
        execute(input, _, detail) {
          return mcpServer.callTool(mcpTool.name, toRecord(input), {
            inherit: agentRunOptions.meta?.inherit,
            entrance_uuid: agentRunOptions.meta?.entrance_uuid,
            toolcall_uuid: detail?.toolCall?.callId,
          });
        },
        isEnabled: () => {
          if (
            mcpServerOptions.toolFilter?.allowedToolNames?.includes(
              mcpTool.name,
            )
          ) {
            return true;
          }

          if (
            context.manuscript.versePreset?.toolset_keys.includes(mcpTool.name)
          ) {
            return true;
          }

          return false;
        },
        needsApproval:
          !agentRunOptions.autoApprove &&
          mcpServerOptions.toolFilter?.needsApprovalToolNames?.includes(
            mcpTool.name,
          ),
      });
    });

    const agent = new Agent<AgentContext, TextOutput>({
      name: agentRunOptions.name,
      tools,
    });

    const runOptions: StreamRunOptions<AgentContext> = {
      stream: true,
      signal,
      maxTurns: agentRunOptions.maxTurns,
      context,
    };

    const parsedHistory = parseCommonLLMMessages(history);

    const input = await (async () => {
      const stateAssign = await context.manuscript
        .getAssign("__openai_agent_state__", true)
        .then((assign) => JSON.stringify(assign))
        .catch(() => null);

      if (stateAssign) {
        const state = await RunState.fromString<
          AgentContext,
          Agent<AgentContext, TextOutput>
        >(agent, stateAssign);

        const interruptions = state.getInterruptions();
        if (interruptions.length > 0) {
          if (inputs.length > 0) {
            for (const interruption of interruptions) {
              state.reject(interruption);
            }

            return [...state.history, ...inputs];
          }

          for (const interruption of interruptions) {
            state.approve(interruption);
          }

          return state;
        }
      }

      if (inputs.length === 0) {
        const callResult = parsedHistory.filter(
          (message) => message.type === "function_call_result",
        );
        return [
          ...parsedHistory.filter((message) => {
            if (message.type !== "function_call") return true;
            return callResult.some(
              (result) => result.callId === message.callId,
            );
          }),
          ...inputs,
        ];
      }

      return [...parsedHistory, ...inputs];
    })();

    const result = await runner.run<
      Agent<AgentContext, TextOutput>,
      AgentContext
    >(agent, input, runOptions);

    let responseId = "";

    for await (const event of result) {
      if (event.type === "raw_model_stream_event") {
        if (event.data.type === "response_started") {
          const providerId = event.data.providerData?.["id"];
          if (providerId && typeof providerId === "string") {
            responseId = providerId;
          }
        }
      }

      await options.onStreamEvent(event, {
        currentTurn: result.currentTurn,
      });
    }

    await result.completed;

    await setTimeout(200);
    await context.manuscript.update({
      conversation_uuid: responseId,
    });

    if (result.interruptions.length > 0) {
      await context.manuscript.putAssign(
        "__openai_agent_state__",
        JSON.stringify(result.state.toJSON()),
      );
    } else if (!Array.isArray(inputs)) {
      await context.manuscript.deleteAssign("__openai_agent_state__");
    }

    if (result.error) {
      logger?.info(
        "Agent run for manuscript %s failed with error %s",
        context.manuscript.uuid,
        JSON.stringify(result.error),
      );
    } else if (result.cancelled) {
      logger?.info(
        "Agent run for manuscript %s cancelled",
        context.manuscript.uuid,
      );
    } else {
      logger?.info(
        "Agent run for manuscript %s completed with conversation id %s",
        context.manuscript.uuid,
        responseId,
      );
    }

    return result;
  } finally {
    await mcpServer.close();
    runner.off("agent_start", context.eventsHandler.handleAgentStart);
    runner.off("agent_end", context.eventsHandler.handleAgentEnd);
    runner.off("agent_tool_start", context.eventsHandler.handleAgentToolStart);
    runner.off("agent_tool_end", context.eventsHandler.handleAgentToolEnd);
    runner.off("agent_handoff", context.eventsHandler.handleAgentHandoff);
  }
};
