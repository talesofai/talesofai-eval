import { stream as piStream, type Context, type Model, type Api } from "@mariozechner/pi-ai";
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
		headers: model.headers,
	};
}

/**
 * Stream text from an LLM model.
 * Yields text chunks as they arrive.
 *
 * Note: responseFormat is not yet implemented. Use system prompt instructions
 * for structured output (e.g., "Respond with valid JSON only").
 */
export async function* stream(
	model: ModelConfig,
	context: Context,
	options?: StreamOptions,
): AsyncGenerator<string> {
	const piModel = toPiModel(model);

	const eventStream = piStream(piModel, context, {
		temperature: options?.temperature,
		maxTokens: options?.maxTokens,
	});

	for await (const event of eventStream) {
		if (event.type === "text_delta") {
			yield event.delta;
		}
	}
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
