import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelConfig, ModelRegistry } from "./types.ts";

let registry: ModelRegistry | null = null;

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Resolve the path to the model registry file.
 *
 * Resolution order:
 * 1. Explicit `path` argument
 * 2. EVAL_MODELS_PATH env var
 * 3. ./models.json in current working directory
 * 4. Fallback: bundled empty models.json in package root (no user-defined models)
 */
function resolveModelsPath(path?: string): string {
  const configuredPath = path ?? process.env["EVAL_MODELS_PATH"];
  if (configuredPath) {
    return resolve(configuredPath);
  }

  const cwdPath = resolve(process.cwd(), "models.json");
  if (existsSync(cwdPath)) {
    return cwdPath;
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

  // Resolve ${VAR} in baseUrl, apiKey, and headers
  for (const model of Object.values(raw.models)) {
    model.baseUrl = resolveEnvVars(model.baseUrl);
    if (model.apiKey) {
      model.apiKey = resolveEnvVars(model.apiKey);
    }
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
    throw new Error(
      "Model registry not loaded. This is likely a bug — please report it.",
    );
  }
  const model = registry.models[id];
  if (!model) {
    const hint = process.env["EVAL_MODELS_PATH"]
      ? `Check that "${id}" is defined in ${process.env["EVAL_MODELS_PATH"]}.`
      : `Create a models.json in your project root or set EVAL_MODELS_PATH=<path>.\nSee README for the models.json format.`;
    throw new Error(`Model not found in registry: "${id}". ${hint}`);
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
