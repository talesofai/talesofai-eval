import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ModelConfig, ModelRegistry } from "./types.ts";

let registry: ModelRegistry | null = null;

/**
 * Reset the registry cache. Useful for testing.
 */
export function resetRegistry(): void {
	registry = null;
}

export async function loadModels(path?: string): Promise<ModelRegistry> {
	const modelsPath = path ?? process.env["EVAL_MODELS_PATH"] ?? "models.json";
	const content = await readFile(resolve(modelsPath), "utf-8");
	const raw: ModelRegistry = JSON.parse(content);

	// Resolve ${VAR} in baseUrl and headers
	for (const model of Object.values(raw.models)) {
		model.baseUrl = resolveEnvVars(model.baseUrl);
		if (model.headers) {
			for (const [key, value] of Object.entries(model.headers)) {
				model.headers[key] = resolveEnvVars(value);
			}
		}
	}

	registry = raw;
	return registry;
}

export function resolveModel(id: string): ModelConfig {
	if (!registry) {
		throw new Error("Models not loaded. Call loadModels() first.");
	}
	const model = registry.models[id];
	if (!model) {
		throw new Error(`Model not found: ${id}`);
	}
	return model;
}

export function listModels(): string[] {
	if (!registry) {
		throw new Error("Models not loaded. Call loadModels() first.");
	}
	return Object.keys(registry.models);
}

/**
 * Resolve ${VAR} environment variable references in a string.
 * @internal
 */
export function resolveEnvVars(str: string): string {
	return str.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}
