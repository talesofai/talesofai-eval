import { resolveMcpServerBaseURL } from "../config.ts";
import { compareTraces } from "../diff/index.ts";
import { missingConfig, noCases } from "../errors.ts";
import { runCase } from "../runner/index.ts";
import type { DiffSummary, DiffVerdict, RunnerOptions } from "../types.ts";
import { runConcurrently } from "../utils/concurrency.ts";
import { resolveCasesFromArgs } from "./case-resolution.ts";
import {
  applyOverrides,
  createReporterFromFormat,
  makeErrorTrace,
  resolveConcurrency,
} from "./command-utils.ts";
import { getMissingDiffConfig, validateModels } from "./config-check.ts";
import type { DiffCommandOptions } from "./options.ts";

export async function diffCommand(
  options: DiffCommandOptions,
): Promise<number> {
  const { cases, unmatchedFilePatterns } = resolveCasesFromArgs(options);
  if (cases.length === 0) {
    throw noCases("diff", unmatchedFilePatterns);
  }

  const baseOverrides = options.baseOverrides;
  const candidateOverrides = options.candidateOverrides;

  const format = options.format;
  const verbose = options.verbose;
  const concurrency = resolveConcurrency(options.concurrency, cases.length);
  const missing = getMissingDiffConfig(cases);
  if (missing.length > 0) {
    throw missingConfig(missing, "diff");
  }

  // Validate model connectivity
  const validationErrors = await validateModels(cases, {
    variantOverrides: [baseOverrides, candidateOverrides],
  });
  if (validationErrors.length > 0) {
    const errorMessages = validationErrors.map(
      (e) => `Model "${e.modelId}": ${e.error}`,
    );
    throw new Error(
      `Model validation failed:\n${errorMessages.map((m) => `  - ${m}`).join("\n")}`,
    );
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
          mcpServerBaseURL: resolveMcpServerBaseURL(),
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
