import { z, ZodError } from "zod3";
import { invalidArgs, invalidJson, validationError } from "../errors.ts";
import type { EvalTier, MatrixVariant } from "../types.ts";
import { formatZodIssues, type OutputFormat } from "./helpers.ts";

const outputFormatSchema = z.enum(["terminal", "json"]);
const caseTypeSchema = z.enum(["plain", "agent"]);

const stringListSchema = z.union([z.string(), z.array(z.string())]);

function normalizeStringList(
  value: string | string[] | undefined,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) ? value : [value];
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const optionalNumberFromCliSchema = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    return Number(trimmed);
  }
  return value;
}, z.number().finite().optional());

const optionalIntegerFromCliSchema = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    return Number(trimmed);
  }
  return value;
}, z.number().int().finite().optional());

function throwInvalidFlags(error: ZodError): never {
  throw validationError("flags", formatZodIssues(error));
}

function parseWithSchema<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throwInvalidFlags(parsed.error);
  }
  return parsed.data;
}

function parseTierMaxOrThrow(
  raw: unknown,
  command: "run" | "matrix",
): EvalTier | undefined {
  const parsed = optionalIntegerFromCliSchema.safeParse(raw);
  if (!parsed.success) {
    const hint =
      command === "matrix"
        ? 'Example: agent-eval matrix --tier-max 1 --variant \'{"label":"v1"}\''
        : "Example: agent-eval run --tier-max 1";
    throw invalidArgs("--tier-max must be 1, 2, or 3", hint);
  }

  if (parsed.data === undefined) {
    return undefined;
  }

  if (parsed.data === 1 || parsed.data === 2 || parsed.data === 3) {
    return parsed.data;
  }

  const hint =
    command === "matrix"
      ? 'Example: agent-eval matrix --tier-max 1 --variant \'{"label":"v1"}\''
      : "Example: agent-eval run --tier-max 1";
  throw invalidArgs("--tier-max must be 1, 2, or 3", hint);
}

function parsePositiveConcurrency(raw: unknown): number | undefined {
  const parsed = optionalIntegerFromCliSchema.safeParse(raw);
  if (!parsed.success) {
    throw invalidArgs(
      "--concurrency must be a positive integer",
      "Example: --concurrency 4",
    );
  }
  if (parsed.data === undefined) {
    return undefined;
  }
  if (parsed.data <= 0) {
    throw invalidArgs(
      "--concurrency must be a positive integer",
      "Example: --concurrency 4",
    );
  }
  return parsed.data;
}

export type CaseResolveOptions = {
  case?: string;
  file?: string[];
  inline?: string;
  type?: "plain" | "agent";
  message?: string[];
  systemPrompt?: string;
  model?: string;
  presetKey?: string;
  expectedTools?: string[];
  forbiddenTools?: string[];
  expectedStatus?: string;
  judgePrompt?: string;
  judgeThreshold?: number;
  allowedToolNames?: string[];
};

export type RunCommandOptions = CaseResolveOptions & {
  format: OutputFormat;
  share: boolean;
  shareBaseUrl?: string;
  record?: string;
  replay?: string;
  replayWriteMetrics: boolean;
  verbose: boolean;
  tierMax?: EvalTier;
  concurrency?: number;
};

export type DiffCommandOptions = {
  case?: string;
  file?: string[];
  type?: "plain" | "agent";
  format: OutputFormat;
  verbose: boolean;
  concurrency?: number;
  baseOverrides: Record<string, unknown>;
  candidateOverrides: Record<string, unknown>;
};

export type InspectCommandOptions = {
  case?: string;
  file?: string[];
};

export type DoctorCommandOptions = {
  format: OutputFormat;
  mode: "all" | "plain" | "agent";
};

export type PullOnlineCommandOptions = {
  collectionUuid: string;
  baseUrl?: string;
  xToken?: string;
  xPlatform: string;
  pageIndex: number;
  pageSize: number;
  out?: string;
  format: OutputFormat;
};

export type ReportCommandOptions = {
  from: string;
  out?: string;
  share: boolean;
  shareBaseUrl?: string;
  format: OutputFormat;
};

