import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import pc from "picocolors";
import { computeRunExitCode } from "../cli-shared.ts";
import { resolveMcpServerBaseURL } from "../env.ts";
import { invalidArgs, missingConfig, noCases } from "../errors.ts";
import { renderRunHtmlReport } from "../reporter/html.ts";
import { renderRunMarkdownReport } from "../reporter/terminal.ts";
import { scoreTrace } from "../scorers/index.ts";
import { loadResult, loadTrace, saveResult } from "../traces.ts";
import type { EvalCase, EvalResult, EvalSummary, EvalTrace } from "../types.ts";
import { runConcurrently } from "../utils/concurrency.ts";
import { makeAutoRecordDir, resolveRunRecordDir } from "../utils/recording.ts";
import { resolveCasesFromArgs } from "./case-resolution.ts";
import {
  createReporterFromFormat,
  createRunnerOptions,
  makeErrorTrace,
  resolveConcurrency,
  runAndScore,
  withStableMetrics,
} from "./command-utils.ts";
import { getMissingJudgeConfig, getMissingRunConfig } from "./config-check.ts";
import { getStringOption, parseFormat } from "./helpers.ts";
import { maybeShareHtmlReport } from "./share.ts";

function resolveRunReportPath(options: {
  recordDir?: string;
  replayDir?: string;
  now?: Date;
}): string | undefined {
  if (options.recordDir) {
    return join(options.recordDir, "run-report.md");
  }

  if (options.replayDir) {
    const replayReportDir = makeAutoRecordDir("replay", options.now);
    return join(replayReportDir, "run-report.md");
  }

  return undefined;
}

function writeRunReport(options: {
  summary: EvalSummary;
  reportPath?: string;
  format: ReturnType<typeof parseFormat>;
  html: string;
}): { htmlPath?: string } {
  if (!options.reportPath) {
    return {};
  }

  mkdirSync(dirname(options.reportPath), { recursive: true });
  writeFileSync(
    options.reportPath,
    renderRunMarkdownReport(options.summary),
    "utf8",
  );

  const htmlPath = options.reportPath.replace(/\.md$/, ".html");
  writeFileSync(htmlPath, options.html, "utf8");

  if (options.format === "terminal") {
    process.stderr.write(pc.dim(`report: ${options.reportPath}\n`));
    process.stderr.write(pc.dim(`report: ${htmlPath}\n`));
  }

  return { htmlPath };
}

function makeErroredResultFromTrace(options: {
  caseId: string;
  caseType: "plain" | "agent";
  description?: string;
  preset_description?: string;
  trace: EvalTrace;
  fallbackError: string;
}): EvalResult {
  return {
    case_id: options.caseId,
    case_type: options.caseType,
    description: options.description,
    preset_description: options.preset_description,
    passed: false,
    dimensions: [],
    trace: options.trace,
    error: options.trace.error ?? options.fallbackError,
  };
}

function normalizeCachedResult(result: EvalResult): EvalResult {
  if (result.error) {
    return withStableMetrics(result);
  }

  if (result.trace.status !== "error" && !result.trace.error) {
    return withStableMetrics(result);
  }

  return withStableMetrics({
    case_id: result.case_id,
    case_type: result.case_type,
    description: result.description,
    preset_description: result.preset_description,
    passed: false,
    dimensions: [],
    trace: result.trace,
    error: result.trace.error ?? "Runner error in replay trace",
  });
}

async function runReplayCase(options: {
  evalCase: EvalCase;
  replayDir: string;
  replayWriteMetrics: boolean;
  replayMissingJudgeConfig: string[];
}): Promise<EvalResult> {
  try {
    const cachedResult = await loadResult(
      options.evalCase.id,
      options.replayDir,
    );
    if (cachedResult) {
      const cachedHasMetrics = Boolean(cachedResult.metrics);
      const result = normalizeCachedResult(cachedResult);
      if (options.replayWriteMetrics && !cachedHasMetrics) {
        await saveResult(result, options.replayDir).catch(() => {});
      }
      return result;
    }

    const trace = await loadTrace(options.evalCase.id, options.replayDir);
    if (trace.status === "error" || trace.error) {
      return withStableMetrics(
        makeErroredResultFromTrace({
          caseId: options.evalCase.id,
          caseType: options.evalCase.type,
          description: options.evalCase.description,
          preset_description:
            options.evalCase.type === "agent"
              ? options.evalCase.input.preset_description
              : undefined,
          trace,
          fallbackError: "Runner error in replay trace",
        }),
      );
    }

    const needsJudge =
      options.evalCase.criteria.assertions?.some(
        (assertion) => assertion.type === "llm_judge",
      ) ?? false;
    if (needsJudge && options.replayMissingJudgeConfig.length > 0) {
      throw new Error(
        `Replay cache miss for ${options.evalCase.id} and missing judge config: ${options.replayMissingJudgeConfig.join(", ")}`,
      );
    }

    return withStableMetrics(await scoreTrace(options.evalCase, trace));
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return withStableMetrics({
      case_id: options.evalCase.id,
      case_type: options.evalCase.type,
      description: options.evalCase.description,
      preset_description:
        options.evalCase.type === "agent"
          ? options.evalCase.input.preset_description
          : undefined,
      passed: false,
      dimensions: [],
      trace: makeErrorTrace(
        options.evalCase.id,
        options.evalCase.type,
        errorMsg,
      ),
      error: errorMsg,
    });
  }
}

