import { join } from "node:path";
import pc from "picocolors";
import { resolveMcpServerBaseURL } from "../env.ts";
import { missingConfig, noCases } from "../errors.ts";
import { createJsonMatrixReporter } from "../reporter/json.ts";
import { createTerminalMatrixReporter } from "../reporter/terminal.ts";
import { loadResult } from "../traces.ts";
import type { MatrixCell, MatrixReporter, MatrixSummary, RunnerOptions } from "../types.ts";
import { runConcurrently } from "../utils/concurrency.ts";
import { resolveMatrixRecordDir } from "../utils/recording.ts";
import { resolveCasesFromArgs } from "./case-resolution.ts";
import {
  applyOverrides,
  resolveConcurrency,
  runAndScore,
} from "./command-utils.ts";
import { getMissingRunConfig } from "./config-check.ts";
import type { MatrixCommandOptions } from "./options.ts";

export async function matrixCommand(options: MatrixCommandOptions): Promise<number> {
  const { cases, unmatchedFilePatterns } = resolveCasesFromArgs(options);
  if (cases.length === 0) {
    throw noCases("matrix", unmatchedFilePatterns);
  }

  const variants = options.variants;
  const format = options.format;
  const total = cases.length * variants.length;
  const concurrency = resolveConcurrency(options.concurrency, total);
  const explicitRecordDir = options.record;
  const recordDir = resolveMatrixRecordDir({
    explicitRecordDir,
    cellCount: total,
  });

  const tierMax = options.tierMax;

  const missing = getMissingRunConfig(cases, {
    replay: false,
    tierMax,
  });
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

  // Check for existing results (resume capability)
  const loadExistingResult = async (
    caseId: string,
    variantLabel: string,
  ): Promise<MatrixCell | null> => {
    if (!recordDir) return null;
    const variantDir = join(recordDir, variantLabel);
    const existing = await loadResult(caseId, variantDir);
    if (existing) {
      return {
        case_id: caseId,
        variant_label: variantLabel,
        result: existing,
      };
    }
    return null;
  };

  const tasks = pairs.map((pair, index) => async (): Promise<MatrixCell> => {
    // Check if already completed
    const existing = await loadExistingResult(pair.evalCase.id, pair.variant.label);
    if (existing) {
      if (format === "terminal") {
        process.stderr.write(
          pc.dim(`  ⏭ [${index + 1}/${pairs.length}] ${pair.evalCase.id} × ${pair.variant.label}  (cached)\n`),
        );
      }
      reporter.onCellResult(existing);
      return existing;
    }

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
      tierMax,
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