export type MatrixReportCommandOptions = {
  from: string;
  out?: string;
  share: boolean;
  shareBaseUrl?: string;
  format: OutputFormat;
};

export type MatrixCommandOptions = {
  case?: string;
  file?: string[];
  inline?: string;
  type?: "plain" | "agent";
  variants: MatrixVariant[];
  concurrency?: number;
  record?: string;
  format: OutputFormat;
  tierMax?: EvalTier;
};

const baseCaseResolveSchema = z
  .object({
    case: z.string().optional(),
    file: stringListSchema.optional(),
    inline: z.string().optional(),
    type: caseTypeSchema.optional(),
    message: stringListSchema.optional(),
    systemPrompt: z.string().optional(),
    model: z.string().optional(),
    presetKey: z.string().optional(),
    expectedTools: z.string().optional(),
    forbiddenTools: z.string().optional(),
    expectedStatus: z.string().optional(),
    judgePrompt: z.string().optional(),
    judgeThreshold: optionalNumberFromCliSchema,
    allowedToolNames: z.string().optional(),
  })
  .passthrough();

export function parseRunCommandOptions(raw: unknown): RunCommandOptions {
  const parsed = parseWithSchema(
    baseCaseResolveSchema.extend({
      format: outputFormatSchema.default("terminal"),
      share: z.boolean().default(true),
      shareBaseUrl: z.string().optional(),
      record: z.string().optional(),
      replay: z.string().optional(),
      replayWriteMetrics: z.boolean().default(false),
      verbose: z.boolean().default(false),
      tierMax: z.unknown().optional(),
      concurrency: z.unknown().optional(),
    }),
    raw,
  );

  if (parsed.record && parsed.replay) {
    throw invalidArgs(
      "--record and --replay are mutually exclusive",
      "Use either --record <dir> or --replay <dir>, not both.",
    );
  }

  if (parsed.replayWriteMetrics && !parsed.replay) {
    throw invalidArgs(
      "--replay-write-metrics requires --replay",
      "Example: agent-eval run --replay <dir> --replay-write-metrics",
    );
  }

  return {
    case: parsed.case,
    file: normalizeStringList(parsed.file),
    inline: parsed.inline,
    type: parsed.type,
    message: normalizeStringList(parsed.message),
    systemPrompt: parsed.systemPrompt,
    model: parsed.model,
    presetKey: parsed.presetKey,
    expectedTools: splitCsv(parsed.expectedTools),
    forbiddenTools: splitCsv(parsed.forbiddenTools),
    expectedStatus: parsed.expectedStatus,
    judgePrompt: parsed.judgePrompt,
    judgeThreshold: parsed.judgeThreshold,
    allowedToolNames: splitCsv(parsed.allowedToolNames),
    format: parsed.format ?? "terminal",
    share: parsed.share ?? true,
    shareBaseUrl: parsed.shareBaseUrl,
    record: parsed.record,
    replay: parsed.replay,
    replayWriteMetrics: parsed.replayWriteMetrics ?? false,
    verbose: parsed.verbose ?? false,
    tierMax: parseTierMaxOrThrow(parsed.tierMax, "run"),
    concurrency: parsePositiveConcurrency(parsed.concurrency),
  };
}

function parseJsonObjectOrThrow(
  key: "base" | "candidate",
  raw: string,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error) {
      throw invalidJson(key, error.message);
    }
    throw error;
  }
}

export function parseDiffCommandOptions(raw: unknown): DiffCommandOptions {
  const parsed = parseWithSchema(
    z
      .object({
        case: z.string().optional(),
        file: stringListSchema.optional(),
        type: caseTypeSchema.optional(),
        base: z.string().optional(),
        candidate: z.string().optional(),
        format: outputFormatSchema.default("terminal"),
        verbose: z.boolean().default(false),
        concurrency: z.unknown().optional(),
      })
      .passthrough(),
    raw,
  );

  if (!parsed.base || !parsed.candidate) {
    throw validationError("flags", [
      "--base and --candidate are required for diff",
    ]);
  }

  return {
    case: parsed.case,
    file: normalizeStringList(parsed.file),
    type: parsed.type,
    format: parsed.format ?? "terminal",
    verbose: parsed.verbose ?? false,
    concurrency: parsePositiveConcurrency(parsed.concurrency),
    baseOverrides: parseJsonObjectOrThrow("base", parsed.base),
    candidateOverrides: parseJsonObjectOrThrow("candidate", parsed.candidate),
  };
}

