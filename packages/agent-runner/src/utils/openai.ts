import type {
  AgentInputItem,
  AssistantMessageItem,
  UserMessageItem,
} from "@openai/agents";
import type {
  AnyAssistantMessage,
  AnyToolMessage,
  AnyUserMessage,
} from "@agent-eval/apis/types";
import OpenAI from "openai";
import type { Logger } from "pino";

export interface OpenaiClientOptions {
  apiKey: string;
  baseURL: string;
  headers: Record<string, string>;
}

export const createOpenaiClient = (
  options: OpenaiClientOptions,
  logger?: Logger,
) => {
  return new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    defaultHeaders: options.headers,
    logger,
    logLevel: "error",
  });
};

const parseOutputTextContentItem = (
  content: unknown,
): {
  type: "text";
  text: string;
} | null => {
  if (typeof content === "string") {
    return {
      type: "text",
      text: content,
    };
  }

  if (typeof content !== "object" || content === null) return null;

  if (
    "type" in content &&
    (content.type === "text" || content.type === "output_text") &&
    "text" in content &&
    typeof content.text === "string"
  ) {
    return {
      type: "text",
      text: content.text,
    };
  }

  return null;
};

export type CommonAssistantMessage = {
  role: "assistant";
  reason?: string;
  content?: {
    type: "text";
    text: string;
  }[];
  tool_calls?: {
    index: number;
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }[];
};

export const parseAssistantMessage = (
  message: AnyAssistantMessage,
): CommonAssistantMessage => {
  const parsedMessage: CommonAssistantMessage = {
    role: "assistant",
    content: [],
  };

  if (message.reasoning_content) {
    parsedMessage.reason = message.reasoning_content;
  }

  if (Array.isArray(message.content)) {
    for (const item of message.content) {
      const parsed = parseOutputTextContentItem(item);
      if (!parsed) continue;
      parsedMessage.content?.push(parsed);
    }
  } else {
    const parsed = parseOutputTextContentItem(message.content);
    if (parsed) {
      parsedMessage.content?.push(parsed);
    }
  }

  if (message.tool_calls) {
    parsedMessage.tool_calls = message.tool_calls;
  }

  return parsedMessage;
};

export type CommonUserMessage = {
  role: "user";
  content: (
    | {
        type: "text";
        text: string;
      }
    | {
        type: "image_url";
        image_url: {
          url: string;
        };
      }
  )[];
};

const parseUserMessageContentItem = (
  content: unknown,
):
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    }
  | null => {
  if (typeof content === "string") {
    return {
      type: "text",
      text: content,
    };
  }

  if (typeof content !== "object" || content === null) return null;
  if (!("type" in content)) return null;

  if (
    (content.type === "text" || content.type === "input_text") &&
    "text" in content &&
    typeof content.text === "string"
  ) {
    return {
      type: "text",
      text: content.text,
    };
  }

  if (
    content.type === "image_url" &&
    "image_url" in content &&
    typeof content.image_url === "object" &&
    content.image_url !== null &&
    "url" in content.image_url &&
    typeof content.image_url.url === "string"
  ) {
    return {
      type: "image_url",
      image_url: {
        url: content.image_url.url,
      },
    };
  }

  if (
    content.type === "input_image" &&
    "image" in content &&
    typeof content.image === "string"
  ) {
    return {
      type: "image_url",
      image_url: {
        url: content.image,
      },
    };
  }

  return null;
};

export const parseUserMessage = (
  message: AnyUserMessage,
): CommonUserMessage => {
  const parsedMessage: CommonUserMessage = {
    role: "user",
    content: [],
  };

  if (Array.isArray(message.content)) {
    for (const item of message.content) {
      const parsed = parseUserMessageContentItem(item);
      if (!parsed) continue;
      parsedMessage.content?.push(parsed);
    }
  } else {
    const parsed = parseUserMessageContentItem(message.content);
    if (parsed) {
      parsedMessage.content?.push(parsed);
    }
  }

  return parsedMessage;
};

export type CommonToolMessage = {
  role: "tool";
  content: string;
  tool_call_id: string;
};

export const parseToolMessage = (
  message: AnyToolMessage,
): CommonToolMessage => {
  return {
    role: "tool",
    content: message.content,
    tool_call_id: message.tool_call_id,
  };
};

export type CommonAssistantDeltaMessage = {
  role: "assistant";
  delta: {
    reason?: string;
    content?: string;
    tool_calls?: {
      index: number;
      type: "function";
      id?: string;
      function?: {
        name?: string;
        arguments?: string;
      };
    }[];
  };
  raw?: unknown;
};

export type CommonLLMMessage =
  | CommonAssistantMessage
  | CommonUserMessage
  | CommonToolMessage;

export const parseCommonLLMMessages = (
  messages: CommonLLMMessage[],
): AgentInputItem[] => {
  const items: AgentInputItem[] = [];
  const toolCalls: {
    id: string;
    name: string;
    arguments: string;
  }[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      if (typeof message.content === "string") {
        items.push({
          role: "user",
          content: message.content,
        });
      } else if (Array.isArray(message.content) && message.content.length > 0) {
        const content: UserMessageItem["content"] = [];
        for (const item of message.content) {
          if (item.type === "text") {
            content.push({
              type: "input_text",
              text: item.text,
            });
          }

          if (item.type === "image_url") {
            content.push({
              type: "input_image",
              image: item.image_url.url,
            });
          }
        }

        items.push({
          role: "user",
          content,
        });
      }
    }

    if (message.role === "assistant") {
      if (typeof message.content === "string") {
        items.push({
          role: "assistant",
          content: message.content,
          status: "completed",
        });
      } else if (Array.isArray(message.content) && message.content.length > 0) {
        const content: AssistantMessageItem["content"] = [];
        for (const item of message.content) {
          if (item.type === "text") {
            content.push({
              type: "output_text",
              text: item.text,
            });
          }
        }

        if (content.length > 0) {
          items.push({
            role: "assistant",
            content,
            status: "completed",
          });
        }
      }

      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          items.push({
            type: "function_call",
            callId: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          });
          toolCalls.push({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          });
        }
      }
    }

    if (message.role === "tool") {
      const toolCall = toolCalls.find(
        (call) => call.id === message.tool_call_id,
      );
      if (toolCall) {
        items.push({
          type: "function_call_result",
          callId: message.tool_call_id,
          name: toolCall.name,
          status: "completed",
          output: message.content,
        });
      }
    }
  }

  return items;
};
