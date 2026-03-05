import pc from "picocolors";
import { summarizeTraceMetrics } from "../metrics/trace-metrics.ts";
import type {
  DiffResult,
  DiffSummary,
  EvalCase,
  EvalResult,
  EvalSummary,
  Reporter,
  Span,
  TimingSummary,
  ToolCallRecord,
  ToolCallStartRecord,
} from "../types.ts";
import {
  createProgressBoard,
  createTickerManager,
  formatElapsedMs,
  renderCompactProgressBar,
} from "./progress.ts";
import {
  extractMarkdownImageUrls,
  formatToolArguments,
  formatToolReturnForLlm,
  renderCaseMetricsBrief,
  renderRunGrid,
  renderVerboseArtifactLines,
  resolveMetrics,
  truncateText,
} from "./render.ts";

function computeTimingSummary(spans: Span[] | undefined): TimingSummary | null {
  if (!spans || spans.length === 0) return null;

  const summary: TimingSummary = {
    mcp_connect_ms: 0,
    mcp_list_tools_ms: 0,
    llm_total_ms: 0,
    llm_first_token_ms: null,
    tool_total_ms: 0,
    turns_count: 0,
  };

  for (const span of spans) {
    switch (span.kind) {
      case "mcp_connect":
        summary.mcp_connect_ms += span.duration_ms;
        break;
      case "mcp_list_tools":
        summary.mcp_list_tools_ms += span.duration_ms;
        break;
      case "llm_turn":
        summary.llm_total_ms += span.duration_ms;
        summary.turns_count++;
        if (
          span.attributes?.first_token_ms !== undefined &&
          summary.llm_first_token_ms === null
        ) {
          summary.llm_first_token_ms = span.attributes.first_token_ms;
        }
        break;
      case "tool_call":
        summary.tool_total_ms += span.duration_ms;
        break;
    }
  }

  return summary;
}

const renderTimingGantt = (spans: Span[], summary: TimingSummary): string => {
  if (spans.length === 0) return "";

  const lines: string[] = [];
  lines.push(pc.dim("\n       Timeline:"));

  const maxDuration = Math.max(...spans.map((s) => s.duration_ms));
  const totalWidth = 20; // bar width

  const kindLabels: Record<string, string> = {
    mcp_connect: "MCP Connect",
    mcp_list_tools: "MCP List",
    llm_turn: "LLM Turn",
    tool_call: "Tool Call",
  };

  for (const span of spans) {
    const width = Math.max(
      1,
      Math.round((span.duration_ms / maxDuration) * totalWidth),
    );
    const bar = "█".repeat(width) + "░".repeat(totalWidth - width);
    const label = kindLabels[span.kind] ?? span.kind;
    const duration =
      span.duration_ms < 1000
        ? `${span.duration_ms}ms`
        : `${(span.duration_ms / 1000).toFixed(1)}s`;

    // Indent child spans
    const indent = span.parent ? "  " : "";
    const displayName =
      span.kind === "llm_turn"
        ? `${label} ${span.name.split("_")[1]}`
        : span.kind === "tool_call"
          ? `${indent}${label}`
          : label;

    // Attribute info
    let attrs = "";
    if (span.attributes?.first_token_ms !== undefined) {
      attrs = pc.dim(` first token: ${span.attributes.first_token_ms}ms`);
    } else if (span.attributes?.input_tokens !== undefined) {
      attrs = pc.dim(
        ` in: ${span.attributes.input_tokens} out: ${span.attributes.output_tokens}`,
      );
    }

    lines.push(
      `       ${displayName.padEnd(12)} ${pc.dim(bar)} ${duration.padStart(7)}${attrs}`,
    );
  }

  // Summary row
  lines.push(pc.dim("\n       Summary:"));
  lines.push(
    `       MCP ${(summary.mcp_connect_ms + summary.mcp_list_tools_ms).toString().padStart(4)}ms | LLM ${(summary.llm_total_ms / 1000).toFixed(1)}s (${summary.turns_count} turns) | Tools ${(summary.tool_total_ms / 1000).toFixed(1)}s`,
  );
  if (summary.llm_first_token_ms !== null) {
    lines.push(`       First token: ${summary.llm_first_token_ms}ms`);
  }

  return lines.join("\n");
};

