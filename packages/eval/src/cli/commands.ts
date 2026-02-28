import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import pc from "picocolors";
import { computeRunExitCode } from "../cli-shared.ts";
import {
  invalidArgs,
  invalidJson,
  missingConfig,
  noCases,
  validationError,
} from "../errors.ts";
import {
  computeTraceMetrics,
  stripTraceMetricsDebug,
} from "../metrics/trace-metrics.ts";
import { renderRunHtmlReport } from "../reporter/html.ts";
import {
  createJsonMatrixReporter,
  createJsonReporter,
} from "../reporter/json.ts";
import {
  createTerminalMatrixReporter,
  createTerminalReporter,
  renderRunMarkdownReport,
} from "../reporter/terminal.ts";
import { runCase } from "../runners/index.ts";
import { createManuscriptProxy } from "../runners/manuscript-proxy.ts";
import { compareTraces } from "../scorers/diff.ts";
import { scoreTrace } from "../scorers/index.ts";
import { loadResult, loadTrace, saveResult, saveTrace } from "../traces.ts";
import {
  DEFAULT_ALLOWED_TOOL_NAMES,
  type DiffSummary,
  type DiffVerdict,
  type EvalCase,
  type EvalResult,
  type EvalSummary,
  type EvalTrace,
  type MatrixCell,
  type MatrixReporter,
  type MatrixSummary,
  type MatrixVariant,
  type Reporter,
  type RunnerOptions,
  type ToolCallRecord,
  type ToolCallStartRecord,
} from "../types.ts";
import { runConcurrently } from "../utils/concurrency.ts";
import {
  makeAutoRecordDir,
  resolveMatrixRecordDir,
  resolveRunRecordDir,
} from "../utils/recording.ts";
import { resolveCasesFromArgs } from "./case-resolution.ts";
import {
  getNumberOption,
  getStringArrayOption,
  getStringOption,
  isRecord,
  type OutputFormat,
  parseFormat,
} from "./helpers.ts";
import { maybeShareHtmlReport } from "./share.ts";

export {
  doctorCommand,
  inspectCommand,
  listCommand,
  pullOnlineCommand,
  reportCommand,
} from "./aux-commands.ts";

function createReporterFromFormat(
  format: OutputFormat,
  verbose: boolean,
  concurrency = 1,
): Reporter {
  if (format === "json") {
    return createJsonReporter({ verbose });
  }
  return createTerminalReporter({ verbose, concurrency });
}

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
  format: OutputFormat;
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

