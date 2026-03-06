import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import pc from "picocolors";
import YAML from "yaml";
import { resolveUpstreamBaseURL, resolveUpstreamXToken } from "../config.ts";
import { invalidArgs, noCases } from "../errors.ts";
import { extractAgentCaseFromCollection } from "../online/extract.ts";
import {
  isValidSkillName,
  loadSkillContentFromRoot,
  resolveSkillsRoot,
} from "../skills/index.ts";
import { buildSkillCaseScaffold } from "../skill-case-scaffold.ts";
import {
  renderMatrixHtmlReport,
  renderRunHtmlReport,
  renderRunHtmlReportV3,
} from "../reporter/html.ts";
import { loadResult } from "../traces.ts";
import type {
  EvalResult,
  EvalSummary,
  MatrixCell,
  MatrixSummary,
} from "../types.ts";
import { resolveCasesFromArgs } from "./case-resolution.ts";
import type {
  DoctorCommandOptions,
  DraftSkillCaseCommandOptions,
  InspectCommandOptions,
  MatrixReportCommandOptions,
  PullOnlineCommandOptions,
  ReportCommandOptions,
} from "./options.ts";
import { maybeShareHtmlReport } from "./share.ts";
import { collectDoctorChecks, type DoctorMode } from "./shared.ts";

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

export function inspectCommand(options: InspectCommandOptions): number {
  const { cases, unmatchedFilePatterns } = resolveCasesFromArgs(options);
  if (cases.length === 0) {
    throw noCases("inspect", unmatchedFilePatterns);
  }

  for (const evalCase of cases) {
    process.stdout.write(`${JSON.stringify(evalCase, null, 2)}\n`);
  }
  return 0;
}

export function doctorCommand(options: DoctorCommandOptions): number {
  const format = options.format;
  const mode: DoctorMode = options.mode;

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

export async function pullOnlineCommand(
  options: PullOnlineCommandOptions,
): Promise<number> {
  const collectionUUID = options.collectionUuid;

  const baseURL = options.baseUrl ?? resolveUpstreamBaseURL();

  if (!baseURL || baseURL.trim().length === 0) {
    throw invalidArgs(
      "missing upstream api base url",
      "Set --base-url or env EVAL_UPSTREAM_API_BASE_URL",
    );
  }

  const token = options.xToken ?? resolveUpstreamXToken();
  if (!token || token.trim().length === 0) {
    throw invalidArgs(
      "missing x-token",
      "Set --x-token or env EVAL_UPSTREAM_X_TOKEN",
    );
  }

  const pageIndex = options.pageIndex;
  const pageSize = options.pageSize;

  const outputPath = options.out ?? `cases/online-${collectionUUID}.eval.yaml`;
  const platform = options.xPlatform;
  const format = options.format;

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

function expandHomeDir(pathValue: string): string {
  if (pathValue === "~") {
    return homedir();
  }

  if (pathValue.startsWith("~/")) {
    return join(homedir(), pathValue.slice(2));
  }

  return pathValue;
}

function validateExplicitSkillsDir(skillsDir: string): string {
  const resolvedPath = resolve(expandHomeDir(skillsDir));

  if (!existsSync(resolvedPath)) {
    throw invalidArgs(
      `Skills root does not exist: ${resolvedPath}`,
      "Pass an existing directory with --skills-dir.",
    );
  }

  if (!statSync(resolvedPath).isDirectory()) {
    throw invalidArgs(
      `Skills root is not a directory: ${resolvedPath}`,
      "Pass a directory path with --skills-dir.",
    );
  }

  return resolvedPath;
}

export async function draftSkillCaseCommand(
  options: DraftSkillCaseCommandOptions,
): Promise<number> {
  if (!isValidSkillName(options.skill)) {
    throw invalidArgs(
      `Invalid skill name: "${options.skill}"`,
      "Skill names must use lowercase letters, numbers, and single hyphens only.",
    );
  }

  if (options.skillsDir !== undefined) {
    validateExplicitSkillsDir(options.skillsDir);
  }

  let resolvedRoot;
  try {
    resolvedRoot = resolveSkillsRoot({
      ...(options.skillsDir !== undefined
        ? { cliSkillsDir: options.skillsDir }
        : {}),
    });
  } catch (error) {
    throw invalidArgs(
      error instanceof Error ? error.message : String(error),
      "Check the configured skills root and try again.",
    );
  }

  let skillContent: string;
  try {
    skillContent = loadSkillContentFromRoot(resolvedRoot.rootDir, options.skill);
  } catch (error) {
    throw invalidArgs(
      error instanceof Error ? error.message : String(error),
      "Check the skill name and skills root, then try again.",
    );
  }

  const generatedCase = buildSkillCaseScaffold({
    skillName: options.skill,
    mode: options.mode,
    skillContent,
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.skillsDir !== undefined
      ? { explicitSkillsDir: options.skillsDir }
      : {}),
  });

  const yaml = YAML.stringify(generatedCase);
  const suggestedOutput = `cases/skills/${options.skill}/${options.mode}-auto.eval.yaml`;

  if (options.format === "json") {
    if (options.out) {
      mkdirSync(dirname(options.out), { recursive: true });
      writeFileSync(options.out, yaml, "utf8");
      process.stdout.write(
        `${JSON.stringify({
          type: "draft-skill-case",
          skill: options.skill,
          mode: options.mode,
          written: true,
          output: options.out,
          skills_source: resolvedRoot.source,
          skills_root: resolvedRoot.rootDir,
          case: generatedCase,
        })}\n`,
      );
      return 0;
    }

    process.stdout.write(
      `${JSON.stringify({
        type: "draft-skill-case",
        skill: options.skill,
        mode: options.mode,
        written: false,
        suggested_output: suggestedOutput,
        skills_source: resolvedRoot.source,
        skills_root: resolvedRoot.rootDir,
        case: generatedCase,
      })}\n`,
    );
    return 0;
  }

  process.stderr.write(
    pc.dim(
      `skills root: ${resolvedRoot.rootDir} (${resolvedRoot.source})\n`,
    ),
  );

  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, yaml, "utf8");
    process.stderr.write(`saved case yaml: ${options.out}\n`);
    return 0;
  }

  process.stdout.write(yaml);
  return 0;
}

