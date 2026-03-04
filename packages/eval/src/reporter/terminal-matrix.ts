import pc from "picocolors";
import type { MatrixCell, MatrixReporter, MatrixSummary } from "../types.ts";
import {
  createProgressBoard,
  createTickerManager,
  formatElapsedMs,
  renderCompactProgressBar,
} from "./progress.ts";
import { renderMatrixGrid } from "./render.ts";

export function createTerminalMatrixReporterImpl(options?: {
  compactRefreshIntervalMs?: number;
}): MatrixReporter {
  const progressBoard = createProgressBoard({ enabled: true });
  const cellKey = (caseId: string, variantLabel: string): string =>
    `${caseId}:${variantLabel}`;

  type MatrixCellMeta = {
    cellIndex: number;
    total: number;
  };

  const metaByCellKey = new Map<string, MatrixCellMeta>();
  const startedAtByCellKey = new Map<string, number>();
  let total = 0;
  let done = 0;
  let passed = 0;
  let failed = 0;
  let errored = 0;

  const renderRunningRow = (key: string): string => {
    const meta = metaByCellKey.get(key);
    const [caseId, variantLabel] = key.split(":");
    const progress = meta ? `[${meta.cellIndex + 1}/${meta.total}]` : "[?/?]";
    const startedAt = startedAtByCellKey.get(key) ?? Date.now();
    const elapsed = formatElapsedMs(Date.now() - startedAt);
    return `  ${pc.dim("▶")} ${pc.dim(progress)} ${caseId ?? "?"} ${pc.dim("×")} ${pc.cyan(variantLabel ?? "?")}  ${pc.dim(`running... (${elapsed})`)}`;
  };

  const renderDashboard = (): string => {
    const running = startedAtByCellKey.size;
    const progressBar = renderCompactProgressBar(done, total);
    return pc.dim(
      `Progress: [${progressBar}] ${done}/${total} | PASS ${passed} | FAIL ${failed} | ERR ${errored} | RUN ${running}`,
    );
  };

  const refreshRunningRows = (): void => {
    if (startedAtByCellKey.size === 0) {
      return;
    }

    const updates = [...startedAtByCellKey.keys()].map((key) => ({
      key,
      row: renderRunningRow(key),
    }));
    progressBoard.updateRows(updates);
    progressBoard.setFooter(renderDashboard());
  };

  const ticker = createTickerManager({
    intervalMs: options?.compactRefreshIntervalMs ?? 1_000,
    isLive: progressBoard.isLive,
    onTick: refreshRunningRows,
  });

  return {
    onCellStart(
      caseId: string,
      variantLabel: string,
      cellIndex: number,
      cellTotal: number,
    ) {
      const key = cellKey(caseId, variantLabel);
      metaByCellKey.set(key, { cellIndex, total: cellTotal });
      startedAtByCellKey.set(key, Date.now());
      total = cellTotal;
      progressBoard.startRow(key, cellIndex, renderRunningRow(key));
      ticker.ensure();
      progressBoard.setFooter(renderDashboard());
    },

    onCellResult(cell: MatrixCell) {
      const key = cellKey(cell.case_id, cell.variant_label);
      startedAtByCellKey.delete(key);
      done += 1;
      if (cell.result.error) {
        errored += 1;
      } else if (cell.result.passed) {
        passed += 1;
      } else {
        failed += 1;
      }

      const icon = cell.result.passed ? pc.green("✓") : pc.red("✗");
      const status = cell.result.error
        ? pc.yellow("ERR")
        : cell.result.passed
          ? pc.green("PASS")
          : pc.red("FAIL");
      const duration = pc.dim(
        `${(cell.result.trace.duration_ms / 1000).toFixed(1)}s`,
      );
      const tokens = pc.dim(`${cell.result.trace.usage.total_tokens} tok`);
      const errorSuffix = cell.result.error
        ? `  ${pc.red(cell.result.error.slice(0, 80))}`
        : "";
      const llmJudgeDimension = cell.result.dimensions.find(
        (dimension) => dimension.dimension === "llm_judge",
      );
      const judgeSuffix = llmJudgeDimension
        ? `  ${pc.dim("judge")} ${pc.dim(llmJudgeDimension.score.toFixed(2))}`
        : "";
      const meta = metaByCellKey.get(key);
      const progress = meta
        ? pc.dim(`[${meta.cellIndex + 1}/${meta.total}]`)
        : pc.dim("[?/?]");

      progressBoard.finishRow(
        key,
        `  ${icon} ${progress} ${cell.case_id} ${pc.dim("×")} ${pc.cyan(cell.variant_label)}  ${status}  ${duration}  ${tokens}${judgeSuffix}${errorSuffix}`,
      );
      ticker.maybeStop(startedAtByCellKey.size);
      progressBoard.setFooter(renderDashboard());
    },

    onMatrixSummary(summary: MatrixSummary) {
      ticker.clear();
      progressBoard.clearFooter();
      process.stderr.write("\n");
      process.stderr.write(`${pc.dim("─".repeat(48))}\n`);
      process.stderr.write(`${renderMatrixGrid(summary)}\n`);
      process.stderr.write("\n");

      // Show detailed dimensions for failed/errored cells
      const failedCells = summary.cells.filter(
        (cell) => !cell.result.passed || cell.result.error,
      );
      if (failedCells.length > 0) {
        process.stderr.write(`${pc.bold("Details:")}\n`);
        for (const cell of failedCells) {
          const status = cell.result.error ? pc.yellow("ERR") : pc.red("FAIL");
          process.stderr.write(
            `\n  ${status} ${pc.cyan(cell.case_id)} ${pc.dim("×")} ${cell.variant_label}\n`,
          );

          if (cell.result.error) {
            process.stderr.write(
              `    ${pc.red("error:")} ${cell.result.error.slice(0, 200)}\n`,
            );
            continue;
          }

          for (const dim of cell.result.dimensions) {
            const icon = dim.passed ? pc.green("✓") : pc.red("✗");
            const score = dim.score.toFixed(2);
            const reason = dim.reason.slice(0, 100);
            process.stderr.write(
              `    ${icon} ${pc.dim(dim.dimension)} ${dim.passed ? pc.green(score) : pc.red(score)} ${pc.dim(reason)}\n`,
            );
          }
        }
        process.stderr.write("\n");
      }

      const parts: string[] = [];
      if (summary.passed > 0) parts.push(pc.green(`${summary.passed} passed`));
      if (summary.failed > 0) parts.push(pc.red(`${summary.failed} failed`));
      if (summary.errored > 0)
        parts.push(pc.yellow(`${summary.errored} errored`));
      const duration = pc.dim(
        `wall: ${(summary.duration_ms / 1000).toFixed(1)}s`,
      );
      process.stderr.write(` ${parts.join("  ")}  ${duration}\n`);
    },
  };
}
