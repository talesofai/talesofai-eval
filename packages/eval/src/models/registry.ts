import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelConfig, ModelRegistry } from "./types.ts";

let registry: ModelRegistry | null = null;

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function resolveModelsPath(path?: string): string {
  const configuredPath = path ?? process.env["EVAL_MODELS_PATH"];
  if (configuredPath) {
    return resolve(configuredPath);
  }

  return resolve(PACKAGE_ROOT, "models.json");
}

/**
 * Reset the registry cache. Useful for testing.
 */
export function resetRegistry(): void {
  registry = null;
}

export async function loadModels(path?: string): Promise<ModelRegistry> {
  const content = await readFile(resolveModelsPath(path), "utf-8");
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