export async function reportCommand(
  options: ReportCommandOptions,
): Promise<number> {
  const fromDir = options.from;

  const outPath = options.out ?? join(fromDir, "run-report.html");
  const format = options.format;

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

  const [html, htmlV3] = await Promise.all([
    renderRunHtmlReport(summary),
    renderRunHtmlReportV3(summary),
  ]);

  // Derive v3 output path: run-report.html → run-report-list.html
  const v3OutPath = outPath.replace(/\.html$/, "-list.html");

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf8");
  writeFileSync(v3OutPath, htmlV3, "utf8");

  const share = await maybeShareHtmlReport({
    enabled: options.share,
    html,
    filename: basename(outPath),
    ...(options.shareBaseUrl !== undefined
      ? { baseUrlOption: options.shareBaseUrl }
      : {}),
  });

  if (format === "terminal") {
    process.stderr.write(pc.green(`✓ HTML report generated: ${outPath}\n`));
    process.stderr.write(pc.green(`✓ HTML report (list):    ${v3OutPath}\n`));
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
        output_list: v3OutPath,
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

export async function matrixReportCommand(
  options: MatrixReportCommandOptions,
): Promise<number> {
  const fromDir = options.from;
  const outPath = options.out ?? join(fromDir, "matrix-report.html");
  const format = options.format;

  // Load matrix results from variant subdirectories
  const cells: MatrixCell[] = [];
  const variants: string[] = [];
  const caseIds: string[] = [];
  let totalDurationMs = 0;

  try {
    const entries = readdirSync(fromDir, { withFileTypes: true });
    const variantDirs = entries.filter((e) => e.isDirectory());

    if (variantDirs.length === 0) {
      throw invalidArgs(
        `no variant directories found in ${fromDir}`,
        "Make sure the directory contains subdirectories for each variant.",
      );
    }

    for (const variantDir of variantDirs) {
      const variantLabel = variantDir.name;
      variants.push(variantLabel);

      const variantPath = join(fromDir, variantLabel);
      const files = readdirSync(variantPath);
      const resultFiles = files.filter((f) => f.endsWith(".result.json"));

      for (const file of resultFiles) {
        const caseId = file.replace(/\.result\.json$/, "");
        const result = await loadResult(caseId, variantPath);

        if (result) {
          cells.push({
            case_id: caseId,
            variant_label: variantLabel,
            result,
          });
          totalDurationMs += result.trace.duration_ms;

          if (!caseIds.includes(caseId)) {
            caseIds.push(caseId);
          }
        }
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

  if (cells.length === 0) {
    throw invalidArgs(
      `no valid results loaded from ${fromDir}`,
      "Make sure the directory contains valid result files in variant subdirectories.",
    );
  }

  // Sort for consistent ordering
  variants.sort();
  caseIds.sort();

  const passed = cells.filter((c) => c.result.passed).length;
  const errored = cells.filter((c) => c.result.error).length;
  const total = cells.length;

  const summary: MatrixSummary = {
    variants,
    case_ids: caseIds,
    cells,
    total,
    passed,
    failed: total - passed - errored,
    errored,
    duration_ms: totalDurationMs,
  };

  const html = await renderMatrixHtmlReport(summary);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, "utf8");

  const share = await maybeShareHtmlReport({
    enabled: options.share,
    html,
    filename: basename(outPath),
    ...(options.shareBaseUrl !== undefined
      ? { baseUrlOption: options.shareBaseUrl }
      : {}),
  });

  if (format === "terminal") {
    process.stderr.write(
      pc.green(`✓ Matrix HTML report generated: ${outPath}\n`),
    );
    process.stderr.write(
      pc.dim(
        `  ${variants.length} variants × ${caseIds.length} cases = ${total} cells\n`,
      ),
    );
    process.stderr.write(
      pc.dim(
        `  ${summary.passed} passed, ${summary.failed} failed, ${summary.errored} errored\n`,
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
        type: "matrix-report",
        output: outPath,
        summary: {
          variants: summary.variants.length,
          cases: summary.case_ids.length,
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
