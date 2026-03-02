import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import pc from "picocolors";
import YAML from "yaml";
import { collectDoctorChecks, type DoctorMode } from "../cli-shared.ts";
import {
  resolveRunnerXToken,
  resolveUpstreamBaseURL,
  resolveUpstreamXToken,
} from "../env.ts";
import { invalidArgs, noCases } from "../errors.ts";
import { extractAgentCaseFromCollection } from "../online/extract.ts";
import { renderRunHtmlReport } from "../reporter/html.ts";
import { loadResult } from "../traces.ts";
import type { EvalResult, EvalSummary } from "../types.ts";
import { resolveCasesFromArgs } from "./case-resolution.ts";
import { getNumberOption, getStringOption, parseFormat } from "./helpers.ts";
import { maybeShareHtmlReport } from "./share.ts";

export function listCommand(): number {
  const { cases } = resolveCasesFromArgs({ case: "all" });
  const output = cases.map((evalCase) => ({
    id: evalCase.id,
    type: evalCase.type,
    description: evalCase.description,
  }));
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return 0;
}

export function inspectCommand(options: Record<string, unknown>): number {
  const { cases, unmatchedFilePatterns } = resolveCasesFromArgs(options);
  if (cases.length === 0) {
    throw noCases("inspect", unmatchedFilePatterns);
  }

  for (const evalCase of cases) {
    process.stdout.write(`${JSON.stringify(evalCase, null, 2)}\n`);
  }
  return 0;
}