function writeRunSummary(summary: EvalSummary): void {
  process.stderr.write("\n");
  if (summary.total > 1) {
    process.stderr.write(`${pc.dim("─".repeat(48))}\n`);
    const grid = renderRunGrid(summary);
    if (grid.length > 0) {
      process.stderr.write(`${grid}\n`);
    }
    process.stderr.write("\n");
  }

  process.stderr.write(`${pc.dim("─".repeat(40))}\n`);
  const parts: string[] = [];
  if (summary.passed > 0) parts.push(pc.green(`${summary.passed} passed`));
  if (summary.failed > 0) parts.push(pc.red(`${summary.failed} failed`));
  if (summary.errored > 0) parts.push(pc.yellow(`${summary.errored} errored`));

  const duration = `${(summary.duration_ms / 1000).toFixed(1)}s`;
  process.stderr.write(` ${parts.join("  ")}  ${pc.dim(duration)}\n`);

  const metricsSummary = summarizeTraceMetrics(summary.results);
  const bindingRateText =
    metricsSummary.binding_rate === null
      ? "n/a"
      : `${(metricsSummary.binding_rate * 100).toFixed(0)}%`;
  process.stderr.write(
    ` ${pc.dim(`metrics summary: avg tools ${metricsSummary.avg_tool_calls_total}, avg errors ${metricsSummary.avg_tool_error_calls_total}, avg retries ${metricsSummary.avg_tool_retry_calls_total}, picture rate ${(metricsSummary.picture_rate * 100).toFixed(0)}%, video rate ${(metricsSummary.video_rate * 100).toFixed(0)}%, binding rate ${bindingRateText}, delivery rate ${(metricsSummary.delivery_rate * 100).toFixed(0)}%`)}\n`,
  );
}

function writeDiffSummary(summary: DiffSummary): void {
  process.stderr.write("\n");
  process.stderr.write(`${pc.dim("─".repeat(40))}\n`);
  const parts: string[] = [];
  if (summary.candidate_better > 0) {
    parts.push(pc.green(`${summary.candidate_better} candidate better`));
  }
  if (summary.base_better > 0) {
    parts.push(pc.yellow(`${summary.base_better} base better`));
  }
  if (summary.equivalent > 0) {
    parts.push(pc.blue(`${summary.equivalent} equivalent`));
  }
  if (summary.errored > 0) {
    parts.push(pc.red(`${summary.errored} errored`));
  }

  const duration = `${(summary.duration_ms / 1000).toFixed(1)}s`;
  process.stderr.write(` ${parts.join("  ")}  ${pc.dim(duration)}\n`);
}