export function parseInspectCommandOptions(
  raw: unknown,
): InspectCommandOptions {
  const parsed = parseWithSchema(
    z
      .object({
        case: z.string().optional(),
        file: stringListSchema.optional(),
      })
      .passthrough(),
    raw,
  );

  return {
    case: parsed.case,
    file: normalizeStringList(parsed.file),
  };
}

export function parseDoctorCommandOptions(raw: unknown): DoctorCommandOptions {
  const parsed = parseWithSchema(
    z
      .object({
        format: outputFormatSchema.default("terminal"),
        mode: z.enum(["all", "plain", "agent"]).default("all"),
      })
      .passthrough(),
    raw,
  );

  return {
    format: parsed.format ?? "terminal",
    mode: parsed.mode ?? "all",
  };
}

function parseIntegerOptionOrThrow(options: {
  value: unknown;
  flagName: "--page-index" | "--page-size";
  defaultValue: number;
  validate: (value: number) => boolean;
  hint: string;
}): number {
  if (options.value === undefined) {
    return options.defaultValue;
  }

  const parsed = z
    .preprocess((value) => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          return NaN;
        }
        return Number(trimmed);
      }
      return value;
    }, z.number().int())
    .safeParse(options.value);

  if (!parsed.success || !options.validate(parsed.data)) {
    throw invalidArgs(`${options.flagName} is invalid`, options.hint);
  }

  return parsed.data;
}

export function parsePullOnlineCommandOptions(
  raw: unknown,
): PullOnlineCommandOptions {
  const parsed = parseWithSchema(
    z
      .object({
        collectionUuid: z.string().optional(),
        baseUrl: z.string().optional(),
        xToken: z.string().optional(),
        xPlatform: z.string().default("nieta-app/web"),
        pageIndex: z.unknown().optional(),
        pageSize: z.unknown().optional(),
        out: z.string().optional(),
        format: outputFormatSchema.default("terminal"),
      })
      .passthrough(),
    raw,
  );

  const collectionUuid = parsed.collectionUuid;
  if (!collectionUuid || collectionUuid.trim().length === 0) {
    throw invalidArgs(
      "--collection-uuid is required",
      "Example: agent-eval pull-online --collection-uuid <uuid>",
    );
  }

  return {
    collectionUuid,
    baseUrl: parsed.baseUrl,
    xToken: parsed.xToken,
    xPlatform: parsed.xPlatform ?? "nieta-app/web",
    pageIndex: parseIntegerOptionOrThrow({
      value: parsed.pageIndex,
      flagName: "--page-index",
      defaultValue: 0,
      validate: (value) => value >= 0,
      hint: "Example: --page-index 0",
    }),
    pageSize: parseIntegerOptionOrThrow({
      value: parsed.pageSize,
      flagName: "--page-size",
      defaultValue: 1,
      validate: (value) => value > 0,
      hint: "Example: --page-size 1",
    }),
    out: parsed.out,
    format: parsed.format ?? "terminal",
  };
}

export function parseReportCommandOptions(raw: unknown): ReportCommandOptions {
  const parsed = parseWithSchema(
    z
      .object({
        from: z.string().optional(),
        out: z.string().optional(),
        share: z.boolean().default(true),
        shareBaseUrl: z.string().optional(),
        format: outputFormatSchema.default("terminal"),
      })
      .passthrough(),
    raw,
  );

  const from = parsed.from;
  if (!from) {
    throw invalidArgs(
      "--from <dir> is required",
      "Example: agent-eval report --from ./recordings/run-20240227",
    );
  }

  return {
    from,
    out: parsed.out,
    share: parsed.share ?? true,
    shareBaseUrl: parsed.shareBaseUrl,
    format: parsed.format ?? "terminal",
  };
}

