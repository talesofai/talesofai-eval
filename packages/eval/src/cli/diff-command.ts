import { DEFAULT_MCP_SERVER_BASE_URL } from "../constants.ts";
import {
  invalidJson,
  missingConfig,
  noCases,
  validationError,
} from "../errors.ts";
import { runCase } from "../runners/index.ts";
import { compareTraces } from "../scorers/diff.ts";
import type { DiffSummary, DiffVerdict, RunnerOptions } from "../types.ts";
import { runConcurrently } from "../utils/concurrency.ts";
import { resolveCasesFromArgs } from "./case-resolution.ts";
import {
  applyOverrides,
  createReporterFromFormat,
  makeErrorTrace,
  resolveConcurrency,
} from "./command-utils.ts";
import { getMissingDiffConfig } from "./config-check.ts";
import { getStringOption, isRecord, parseFormat } from "./helpers.ts";

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

  const reporter = createReporterFromFormat(format, verbose, concurrency);
  const startTime = Date.now();

  const tasks = cases.map(
    (evalCase, index) => async (): Promise<DiffVerdict> => {
      reporter.onCaseStart(evalCase, index, cases.length);

      try {
        const baseCase = applyOverrides(evalCase, baseOverrides);
        const candidateCase = applyOverrides(evalCase, candidateOverrides);

        const runnerOpts: RunnerOptions = {
          mcpServerBaseURL:
            process.env["EVAL_MCP_SERVER_BASE_URL"] ??
            DEFAULT_MCP_SERVER_BASE_URL,
          onDelta: (delta: string) => reporter.onDelta(delta),
          onToolStart: (call) => reporter.onToolStart(call),
          onToolCall: (call) => reporter.onToolCall(call),
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

  const verdicts = await runConcurrently(tasks, concurrency);

  const diffSummary: DiffSummary = {
    total: cases.length,
    base_better: verdicts.filter((verdict) => verdict === "base_better").length,
    candidate_better: verdicts.filter(
      (verdict) => verdict === "candidate_better",
    ).length,
    equivalent: verdicts.filter((verdict) => verdict === "equivalent").length,
    errored: verdicts.filter((verdict) => verdict === "error").length,
    duration_ms: Date.now() - startTime,
  };
  reporter.onDiffSummary(diffSummary);

  return verdicts.some((verdict) => verdict === "error") ? 2 : 0;
}
