import { join } from "node:path";
import pc from "picocolors";
import { resolveMcpServerBaseURL } from "../env.ts";
import {
  invalidArgs,
  invalidJson,
  missingConfig,
  noCases,
  validationError,
} from "../errors.ts";
import { createJsonMatrixReporter } from "../reporter/json.ts";
import { createTerminalMatrixReporter } from "../reporter/terminal.ts";
import type {
  MatrixCell,
  MatrixReporter,
  MatrixSummary,
  MatrixVariant,
  RunnerOptions,
} from "../types.ts";
import { runConcurrently } from "../utils/concurrency.ts";
import { resolveMatrixRecordDir } from "../utils/recording.ts";
import { resolveCasesFromArgs } from "./case-resolution.ts";
import {
  applyOverrides,
  resolveConcurrency,
  runAndScore,
} from "./command-utils.ts";
import { getMissingRunConfig } from "./config-check.ts";
import {
  getStringArrayOption,
  getStringOption,
  isRecord,
  parseFormat,
} from "./helpers.ts";

function parseVariants(rawVariants: string[]): MatrixVariant[] {
  if (rawVariants.length === 0) {
    throw invalidArgs(
      "at least one --variant is required",
      'Example: --variant \'{"label":"v1","model":"qwen-plus"}\'',
    );
  }

  const seenLabels = new Set<string>();
  const variants: MatrixVariant[] = [];

  for (let index = 0; index < rawVariants.length; index++) {
    const raw = rawVariants[index];
    if (raw === undefined) {
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

    if (!isRecord(parsed)) {
      throw validationError("flags", [
        `variant #${index + 1}: must be a JSON object`,
      ]);
    }

    const label = parsed["label"];
    if (typeof label !== "string" || label.trim().length === 0) {
      throw validationError("flags", [
        `variant #${index + 1}: missing or empty "label" field`,
      ]);
    }

    if (seenLabels.has(label)) {
      throw validationError("flags", [`duplicate variant label: "${label}"`]);
    }

    seenLabels.add(label);

    const overrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== "label") {
        overrides[key] = value;
      }
    }

    variants.push({
      label,
      overrides,
    });
  }

  return variants;
}

export async function matrixCommand(
  options: Record<string, unknown>,
): Promise<number> {
  const { cases, unmatchedFilePatterns } = resolveCasesFromArgs(options);
  if (cases.length === 0) {
    throw noCases("matrix", unmatchedFilePatterns);
  }

  const variants = parseVariants(
    getStringArrayOption(options, "variant") ?? [],
  );
  const format = parseFormat(options["format"] ?? "terminal");
  const total = cases.length * variants.length;
  const concurrency = resolveConcurrency(options, total);
  const explicitRecordDir = getStringOption(options, "record");
  const recordDir = resolveMatrixRecordDir({
    explicitRecordDir,
    cellCount: total,
  });

  const missing = getMissingRunConfig(cases, { replay: false });
  if (missing.length > 0) {
    throw missingConfig(missing, "matrix");
  }

  const reporter: MatrixReporter =
    format === "json"
      ? createJsonMatrixReporter()
      : createTerminalMatrixReporter();

  const startTime = Date.now();

  if (!explicitRecordDir && recordDir && format === "terminal") {
    process.stderr.write(pc.dim(`auto-record: ${recordDir}\n`));
  }

  if (format === "terminal") {
    process.stderr.write(
      `\n${pc.bold("matrix:")} ${pc.dim(`${variants.length} variants × ${cases.length} cases`)} (${total} cells, concurrency ${concurrency})\n\n`,
    );
  }

  const pairs = cases.flatMap((evalCase) =>
    variants.map((variant) => ({ evalCase, variant })),
  );

  const runnerOpts: RunnerOptions = {
    mcpServerBaseURL: resolveMcpServerBaseURL(),
  };

  const tasks = pairs.map((pair, index) => async (): Promise<MatrixCell> => {
    reporter.onCellStart(
      pair.evalCase.id,
      pair.variant.label,
      index,
      pairs.length,
    );

    const variantRecordDir = recordDir
      ? join(recordDir, pair.variant.label)
      : undefined;
    const result = await runAndScore({
      runCase: applyOverrides(pair.evalCase, pair.variant.overrides),
      scoreCase: pair.evalCase,
      runnerOpts,
      recordDir: variantRecordDir,
    });

    const cell: MatrixCell = {
      case_id: pair.evalCase.id,
      variant_label: pair.variant.label,
      result,
    };
    reporter.onCellResult(cell);
    return cell;
  });

  const cells = await runConcurrently(tasks, concurrency);

  const summary: MatrixSummary = {
    variants: variants.map((variant) => variant.label),
    case_ids: cases.map((evalCase) => evalCase.id),
    cells,
    total,
    passed: cells.filter((cell) => cell.result.passed).length,
    failed: cells.filter((cell) => !cell.result.passed && !cell.result.error)
      .length,
    errored: cells.filter((cell) => Boolean(cell.result.error)).length,
    duration_ms: Date.now() - startTime,
  };

  reporter.onMatrixSummary(summary);

  if (summary.errored > 0) {
    return 2;
  }

  if (summary.failed > 0) {
    return 1;
  }

  return 0;
}