export function parseMatrixReportCommandOptions(
  raw: unknown,
): MatrixReportCommandOptions {
  const parsed = parseWithSchema(
    z
      .object({
        from: z.string().optional(),
        out: z.string().optional(),
        share: z.boolean().default(true),
        shareBaseUrl: z.string().optional(),
        format: outputFormatSchema.default("terminal"),
      })
      .passthrough(),
    raw,
  );

  const from = parsed.from;
  if (!from) {
    throw invalidArgs(
      "--from <dir> is required",
      "Example: agent-eval matrix-report --from ./recordings/matrix-20240227",
    );
  }

  return {
    from,
    out: parsed.out,
    share: parsed.share ?? true,
    shareBaseUrl: parsed.shareBaseUrl,
    format: parsed.format ?? "terminal",
  };
}

function parseVariants(rawVariants: string[]): MatrixVariant[] {
  if (rawVariants.length === 0) {
    throw invalidArgs(
      "at least one --variant is required",
      'Example: --variant \'qwen=qwen3.5-plus\' or --variant \'{"label":"qwen","model":"qwen3.5-plus"}\'',
    );
  }

  const seenLabels = new Set<string>();
  const variants: MatrixVariant[] = [];

  for (let index = 0; index < rawVariants.length; index++) {
    const raw = rawVariants[index];
    if (raw === undefined) {
      continue;
    }

    const shorthandIndex = raw.indexOf("=");
    if (shorthandIndex > 0) {
      const label = raw.slice(0, shorthandIndex).trim();
      const model = raw.slice(shorthandIndex + 1).trim();

      if (!label || !model) {
        throw validationError("flags", [
          `variant #${index + 1}: shorthand must be <label>=<model>`,
        ]);
      }

      if (seenLabels.has(label)) {
        throw validationError("flags", [`duplicate variant label: "${label}"`]);
      }

      seenLabels.add(label);
      variants.push({
        label,
        overrides: { model },
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      if (error instanceof Error) {
        throw invalidJson("variant", `variant #${index + 1}: ${error.message}`);
      }
      throw error;
    }

    const variantParsed = z
      .object({ label: z.string().min(1) })
      .catchall(z.unknown())
      .safeParse(parsed);

    if (!variantParsed.success) {
      const labelIssue = variantParsed.error.issues.find(
        (issue) => issue.path.join(".") === "label",
      );
      if (labelIssue) {
        throw validationError("flags", [
          `variant #${index + 1}: missing or empty "label" field`,
        ]);
      }
      throw validationError("flags", [
        `variant #${index + 1}: must be a JSON object`,
      ]);
    }

    const label = variantParsed.data.label;

    if (seenLabels.has(label)) {
      throw validationError("flags", [`duplicate variant label: "${label}"`]);
    }

    seenLabels.add(label);

    const overrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(variantParsed.data)) {
      if (key !== "label") {
        overrides[key] = value;
      }
    }

    variants.push({ label, overrides });
  }

  return variants;
}

export function parseMatrixCommandOptions(raw: unknown): MatrixCommandOptions {
  const parsed = parseWithSchema(
    z
      .object({
        case: z.string().optional(),
        file: stringListSchema.optional(),
        inline: z.string().optional(),
        type: caseTypeSchema.optional(),
        variant: stringListSchema.optional(),
        concurrency: z.unknown().optional(),
        record: z.string().optional(),
        format: outputFormatSchema.default("terminal"),
        tierMax: z.unknown().optional(),
      })
      .passthrough(),
    raw,
  );

  return {
    case: parsed.case,
    file: normalizeStringList(parsed.file),
    inline: parsed.inline,
    type: parsed.type,
    variants: parseVariants(normalizeStringList(parsed.variant) ?? []),
    concurrency: parsePositiveConcurrency(parsed.concurrency),
    record: parsed.record,
    format: parsed.format ?? "terminal",
    tierMax: parseTierMaxOrThrow(parsed.tierMax, "matrix"),
  };
}