export function createCompactTerminalReporter(options: {
  compactRefreshIntervalMs: number;
}): Reporter {
  const progressBoard = createProgressBoard({ enabled: true });

  type CompactCaseMeta = {
    index: number;
    total: number;
    caseType: EvalCase["type"];
  };

  const compactMetaByCaseId = new Map<string, CompactCaseMeta>();
  const compactStartedAtByCaseId = new Map<string, number>();
  let compactDashboardMode: "unknown" | "run" | "diff" = "unknown";
  let compactTotal = 0;
  let compactDone = 0;
  let compactPassed = 0;
  let compactFailed = 0;
  let compactErrored = 0;
  let compactCandidateBetter = 0;
  let compactBaseBetter = 0;
  let compactEquivalent = 0;

  const renderCompactRunningRow = (caseId: string): string => {
    const meta = compactMetaByCaseId.get(caseId);
    const progress = meta ? `[${meta.index + 1}/${meta.total}]` : "[?/?]";
    const typeTag = meta ? ` (${meta.caseType})` : "";
    const startedAt = compactStartedAtByCaseId.get(caseId) ?? Date.now();
    const elapsed = formatElapsedMs(Date.now() - startedAt);
    return `  ${pc.dim("▶")} ${pc.dim(progress)} ${caseId}${pc.dim(typeTag)}  ${pc.dim(`running... (${elapsed})`)}`;
  };

  const renderCompactDashboard = (): string => {
    const running = compactStartedAtByCaseId.size;
    const progressBar = renderCompactProgressBar(compactDone, compactTotal);
    if (compactDashboardMode === "run") {
      return pc.dim(
        `Progress: [${progressBar}] ${compactDone}/${compactTotal} | PASS ${compactPassed} | FAIL ${compactFailed} | ERR ${compactErrored} | RUN ${running}`,
      );
    }
    if (compactDashboardMode === "diff") {
      return pc.dim(
        `Progress: [${progressBar}] ${compactDone}/${compactTotal} | CAND ${compactCandidateBetter} | BASE ${compactBaseBetter} | EQUAL ${compactEquivalent} | ERR ${compactErrored} | RUN ${running}`,
      );
    }
    return pc.dim(
      `Progress: [${progressBar}] ${compactDone}/${compactTotal} | RUN ${running}`,
    );
  };

  const refreshCompactRunningRows = (): void => {
    if (compactStartedAtByCaseId.size === 0) {
      return;
    }

    const updates = [...compactStartedAtByCaseId.keys()].map((caseId) => ({
      key: caseId,
      row: renderCompactRunningRow(caseId),
    }));
    progressBoard.updateRows(updates);
    progressBoard.setFooter(renderCompactDashboard());
  };

  const ticker = createTickerManager({
    intervalMs: options.compactRefreshIntervalMs,
    isLive: progressBoard.isLive,
    onTick: refreshCompactRunningRows,
  });

  return {
    onCaseStart(c: EvalCase, index: number, total: number) {
      compactMetaByCaseId.set(c.id, { index, total, caseType: c.type });
      compactStartedAtByCaseId.set(c.id, Date.now());
      compactTotal = total;
      progressBoard.startRow(c.id, index, renderCompactRunningRow(c.id));
      ticker.ensure();
      progressBoard.setFooter(renderCompactDashboard());
    },

    onDelta() {},
    onToolStart() {},
    onToolCall() {},

    onCaseResult(result: EvalResult) {
      compactDashboardMode = "run";
      compactStartedAtByCaseId.delete(result.case_id);
      compactDone += 1;
      if (result.error) {
        compactErrored += 1;
      } else if (result.passed) {
        compactPassed += 1;
      } else {
        compactFailed += 1;
      }

      const statusLabel = result.error
        ? pc.yellow("ERR")
        : result.passed
          ? pc.green("PASS")
          : pc.red("FAIL");
      const duration = pc.dim(
        `${(result.trace.duration_ms / 1000).toFixed(1)}s`,
      );
      const tokens = pc.dim(`${result.trace.usage.total_tokens} tok`);
      const errorSuffix = result.error ? `  ${pc.red(result.error)}` : "";
      const meta = compactMetaByCaseId.get(result.case_id);
      const progress = meta
        ? pc.dim(`[${meta.index + 1}/${meta.total}]`)
        : pc.dim("[?/?]");
      const typeTag = meta ? pc.dim(`(${meta.caseType})`) : "";

      // Simplified timing summary
      let timingSuffix = "";
      if (result.trace.spans && result.trace.spans.length > 0) {
        let llmTotal = 0;
        let toolTotal = 0;
        for (const span of result.trace.spans) {
          if (span.kind === "llm_turn") llmTotal += span.duration_ms;
          if (span.kind === "tool_call") toolTotal += span.duration_ms;
        }
        timingSuffix = pc.dim(
          ` | LLM ${(llmTotal / 1000).toFixed(1)}s | Tools ${(toolTotal / 1000).toFixed(1)}s`,
        );
      }

      progressBoard.finishRow(
        result.case_id,
        `  ${result.passed ? pc.green("✓") : pc.red("✗")} ${progress} ${result.case_id}${typeTag ? ` ${typeTag}` : ""}  ${statusLabel}  ${duration}  ${tokens}${timingSuffix}${errorSuffix}`,
      );
      ticker.maybeStop(compactStartedAtByCaseId.size);
      progressBoard.setFooter(renderCompactDashboard());
    },

    onDiffResult(result: DiffResult) {
      compactDashboardMode = "diff";
      compactStartedAtByCaseId.delete(result.case_id);
      compactDone += 1;
      if (result.verdict === "candidate_better") {
        compactCandidateBetter += 1;
      } else if (result.verdict === "base_better") {
        compactBaseBetter += 1;
      } else if (result.verdict === "equivalent") {
        compactEquivalent += 1;
      } else {
        compactErrored += 1;
      }

      const meta = compactMetaByCaseId.get(result.case_id);
      const progress = meta
        ? pc.dim(`[${meta.index + 1}/${meta.total}]`)
        : pc.dim("[?/?]");
      const typeTag = meta ? pc.dim(`(${meta.caseType})`) : "";
      const verdictLabel =
        result.verdict === "candidate_better"
          ? pc.green("CAND")
          : result.verdict === "base_better"
            ? pc.yellow("BASE")
            : result.verdict === "equivalent"
              ? pc.blue("EQUAL")
              : pc.red("ERR");
      const verdictIcon =
        result.verdict === "candidate_better"
          ? pc.green("✓")
          : result.verdict === "base_better"
            ? pc.yellow("!")
            : result.verdict === "equivalent"
              ? pc.blue("≈")
              : pc.red("✗");
      const shortReason =
        result.reason.length > 80
          ? `${result.reason.slice(0, 80)}…`
          : result.reason;
      progressBoard.finishRow(
        result.case_id,
        `  ${verdictIcon} ${progress} ${result.case_id}${typeTag ? ` ${typeTag}` : ""}  ${verdictLabel}  ${pc.dim(shortReason)}`,
      );
      ticker.maybeStop(compactStartedAtByCaseId.size);
      progressBoard.setFooter(renderCompactDashboard());
    },

    onSummary(summary: EvalSummary) {
      ticker.clear();
      progressBoard.clearFooter();
      writeRunSummary(summary);
    },

    onDiffSummary(summary: DiffSummary) {
      ticker.clear();
      progressBoard.clearFooter();
      writeDiffSummary(summary);
    },
  };
}