export async function runCommand(
  options: Record<string, unknown>,
): Promise<number> {
  const { cases, unmatchedFilePatterns } = resolveCasesFromArgs(options);
  if (cases.length === 0) {
    throw noCases("run", unmatchedFilePatterns);
  }

  const explicitRecordDir = getStringOption(options, "record");
  const replayDir = getStringOption(options, "replay");
  const replayWriteMetrics = options["replayWriteMetrics"] === true;
  if (explicitRecordDir && replayDir) {
    throw invalidArgs(
      "--record and --replay are mutually exclusive",
      "Use either --record <dir> or --replay <dir>, not both.",
    );
  }

  if (replayWriteMetrics && !replayDir) {
    throw invalidArgs(
      "--replay-write-metrics requires --replay",
      "Example: agent-eval run --replay <dir> --replay-write-metrics",
    );
  }

  const format = parseFormat(options["format"] ?? "terminal");
  const verbose = options["verbose"] === true;
  const concurrency = resolveConcurrency(options, cases.length);
  const recordDir = resolveRunRecordDir({
    explicitRecordDir,
    replayDir,
    caseCount: cases.length,
  });

  if (!explicitRecordDir && recordDir && format === "terminal") {
    process.stderr.write(pc.dim(`auto-record: ${recordDir}\n`));
  }

  const missing = getMissingRunConfig(cases, { replay: Boolean(replayDir) });
  if (missing.length > 0) {
    throw missingConfig(missing, "run");
  }

  const replayMissingJudgeConfig = replayDir ? getMissingJudgeConfig() : [];
  const reportPath = resolveRunReportPath({
    recordDir,
    replayDir,
    now: new Date(),
  });

  const reporter = createReporterFromFormat(format, verbose, concurrency);
  const startTime = Date.now();

  const runnerOpts = createRunnerOptions({
    reporter,
    mcpServerBaseURL: resolveMcpServerBaseURL(),
  });

  const tasks = cases.map(
    (evalCase, index) => async (): Promise<EvalResult> => {
      reporter.onCaseStart(evalCase, index, cases.length);
      const result = replayDir
        ? await runReplayCase({
            evalCase,
            replayDir,
            replayWriteMetrics,
            replayMissingJudgeConfig,
          })
        : await runAndScore({
            runCase: evalCase,
            scoreCase: evalCase,
            runnerOpts,
            recordDir,
          });
      reporter.onCaseResult(result);
      return result;
    },
  );

  const results = await runConcurrently(tasks, concurrency);

  const replayDurationMs = results.reduce(
    (totalMs, result) => totalMs + result.trace.duration_ms,
    0,
  );

  const summary: EvalSummary = {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed && !result.error).length,
    errored: results.filter((result) => Boolean(result.error)).length,
    duration_ms: replayDir ? replayDurationMs : Date.now() - startTime,
    results,
  };
  reporter.onSummary(summary);

  const shareEnabled = options["share"] !== false;
  const shouldBuildHtml = Boolean(reportPath) || shareEnabled;
  const html = shouldBuildHtml ? await renderRunHtmlReport(summary) : null;

  const { htmlPath } = html
    ? writeRunReport({
        summary,
        reportPath,
        format,
        html,
      })
    : {};

  if (html && shareEnabled) {
    const share = await maybeShareHtmlReport({
      enabled: true,
      html,
      filename: htmlPath ? basename(htmlPath) : "run-report.html",
      baseUrlOption: getStringOption(options, "shareBaseUrl"),
    });

    if (format === "json") {
      if (share.status === "shared") {
        process.stdout.write(
          `${JSON.stringify({ type: "share", share_url: share.shareUrl })}\n`,
        );
      } else if (share.status === "failed") {
        process.stdout.write(
          `${JSON.stringify({ type: "share", error: share.reason })}\n`,
        );
      }
    } else if (share.status === "shared") {
      process.stderr.write(pc.green(`share: ${share.shareUrl}\n`));
    } else if (share.status === "failed") {
      process.stderr.write(pc.yellow(`share: ${share.reason}\n`));
    }
  }

  return computeRunExitCode(results);
}
