import type {
  Agent,
  AgentInputItem,
  AgentOutputType,
  protocol,
  RunContext,
  RunStreamEvent,
  Tool,
} from "@openai/agents";
import type {
  AnyAssistantMessage,
  AnyToolMessage,
  AnyUserMessage,
} from "@agent-eval/apis/types";
import type { AgentContext } from "./utils/context.ts";
import type {
  CommonAssistantDeltaMessage,
  CommonAssistantMessage,
  CommonLLMMessage,
} from "./utils/openai.ts";

export type AgentRunResult = {
  cancelled: boolean;
  error: { type: string; message: string; stack?: string } | null;
  lastInputs: (AnyAssistantMessage | AnyUserMessage | AnyToolMessage)[] | null;
};

export interface AgentEventsHandler {
  handleInputs: (inputs: CommonLLMMessage[]) => Promise<void>;
  handleStreamEvent: (event: RunStreamEvent) => Promise<void>;
  handleRunResult: (result: AgentRunResult) => Promise<void>;
  handleAgentStart: <OutputType extends AgentOutputType>(
    context: RunContext<AgentContext>,
    agent: Agent<AgentContext, OutputType>,
    turnInput?: AgentInputItem[],
  ) => Promise<void>;
  handleAgentEnd: <OutputType extends AgentOutputType>(
    context: RunContext<AgentContext>,
    agent: Agent<AgentContext, OutputType>,
    output: string,
  ) => Promise<void>;
  handleAgentToolStart: <OutputType extends AgentOutputType>(
    context: RunContext<AgentContext>,
    agent: Agent<AgentContext, OutputType>,
    tool: Tool,
    details: {
      toolCall: protocol.ToolCallItem;
    },
  ) => Promise<void>;
  handleAgentToolEnd: <OutputType extends AgentOutputType>(
    context: RunContext<AgentContext>,
    agent: Agent<AgentContext, OutputType>,
    tool: Tool,
    result: string,
    details: {
      toolCall: protocol.ToolCallItem;
    },
  ) => Promise<void>;
  handleAgentHandoff: <
    OutputTypeFrom extends AgentOutputType,
    OutputTypeTo extends AgentOutputType,
  >(
    context: RunContext<AgentContext>,
    fromAgent: Agent<unknown, OutputTypeFrom>,
    toAgent: Agent<unknown, OutputTypeTo>,
  ) => Promise<void>;
  close: () => Promise<void>;
}

export type AgentEvent =
  | {
      id: string;
      timestamp: number;
      event: "response_started";
    }
  | {
      id: string;
      timestamp: number;
      event: "response_delta";
      data: CommonAssistantDeltaMessage;
    }
  | {
      id: string;
      timestamp: number;
      event: "response_done";
      data: CommonAssistantMessage;
    }
  | {
      id: string;
      timestamp: number;
      event: "tool_called";
      data: {
        type: "function_call";
        callId: string;
        name: string;
        arguments: string;
        startAt: number;
      };
    }
  | {
      id: string;
      timestamp: number;
      event: "tool_output";
      data: {
        type: "function_call";
        callId: string;
        name: string;
        arguments: string;
        output: unknown;
      };
    }
  | {
      id: string;
      timestamp: number;
      event: "run_result";
      data: AgentRunResult;
    }
  | {
      id: string;
      timestamp: number;
      event: "user_input";
      data: CommonLLMMessage[];
    }
  | {
      id: string;
      timestamp: number;
      event: "in_queue";
      data: {
        previous: number;
      };
    };