export function createVerboseTerminalReporter(options: {
  verbose: boolean;
  heartbeatIntervalMs: number;
}): Reporter {
  let currentLine = "";
  let hasStreamedDelta = false;
  let activeToolName: string | null = null;
  let activeToolStartedAt = 0;

  const toolHeartbeat = createTickerManager({
    intervalMs: options.heartbeatIntervalMs,
    isLive: true,
    onTick: () => {
      if (!activeToolName) {
        return;
      }
      if (currentLine.length > 0) {
        process.stderr.write("\n");
        currentLine = "";
      }
      const elapsedSec = Math.max(
        1,
        Math.floor((Date.now() - activeToolStartedAt) / 1000),
      );
      process.stderr.write(
        `       ${pc.dim(`⏳ ${activeToolName} still running... ${elapsedSec}s`)}\n`,
      );
    },
  });

  const clearToolHeartbeat = (): void => {
    toolHeartbeat.clear();
    activeToolName = null;
    activeToolStartedAt = 0;
  };

  const startToolHeartbeat = (toolName: string): void => {
    clearToolHeartbeat();
    activeToolName = toolName;
    activeToolStartedAt = Date.now();
    toolHeartbeat.ensure();
  };

  return {
    onCaseStart(c: EvalCase, index: number, total: number) {
      clearToolHeartbeat();
      hasStreamedDelta = false;
      process.stderr.write(
        `\n${pc.bold(`[${index + 1}/${total}]`)} ${c.id} ${pc.dim(`(${c.type})`)}\n`,
      );
    },

    onDelta(delta: string) {
      if (!hasStreamedDelta) {
        process.stderr.write(`  ${pc.cyan("assistant")} `);
      }

      hasStreamedDelta = true;
      const rendered = delta.replace(/\n/g, "\n  ");
      process.stderr.write(rendered);
      if (rendered.includes("\n")) {
        currentLine = rendered.endsWith("\n")
          ? ""
          : rendered.slice(rendered.lastIndexOf("\n") + 1);
      } else {
        currentLine += rendered;
      }
    },

    onToolStart(call: ToolCallStartRecord) {
      if (currentLine.length > 0) {
        process.stderr.write("\n");
        currentLine = "";
      }
      const argsAligned = formatToolArguments(
        call.arguments,
        options.verbose,
      ).replace(/\n/g, "\n              ");
      process.stderr.write(`    ${pc.cyan("tool")} ${call.name}\n`);
      process.stderr.write(`       ${pc.dim(`args: ${argsAligned}`)}\n`);
      process.stderr.write(`       ${pc.dim("running...")}\n`);
      startToolHeartbeat(call.name);
    },

    onToolCall(call: ToolCallRecord) {
      clearToolHeartbeat();
      if (currentLine.length > 0) {
        process.stderr.write("\n");
        currentLine = "";
      }

      const outputAligned = formatToolReturnForLlm(
        call.output,
        options.verbose,
      ).replace(/\n/g, "\n                         ");
      const duration = pc.dim(`(${(call.duration_ms / 1000).toFixed(1)}s)`);
      process.stderr.write(
        `       ${pc.dim(`llm_tool_return: ${outputAligned}`)} ${duration}\n`,
      );
    },

    onCaseResult(result: EvalResult) {
      clearToolHeartbeat();
      if (currentLine.length > 0) {
        process.stderr.write("\n");
        currentLine = "";
      }

      const response = result.trace.final_response?.trim();
      if (response && (!hasStreamedDelta || options.verbose)) {
        const preview =
          options.verbose || response.length <= 200
            ? response
            : `${response.slice(0, 200)}…`;
        process.stderr.write(`  ${pc.cyan("assistant")} ${preview}\n`);
      }

      if (response) {
        const imageUrls = extractMarkdownImageUrls(response);
        if (imageUrls.length > 0) {
          const preview = imageUrls
            .map((url) => truncateText(url, 100))
            .join(", ");
          process.stderr.write(
            `  ${pc.dim(`🖼 image markdown detected. open URL in browser (Cmd/Ctrl+Click): ${preview}`)}\n`,
          );
        }
      }

      for (const dim of result.dimensions) {
        const icon = dim.passed ? pc.green("✔") : pc.red("✘");
        const score = dim.score.toFixed(2);
        process.stderr.write(
          `  ${icon} ${pc.dim(dim.dimension.padEnd(14))} ${score}  ${pc.dim(dim.reason)}\n`,
        );
      }

      const statusLabel = result.passed
        ? pc.bgGreen(pc.black(" PASS "))
        : pc.bgRed(pc.white(" FAIL "));
      process.stderr.write(
        `  ${statusLabel}  ${pc.dim(`${(result.trace.duration_ms / 1000).toFixed(1)}s`)}  ${pc.dim(`${result.trace.usage.total_tokens} tokens`)}\n`,
      );
      process.stderr.write(
        `  ${pc.dim(renderCaseMetricsBrief(resolveMetrics(result)))}\n`,
      );

      // Render timing Gantt chart
      if (result.trace.spans && result.trace.spans.length > 0) {
        const timingSummary = computeTimingSummary(result.trace.spans);
        if (timingSummary) {
          process.stderr.write(renderTimingGantt(result.trace.spans, timingSummary));
        }
      }

      if (options.verbose) {
        const artifactLines = renderVerboseArtifactLines(result);
        if (artifactLines.length > 0) {
          process.stderr.write(`  ${pc.dim("artifacts:")}\n`);
          for (const line of artifactLines) {
            process.stderr.write(`    ${pc.dim(line)}\n`);
          }
        }
      }

      if (result.error) {
        process.stderr.write(`  ${pc.red("error:")} ${result.error}\n`);
      }
    },

    onDiffResult(result: DiffResult) {
      clearToolHeartbeat();
      if (currentLine.length > 0) {
        process.stderr.write("\n");
        currentLine = "";
      }

      const verdictIcons: Record<string, string> = {
        base_better: pc.yellow("✦ BASE BETTER"),
        candidate_better: pc.green("✦ CANDIDATE BETTER"),
        equivalent: pc.blue("≈ EQUIVALENT"),
        error: pc.red("✘ ERROR"),
      };

      if (result.verdict !== "error") {
        const baseTools = result.base.tools_called
          .map((t) => t.name)
          .join(" → ");
        const candTools = result.candidate.tools_called
          .map((t) => t.name)
          .join(" → ");
        const baseSummary =
          baseTools ||
          (result.base.final_response
            ? `"${result.base.final_response.slice(0, 40)}…"`
            : "(no response)");
        const candSummary =
          candTools ||
          (result.candidate.final_response
            ? `"${result.candidate.final_response.slice(0, 40)}…"`
            : "(no response)");
        process.stderr.write(`  base:      ${pc.dim(baseSummary)}\n`);
        process.stderr.write(`  candidate: ${pc.dim(candSummary)}\n`);
      }

      process.stderr.write(
        `  verdict:   ${verdictIcons[result.verdict] ?? result.verdict} — ${pc.dim(result.reason)}\n`,
      );
    },

    onSummary(summary: EvalSummary) {
      clearToolHeartbeat();
      writeRunSummary(summary);
    },

    onDiffSummary(summary: DiffSummary) {
      clearToolHeartbeat();
      writeDiffSummary(summary);
    },
  };
}
