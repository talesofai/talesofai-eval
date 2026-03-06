import { ENV_KEYS, resolveJudgeModels } from "../config.ts";
import { listModels, resolveModel } from "../models/index.ts";
import type { AssertionConfig, EvalCase, EvalTier } from "../types.ts";
import { normalizeAssertions } from "../utils/normalize-assertions.ts";

const JUDGE_ASSERTION_TYPES = new Set<AssertionConfig["type"]>([
  "llm_judge",
  "task_success",
  "tool_parameter_accuracy",
]);

const DEFAULT_TIER: Record<AssertionConfig["type"], EvalTier> = {
  tool_usage: 1,
  final_status: 1,
  error_recovery: 1,
  llm_judge: 2,
  task_success: 2,
  tool_parameter_accuracy: 2,
  human_review: 3,
};

function resolveAssertionTier(assertion: AssertionConfig): EvalTier {
  return assertion.tier ?? DEFAULT_TIER[assertion.type];
}

function resolveJudgeModel(): string | undefined {
  const value = process.env[ENV_KEYS.JUDGE_MODEL];
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function caseNeedsJudge(
  evalCase: EvalCase,
  options?: { tierMax?: EvalTier },
): boolean {
  const tierMax = options?.tierMax ?? 2;

  // Use normalizeAssertions to ensure assertions-first strategy
  const assertions = normalizeAssertions(evalCase.criteria);

  return assertions.some(
    (assertion) =>
      resolveAssertionTier(assertion) <= tierMax &&
      JUDGE_ASSERTION_TYPES.has(assertion.type),
  );
}

export function getMissingJudgeConfig(): string[] {
  const missing: string[] = [];
  const multiJudgeModels = resolveJudgeModels();

  if (
    (!multiJudgeModels || multiJudgeModels.length === 0) &&
    !resolveJudgeModel()
  ) {
    missing.push(ENV_KEYS.JUDGE_MODEL);
  }

  return missing;
}

export function getMissingRunConfig(
  cases: EvalCase[],
  options?: { replay?: boolean; tierMax?: EvalTier },
): string[] {
  const replay = options?.replay ?? false;
  const tierMax = options?.tierMax ?? 2;

  if (replay) {
    // Replay prefers cached *.result.json when available, so no upfront judge
    // env requirement here. If cache is missing for a case with llm_judge,
    // that case falls back to scoring and may require judge config then.
    return [];
  }

  const missing = new Set<string>();

  // Check for judge config on cases that need it
  for (const evalCase of cases) {
    if (caseNeedsJudge(evalCase, { tierMax })) {
      for (const key of getMissingJudgeConfig()) {
        missing.add(key);
      }
    }
  }

  return [...missing];
}

export function getMissingDiffConfig(cases: EvalCase[]): string[] {
  const missing = new Set<string>(
    getMissingRunConfig(cases, { replay: false }),
  );

  if (!resolveJudgeModel()) {
    missing.add(ENV_KEYS.JUDGE_MODEL);
  }

  return [...missing];
}

// ─── Model Validation ─────────────────────────────────────────────────────────

export type ModelValidationResult =
  | { ok: true }
  | { ok: false; error: string; modelId: string };

/**
 * Validate that a model exists in the registry and has required configuration.
 * This checks registry existence and API key configuration without making API calls.
 */
export async function validateModelConnection(
  modelId: string,
): Promise<ModelValidationResult> {
  // 1. Check if model exists in registry
  let model;
  try {
    model = resolveModel(modelId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message, modelId };
  }

  // 2. Check if API key is configured (if required)
  const apiKey = model.apiKey;
  if (apiKey === undefined || apiKey === "" || apiKey === "${EVAL_API_KEY}") {
    return {
      ok: false,
      error: `API key not configured for model "${modelId}". Set EVAL_API_KEY environment variable or configure apiKey in models.json.`,
      modelId,
    };
  }

  // 3. Check if baseUrl is configured
  if (!model.baseUrl || model.baseUrl.trim() === "") {
    return {
      ok: false,
      error: `Base URL not configured for model "${modelId}". Configure baseUrl in models.json.`,
      modelId,
    };
  }

  return { ok: true };
}

/**
 * Collect all unique model IDs from cases, variants, and judge configuration.
 */
export function collectModelIds(
  cases: EvalCase[],
  options?: { tierMax?: EvalTier; variantOverrides?: Record<string, unknown>[] },
): string[] {
  const modelIds = new Set<string>();

  // Collect model IDs from cases
  for (const evalCase of cases) {
    if (evalCase.input.model) {
      modelIds.add(evalCase.input.model);
    }
  }

  // Collect model IDs from variant overrides
  if (options?.variantOverrides) {
    for (const overrides of options.variantOverrides) {
      if (typeof overrides["model"] === "string") {
        modelIds.add(overrides["model"]);
      }
    }
  }

  // Collect judge model IDs
  const multiJudgeModels = resolveJudgeModels();
  if (multiJudgeModels && multiJudgeModels.length > 0) {
    for (const modelId of multiJudgeModels) {
      modelIds.add(modelId);
    }
  } else {
    const singleJudgeModel = resolveJudgeModel();
    if (singleJudgeModel) {
      modelIds.add(singleJudgeModel);
    } else {
      // If no explicit judge model, use first model from registry
      try {
        const models = listModels();
        const firstModel = models[0];
        if (firstModel && caseNeedsJudgeAny(cases, options)) {
          modelIds.add(firstModel);
        }
      } catch {
        // Registry not loaded, will be caught elsewhere
      }
    }
  }

  return [...modelIds];
}

/**
 * Check if any case needs a judge.
 */
function caseNeedsJudgeAny(
  cases: EvalCase[],
  options?: { tierMax?: EvalTier },
): boolean {
  const tierMax = options?.tierMax ?? 2;
  return cases.some((evalCase) => caseNeedsJudge(evalCase, { tierMax }));
}

/**
 * Validate all models required for running cases.
 * Returns validation results for models that fail validation.
 */
export type ModelValidationError = {
  ok: false;
  error: string;
  modelId: string;
};

export async function validateModels(
  cases: EvalCase[],
  options?: { tierMax?: EvalTier; replay?: boolean; variantOverrides?: Record<string, unknown>[] },
): Promise<ModelValidationError[]> {
  if (options?.replay) {
    // Replay mode doesn't need to call models, just load cached traces
    return [];
  }

  const modelIds = collectModelIds(cases, options);
  const results: ModelValidationError[] = [];

  for (const modelId of modelIds) {
    const result = await validateModelConnection(modelId);
    if (!result.ok) {
      results.push(result);
    }
  }

  return results;
}