export function doctorCommand(options: Record<string, unknown>): number {
  const format = parseFormat(options["format"] ?? "terminal");
  const rawMode = getStringOption(options, "mode") ?? "all";
  const mode: DoctorMode =
    rawMode === "plain" || rawMode === "agent" ? rawMode : "all";

  const checks = collectDoctorChecks(process.env, mode);
  const failing = checks.filter((check) => !check.ok && !check.optional);

  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({
        type: "doctor",
        mode,
        ok: failing.length === 0,
        checks,
      })}\n`,
    );
  } else {
    process.stderr.write(`${pc.bold(`agent-eval doctor --mode ${mode}`)}\n`);
    for (const check of checks) {
      let icon: string;
      let color: (s: string) => string;
      if (check.ok) {
        icon = pc.green("✅");
        color = pc.green;
      } else if (check.optional) {
        icon = pc.yellow("⚠️ ");
        color = pc.yellow;
      } else {
        icon = pc.red("❌");
        color = pc.red;
      }
      process.stderr.write(
        `${icon} ${color(check.key)} ${pc.dim(`[${check.requiredFor}]`)}\n`,
      );
      process.stderr.write(`   ${pc.dim(`hint: ${check.hint}`)}\n`);
    }
  }

  return failing.length === 0 ? 0 : 2;
}

function parseIntegerOptionOrThrow(options: {
  cliOptions: Record<string, unknown>;
  optionName: "pageIndex" | "pageSize";
  flagName: "--page-index" | "--page-size";
  defaultValue: number;
  validate: (value: number) => boolean;
  hint: string;
}): number {
  const raw = options.cliOptions[options.optionName];
  if (raw === undefined) {
    return options.defaultValue;
  }

  const parsed = getNumberOption(options.cliOptions, options.optionName);
  if (
    parsed === undefined ||
    !Number.isInteger(parsed) ||
    !options.validate(parsed)
  ) {
    throw invalidArgs(`${options.flagName} is invalid`, options.hint);
  }

  return parsed;
}

export async function pullOnlineCommand(
  options: Record<string, unknown>,
): Promise<number> {
  const collectionUUID = getStringOption(options, "collectionUuid");
  if (!collectionUUID || collectionUUID.trim().length === 0) {
    throw invalidArgs(
      "--collection-uuid is required",
      "Example: agent-eval pull-online --collection-uuid <uuid>",
    );
  }

  const baseURL =
    getStringOption(options, "baseUrl") ?? resolveUpstreamBaseURL();

  if (!baseURL || baseURL.trim().length === 0) {
    throw invalidArgs(
      "missing upstream api base url",
      "Set --base-url or env EVAL_UPSTREAM_API_BASE_URL",
    );
  }

  const token =
    getStringOption(options, "xToken") ??
    resolveUpstreamXToken() ??
    resolveRunnerXToken();
  if (!token || token.trim().length === 0) {
    throw invalidArgs(
      "missing x-token",
      "Set --x-token or env EVAL_UPSTREAM_X_TOKEN/OPENAI_X_TOKEN",
    );
  }

  const pageIndex = parseIntegerOptionOrThrow({
    cliOptions: options,
    optionName: "pageIndex",
    flagName: "--page-index",
    defaultValue: 0,
    validate: (value) => value >= 0,
    hint: "Example: --page-index 0",
  });

  const pageSize = parseIntegerOptionOrThrow({
    cliOptions: options,
    optionName: "pageSize",
    flagName: "--page-size",
    defaultValue: 1,
    validate: (value) => value > 0,
    hint: "Example: --page-size 1",
  });

  const outputPath =
    getStringOption(options, "out") ??
    `cases/online-${collectionUUID}.eval.yaml`;
  const platform = getStringOption(options, "xPlatform") ?? "nieta-app/web";
  const format = parseFormat(options["format"] ?? "terminal");

  const result = await extractAgentCaseFromCollection({
    baseURL,
    token,
    collectionUUID,
    platform,
    pageIndex,
    pageSize,
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  const yaml = YAML.stringify(result.evalCase);
  writeFileSync(outputPath, yaml, "utf8");

  if (format === "json") {
    process.stdout.write(
      `${JSON.stringify({
        type: "pull-online",
        output: outputPath,
        case_id: result.evalCase.id,
        preset_key: result.evalCase.input.preset_key,
        collection_uuid: result.metadata.collectionUUID,
        manuscript_uuid: result.metadata.manuscriptUUID,
        verse_uuid: result.metadata.verseUUID,
      })}\n`,
    );
  } else {
    process.stderr.write(`saved case yaml: ${outputPath}\n`);
    process.stderr.write(
      pc.dim(
        `collection=${result.metadata.collectionUUID} preset=${result.evalCase.input.preset_key}\n`,
      ),
    );
  }

  return 0;
}

export async function reportCommand(
  options: Record<string, unknown>,
): Promise<number> {
  const fromDir = getStringOption(options, "from");
  if (!fromDir) {
    throw invalidArgs(
      "--from <dir> is required",
      "Example: agent-eval report --from ./recordings/run-20240227",
    );
  }

  const outPath =
    getStringOption(options, "out") ?? join(fromDir, "run-report.html");
  const format = parseFormat(options["format"] ?? "terminal");

  // Load all result.json files from the directory
  const results: EvalResult[] = [];
  let totalDurationMs = 0;

  try {
    const files = readdirSync(fromDir);
    const resultFiles = files.filter((f) => f.endsWith(".result.json"));

    if (resultFiles.length === 0) {
      throw invalidArgs(
        `no .result.json files found in ${fromDir}`,
        "Make sure the directory contains result files from a previous run.",
      );
    }

    for (const file of resultFiles) {
      const caseId = file.replace(/\.result\.json$/, "");
      const result = await loadResult(caseId, fromDir);
      if (result) {
        results.push(result);
        totalDurationMs += result.trace.duration_ms;
      }
    }
  } catch (error) {
    if (error && typeof error === "object" && "kind" in error) {
      throw error;
    }
    throw invalidArgs(
      `failed to read from directory: ${fromDir}`,
      error instanceof Error ? error.message : String(error),
    );
  }

  if (results.length === 0) {
    throw invalidArgs(
      `no valid results loaded from ${fromDir}`,
      "Make sure the directory contains valid result files.",
    );
  }

  // Sort results by case_id for consistent ordering
  results.sort((a, b) => a.case_id.localeCompare(b.case_id));

  const passed = results.filter((r) => r.passed).length;
  const errored = results.filter((r) => r.error).length;

  const summary: EvalSummary = {
    total: results.length,
    passed,
    failed: results.length - passed - errored,
    errored,
    duration_ms: totalDurationMs,
    results,
  };

  const html = await renderRunHtmlReport(summary);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf8");

  const share = await maybeShareHtmlReport({
    enabled: options["share"] !== false,
    html,
    filename: basename(outPath),
    baseUrlOption: getStringOption(options, "shareBaseUrl"),
  });

  if (format === "terminal") {
    process.stderr.write(pc.green(`✓ HTML report generated: ${outPath}\n`));
    process.stderr.write(
      pc.dim(
        `  ${summary.total} cases, ${summary.passed} passed, ${summary.failed} failed, ${summary.errored} errored\n`,
      ),
    );

    if (share.status === "shared") {
      process.stderr.write(pc.green(`share: ${share.shareUrl}\n`));
    } else if (share.status === "failed") {
      process.stderr.write(pc.yellow(`share: ${share.reason}\n`));
    }
  } else {
    process.stdout.write(
      `${JSON.stringify({
        type: "report",
        output: outPath,
        summary: {
          total: summary.total,
          passed: summary.passed,
          failed: summary.failed,
          errored: summary.errored,
        },
        ...(share.status === "shared" ? { share_url: share.shareUrl } : {}),
        ...(share.status === "failed" ? { share_error: share.reason } : {}),
      })}\n`,
    );
  }

  return 0;
}