function makeErrorTrace(
  caseId: string,
  caseType: "plain" | "agent",
  errorMsg?: string,
): EvalTrace {
  return {
    case_id: caseId,
    case_type: caseType,
    conversation: [],
    tools_called: [],
    final_response: null,
    status: "error",
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    duration_ms: 0,
    ...(errorMsg !== undefined ? { error: errorMsg } : {}),
  };
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

function withStableMetrics(result: EvalResult): EvalResult {
  return {
    ...result,
    metrics: stripTraceMetricsDebug(computeTraceMetrics(result.trace)),
  };
}

async function maybeStartProxy(needed: boolean) {
  if (!needed) {
    return null;
  }

  const proxyPort = Number(process.env["EVAL_PROXY_PORT"] ?? "19000");
  const proxy = createManuscriptProxy({
    port: proxyPort,
    upstreamBaseURL: process.env["EVAL_UPSTREAM_API_BASE_URL"],
    upstreamToken: process.env["EVAL_UPSTREAM_X_TOKEN"],
    allowedToolNames: [...DEFAULT_ALLOWED_TOOL_NAMES],
  });

  await proxy.start();
  process.stderr.write(
    pc.dim(`ManuscriptProxy started on port ${proxyPort}\n`),
  );
  return proxy;
}

function applyOverrides(
  evalCase: EvalCase,
  overrides: Record<string, unknown>,
): EvalCase {
  return {
    ...evalCase,
    input: { ...evalCase.input, ...overrides },
  } as EvalCase;
}

/**
 * Run a case, catch errors, and save trace/result to disk.
 * Internal helper to eliminate duplicate run-catch-save logic.
 */
async function runAndScore(options: {
  runCase: EvalCase;
  scoreCase: EvalCase;
  runnerOpts: RunnerOptions;
  recordDir?: string;
}): Promise<EvalResult> {
  try {
    const trace = await runCase(options.runCase, options.runnerOpts);
    if (options.recordDir) {
      await saveTrace(trace, options.recordDir);
    }

    const result = withStableMetrics(
      await scoreTrace(options.scoreCase, trace),
    );
    if (options.recordDir) {
      await saveResult(result, options.recordDir).catch(() => {});
    }
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorTrace = makeErrorTrace(
      options.runCase.id,
      options.runCase.type,
      errorMsg,
    );

    if (options.recordDir) {
      await saveTrace(errorTrace, options.recordDir).catch(() => {});
    }

    const result = withStableMetrics({
      case_id: options.runCase.id,
      case_type: options.runCase.type,
      description: options.runCase.description,
      preset_description:
        options.runCase.type === "agent"
          ? options.runCase.input.preset_description
          : undefined,
      passed: false,
      dimensions: [],
      trace: errorTrace,
      error: errorMsg,
    });

    if (options.recordDir) {
      await saveResult(result, options.recordDir).catch(() => {});
    }

    return result;
  }
}

function createRunnerOptions(options: {
  reporter: Reporter;
  mcpServerBaseURL: string;
  proxyPort?: number;
}): RunnerOptions {
  return {
    mcpServerBaseURL: options.mcpServerBaseURL,
    proxyPort: options.proxyPort,
    onDelta: (delta: string) => options.reporter.onDelta(delta),
    onToolStart: (call: ToolCallStartRecord) =>
      options.reporter.onToolStart(call),
    onToolCall: (call: ToolCallRecord) => options.reporter.onToolCall(call),
  };
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
        (a) => a.type === "llm_judge",
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

function caseNeedsMcp(evalCase: EvalCase): boolean {
  if (evalCase.type === "agent") return true;
  const atns = evalCase.input.allowed_tool_names;
  return atns === undefined || atns.length > 0;
}

function resolveDefaultConcurrency(totalTasks: number): number {
  return Math.max(1, Math.min(totalTasks, 8));
}

function resolveConcurrency(
  options: Record<string, unknown>,
  totalTasks: number,
): number {
  const configured = getNumberOption(options, "concurrency");
  if (configured === undefined) {
    return resolveDefaultConcurrency(totalTasks);
  }

  return Math.max(1, configured);
}

function hasEnvValue(key: string): boolean {
  const value = process.env[key];
  return Boolean(value && value.trim().length > 0);
}

function isMissingEnvValue(key: string): boolean {
  return !hasEnvValue(key);
}

function hasEnvPair(first: string, second: string): boolean {
  return hasEnvValue(first) && hasEnvValue(second);
}

function getMissingJudgeConfig(): string[] {
  const missing: string[] = [];
  const judgeBase =
    process.env["EVAL_JUDGE_BASE_URL"] ?? process.env["OPENAI_BASE_URL"];
  const judgeApiKey =
    process.env["EVAL_JUDGE_API_KEY"] ?? process.env["OPENAI_API_KEY"];

  if (!judgeBase || judgeBase.trim().length === 0) {
    missing.push("EVAL_JUDGE_BASE_URL|OPENAI_BASE_URL");
  }

  if (!judgeApiKey || judgeApiKey.trim().length === 0) {
    missing.push("EVAL_JUDGE_API_KEY|OPENAI_API_KEY");
  }

  return missing;
}

function getMissingRunConfig(
  cases: EvalCase[],
  options?: { replay?: boolean },
): string[] {
  const replay = options?.replay ?? false;

  if (replay) {
    // Replay prefers cached *.result.json when available, so no upfront judge
    // env requirement here. If cache is missing for a case with llm_judge,
    // that case falls back to scoring and may require judge config then.
    return [];
  }

  const required = new Set<string>();

  const hasAgentCase = cases.some((evalCase) => evalCase.type === "agent");
  const hasPlainCase = cases.some((evalCase) => evalCase.type === "plain");

  if (hasAgentCase) {
    required.add("OPENAI_BASE_URL");
    required.add("OPENAI_API_KEY");
    required.add("EVAL_UPSTREAM_API_BASE_URL");
  }

  if (hasPlainCase) {
    const hasPlainOpenaiPair = hasEnvPair("OPENAI_BASE_URL", "OPENAI_API_KEY");
    const hasEvalPlainPair = hasEnvPair(
      "EVAL_PLAIN_BASE_URL",
      "EVAL_PLAIN_API_KEY",
    );

    if (!hasPlainOpenaiPair && !hasEvalPlainPair) {
      required.add(
        "EVAL_PLAIN_BASE_URL+EVAL_PLAIN_API_KEY|OPENAI_BASE_URL+OPENAI_API_KEY",
      );
    }
  }

  if (cases.some(caseNeedsMcp)) {
    required.add("EVAL_MCP_SERVER_BASE_URL");
  }

  return [...required].filter((key) => {
    if (key.includes("+") || key.includes("|")) {
      return true;
    }
    return isMissingEnvValue(key);
  });
}

function getMissingDiffConfig(cases: EvalCase[]): string[] {
  const missing = new Set<string>(
    getMissingRunConfig(cases, { replay: false }),
  );
  for (const key of getMissingJudgeConfig()) {
    missing.add(key);
  }
  return [...missing];
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

  const needsAgent =
    !replayDir && cases.some((evalCase) => evalCase.type === "agent");
  const reporter = createReporterFromFormat(format, verbose, concurrency);
  const proxy = await maybeStartProxy(needsAgent);

  const startTime = Date.now();

  const runnerOpts = createRunnerOptions({
    reporter,
    mcpServerBaseURL: process.env["EVAL_MCP_SERVER_BASE_URL"] ?? "",
    proxyPort: proxy
      ? Number(process.env["EVAL_PROXY_PORT"] ?? "19000")
      : undefined,
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

  let results: EvalResult[] = [];

  try {
    results = await runConcurrently(tasks, concurrency);

    const replayDurationMs = results.reduce(
      (totalMs, result) => totalMs + result.trace.duration_ms,
      0,
    );

    const summary: EvalSummary = {
      total: results.length,
      passed: results.filter((result) => result.passed).length,
      failed: results.filter((result) => !result.passed && !result.error)
        .length,
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
  } finally {
    await proxy?.stop();
  }

  return computeRunExitCode(results);
}

export async function diffCommand(
  options: Record<string, unknown>,
): Promise<number> {
  const { cases, unmatchedFilePatterns } = resolveCasesFromArgs(options);
  if (cases.length === 0) {
    throw noCases("diff", unmatchedFilePatterns);
  }

  const baseStr = getStringOption(options, "base");
  const candidateStr = getStringOption(options, "candidate");
  if (!baseStr || !candidateStr) {
    throw validationError("flags", [
      "--base and --candidate are required for diff",
    ]);
  }

  let baseOverrides: Record<string, unknown>;
  try {
    const parsed = JSON.parse(baseStr);
    if (!isRecord(parsed)) {
      throw new Error("must be an object");
    }
    baseOverrides = parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw invalidJson("base", error.message);
    }
    throw error;
  }

  let candidateOverrides: Record<string, unknown>;
  try {
    const parsed = JSON.parse(candidateStr);
    if (!isRecord(parsed)) {
      throw new Error("must be an object");
    }
    candidateOverrides = parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw invalidJson("candidate", error.message);
    }
    throw error;
  }

  const format = parseFormat(options["format"] ?? "terminal");
  const verbose = options["verbose"] === true;
  const concurrency = resolveConcurrency(options, cases.length);
  const missing = getMissingDiffConfig(cases);
  if (missing.length > 0) {
    throw missingConfig(missing, "diff");
  }

  const baseLabel =
    typeof baseOverrides["label"] === "string"
      ? baseOverrides["label"]
      : "base";
  const candidateLabel =
    typeof candidateOverrides["label"] === "string"
      ? candidateOverrides["label"]
      : "candidate";

  const needsAgent = cases.some((evalCase) => evalCase.type === "agent");
  const reporter = createReporterFromFormat(format, verbose, concurrency);
  const proxy = await maybeStartProxy(needsAgent);

  const startTime = Date.now();

  const tasks = cases.map(
    (evalCase, index) => async (): Promise<DiffVerdict> => {
      reporter.onCaseStart(evalCase, index, cases.length);

      try {
        const baseCase = applyOverrides(evalCase, baseOverrides);
        const candidateCase = applyOverrides(evalCase, candidateOverrides);

        const runnerOpts = {
          mcpServerBaseURL: process.env["EVAL_MCP_SERVER_BASE_URL"] ?? "",
          proxyPort: proxy
            ? Number(process.env["EVAL_PROXY_PORT"] ?? "19000")
            : undefined,
          onDelta: (delta: string) => reporter.onDelta(delta),
          onToolStart: (call: ToolCallStartRecord) =>
            reporter.onToolStart(call),
          onToolCall: (call: ToolCallRecord) => reporter.onToolCall(call),
        };

        const baseTrace = await runCase(baseCase, runnerOpts);
        const candidateTrace = await runCase(candidateCase, runnerOpts);

        const diffResult = await compareTraces(
          evalCase,
          baseTrace,
          candidateTrace,
          baseLabel,
          candidateLabel,
        );

        reporter.onDiffResult(diffResult);
        return diffResult.verdict;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const emptyTrace = makeErrorTrace(evalCase.id, evalCase.type, message);
        reporter.onDiffResult({
          case_id: evalCase.id,
          verdict: "error",
          reason: message,
          base: emptyTrace,
          candidate: emptyTrace,
        });
        return "error";
      }
    },
  );

  let verdicts: DiffVerdict[] = [];

  try {
    verdicts = await runConcurrently(tasks, concurrency);

    const diffSummary: DiffSummary = {
      total: cases.length,
      base_better: verdicts.filter((v) => v === "base_better").length,
      candidate_better: verdicts.filter((v) => v === "candidate_better").length,
      equivalent: verdicts.filter((v) => v === "equivalent").length,
      errored: verdicts.filter((v) => v === "error").length,
      duration_ms: Date.now() - startTime,
    };
    reporter.onDiffSummary(diffSummary);
  } finally {
    await proxy?.stop();
  }

  return verdicts.some((verdict) => verdict === "error") ? 2 : 0;
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

  const needsAgent = cases.some((evalCase) => evalCase.type === "agent");
  const proxy = await maybeStartProxy(needsAgent);
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
    mcpServerBaseURL: process.env["EVAL_MCP_SERVER_BASE_URL"] ?? "",
    proxyPort: proxy
      ? Number(process.env["EVAL_PROXY_PORT"] ?? "19000")
      : undefined,
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

  try {
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
  } finally {
    await proxy?.stop();
  }
}
