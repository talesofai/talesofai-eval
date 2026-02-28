import type {
  AgentEventsHandler,
  AgentRunResult,
} from "@agent-eval/agent-runner/events";
import type {
  CommonAssistantMessage,
  CommonLLMMessage,
} from "@agent-eval/agent-runner/utils/openai";
import { safeParseJson } from "../utils/safe-parse-json.ts";
import type {
  EvalTraceStatus,
  ToolCallRecord,
  ToolCallStartRecord,
} from "../types.ts";

export type InMemoryEventsState = {
  conversation: CommonLLMMessage[];
  tools_called: ToolCallRecord[];
  final_response: string | null;
  status: EvalTraceStatus;
};

export const createInMemoryEventsHandler = (options: {
  onDelta?: (delta: string) => void;
  onToolStart?: (call: ToolCallStartRecord) => void;
  onToolCall?: (call: ToolCallRecord) => void;
}): {
  handler: AgentEventsHandler;
  getState: () => InMemoryEventsState;
} => {
  let message: CommonAssistantMessage = {
    role: "assistant",
  };
  let finalResponse: string | null = null;
  let status: EvalTraceStatus = "success";
  const conversation: CommonLLMMessage[] = [];
  const toolsCalled: ToolCallRecord[] = [];
  const toolStartTimes = new Map<string, number>();

  const handler: AgentEventsHandler = {
    handleInputs: async () => {},
    handleStreamEvent: async (event) => {
      if (event.type !== "raw_model_stream_event") {
        return;
      }

      if (event.data.type === "response_started") {
        message = { role: "assistant" };
        return;
      }

      if (event.data.type === "response_done") {
        conversation.push(message);

        const text = message.content?.map((item) => item.text).join("") ?? "";
        if (text) {
          finalResponse = text;
        }
        return;
      }

      if (event.data.type !== "model") {
        return;
      }

      const choice = event.data.event?.choices[0];
      const delta = choice?.delta;
      if (!delta) {
        return;
      }

      if (delta.reasoning_content) {
        message.reason = (message.reason ?? "") + delta.reasoning_content;
      }

      if (delta.content) {
        message.content = [
          {
            type: "text",
            text: (message.content?.[0]?.text ?? "") + delta.content,
          },
        ];
        options.onDelta?.(delta.content);
      }

      if (!Array.isArray(delta.tool_calls)) {
        return;
      }

      if (!message.tool_calls) {
        message.tool_calls = [];
      }

      for (const toolCall of delta.tool_calls) {
        const index = toolCall.index;
        const existing = message.tool_calls[index];
        if (!existing) {
          message.tool_calls[index] = {
            index,
            id: toolCall.id ?? "",
            type: "function",
            function: {
              name: toolCall.function?.name ?? "",
              arguments: toolCall.function?.arguments ?? "",
            },
          };
          if (toolCall.id) {
            toolStartTimes.set(toolCall.id, Date.now());
          }
          continue;
        }

        if (toolCall.id) {
          existing.id = toolCall.id;
          if (!toolStartTimes.has(toolCall.id)) {
            toolStartTimes.set(toolCall.id, Date.now());
          }
        }
        if (toolCall.function?.name) {
          existing.function.name = toolCall.function.name;
        }
        if (toolCall.function?.arguments) {
          existing.function.arguments =
            existing.function.arguments + toolCall.function.arguments;
        }
      }
    },
    handleRunResult: async (result: AgentRunResult) => {
      if (result.cancelled) {
        status = "cancelled";
        return;
      }

      if (result.error) {
        status = "failure";
      }
    },
    handleAgentStart: async () => {},
    handleAgentEnd: async () => {},
    handleAgentToolStart: async (_, __, tool, details) => {
      if (details.toolCall.type !== "function_call") {
        return;
      }
      toolStartTimes.set(details.toolCall.callId, Date.now());

      const parsedArgs =
        safeParseJson<Record<string, unknown>>(details.toolCall.arguments) ??
        {};
      options.onToolStart?.({
        name: tool.name,
        arguments: parsedArgs,
      });
    },
    handleAgentToolEnd: async (_, __, tool, result, details) => {
      if (details.toolCall.type !== "function_call") {
        return;
      }

      const startedAt =
        toolStartTimes.get(details.toolCall.callId) ?? Date.now();
      const parsedArgs =
        safeParseJson<Record<string, unknown>>(details.toolCall.arguments) ??
        {};

      const record: ToolCallRecord = {
        tool_call_id: details.toolCall.callId,
        name: tool.name,
        arguments: parsedArgs,
        output: result,
        duration_ms: Date.now() - startedAt,
      };
      toolsCalled.push(record);
      options.onToolCall?.(record);

      conversation.push({
        role: "tool",
        content: result,
        tool_call_id: details.toolCall.callId,
      });
    },
    handleAgentHandoff: async () => {},
    close: async () => {},
  };

  return {
    handler,
    getState: () => ({
      conversation,
      tools_called: toolsCalled,
      final_response: finalResponse,
      status,
    }),
  };
};
