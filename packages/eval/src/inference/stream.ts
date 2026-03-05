import {
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  stream as piStream,
} from "@mariozechner/pi-ai";
import type { ModelConfig } from "../models/index.ts";
import type { StreamOptions } from "./types.ts";

/**
 * Convert our ModelConfig to pi-ai's Model type.
 * Fills in required defaults for optional fields.
 */
function toPiModel(model: ModelConfig): Model<Api> {
  return {
    id: model.id,
    name: model.name,
    api: model.api as Api,
    provider: model.provider,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning ?? false,
    input: model.input ?? ["text"],
    cost: {
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
      cacheRead: model.cost?.cacheRead ?? 0,
      cacheWrite: model.cost?.cacheWrite ?? 0,
    },
    contextWindow: model.contextWindow ?? 8192,
    maxTokens: model.maxTokens ?? 4096,
    ...(model.headers !== undefined ? { headers: model.headers } : {}),
  };
}

/**
 * Stream text from an LLM model.
 * Yields text chunks as they arrive.
 */
export async function* stream(
  model: ModelConfig,
  context: Context,
  options?: StreamOptions,
): AsyncGenerator<string> {
  const eventStream = streamEvents(model, context, options);

  for await (const event of eventStream) {
    if (event.type === "text_delta") {
      yield event.delta;
    }
  }
}

/**
 * Get the raw event stream from an LLM model.
 * Use this when you need access to all events (tool calls, usage, etc).
 */
export function streamEvents(
  model: ModelConfig,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const piModel = toPiModel(model);

  // Merge apiKey: options > model.apiKey
  // Merge headers: model.headers + options.headers (options wins on conflict)
  const mergedHeaders = { ...model.headers, ...options?.headers };

  return piStream(piModel, context, {
    ...(options?.temperature !== undefined
      ? { temperature: options.temperature }
      : {}),
    ...(options?.maxTokens !== undefined
      ? { maxTokens: options.maxTokens }
      : {}),
    ...(options?.apiKey !== undefined || model.apiKey !== undefined
      ? { apiKey: options?.apiKey ?? model.apiKey }
      : {}),
    ...(Object.keys(mergedHeaders).length > 0
      ? { headers: mergedHeaders }
      : {}),
  });
}

/**
 * Complete a request and return the full text response.
 * Convenience wrapper around stream() for non-streaming use cases.
 */
export async function complete(
  model: ModelConfig,
  context: Context,
  options?: StreamOptions,
): Promise<string> {
  let content = "";
  for await (const chunk of stream(model, context, options)) {
    content += chunk;
  }
  return content;
}
