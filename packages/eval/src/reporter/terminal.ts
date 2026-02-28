import type { MatrixReporter, Reporter } from "../types.ts";
import { createTerminalMatrixReporterImpl } from "./terminal-matrix.ts";
import {
  createCompactTerminalReporter,
  createVerboseTerminalReporter,
} from "./terminal-run.ts";

export { renderRunMarkdownReport } from "./markdown.ts";
export {
  formatToolArguments,
  formatToolReturnForLlm,
  humanize,
  MAX_STR_CHARS,
  renderMatrixGrid,
  renderRunGrid,
} from "./render.ts";

function createCompactReporter(options: {
  compactRefreshIntervalMs: number;
}): Reporter {
  return createCompactTerminalReporter(options);
}

// ─── Public API ──────────────────────────────────────────────────────────────
export const createTerminalReporter = (options?: {
  verbose?: boolean;
  /** concurrency > 1 时切换 compact 模式：静默 delta/tool 流，每 case 单行输出 */
  concurrency?: number;
  /** non-compact mode: heartbeat while waiting long-running tool call */
  heartbeatIntervalMs?: number;
  /** compact mode: refresh active timers/dashboard */
  compactRefreshIntervalMs?: number;
}): Reporter => {
  const verbose = options?.verbose ?? false;
  const compact = (options?.concurrency ?? 1) > 1;
  const heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 15_000;
  const compactRefreshIntervalMs = options?.compactRefreshIntervalMs ?? 1_000;

  return compact
    ? createCompactReporter({ compactRefreshIntervalMs })
    : createVerboseReporter({ verbose, heartbeatIntervalMs });
};

function createVerboseReporter(options: {
  verbose: boolean;
  heartbeatIntervalMs: number;
}): Reporter {
  return createVerboseTerminalReporter(options);
}

export const createTerminalMatrixReporter = (options?: {
  compactRefreshIntervalMs?: number;
}): MatrixReporter => createTerminalMatrixReporterImpl(options);
