#!/usr/bin/env node

import { type CAC, cac } from "cac";
import "../cases/index.ts";
import { didYouMean, printCliError, unknownCommand } from "../errors.ts";
import { loadModels } from "../models/index.ts";
import {
  doctorCommand,
  inspectCommand,
  listCommand,
  matrixReportCommand,
  pullOnlineCommand,
  reportCommand,
} from "./aux-commands.ts";
import { diffCommand } from "./diff-command.ts";
import { autoLoadEnvFiles } from "./env-loader.ts";
import {
  COMMANDS,
  isCommandName,
  mapUnknownError,
  parseUnknownOption,
  pickCommandFromArgv,
} from "./helpers.ts";
import { matrixCommand } from "./matrix-command.ts";
import {
  parseDiffCommandOptions,
  parseDoctorCommandOptions,
  parseInspectCommandOptions,
  parseMatrixCommandOptions,
  parseMatrixReportCommandOptions,
  parsePullOnlineCommandOptions,
  parseReportCommandOptions,
  parseRunCommandOptions,
} from "./options.ts";
import { runCommand } from "./run-command.ts";
import { shouldUseJsonErrors } from "./shared.ts";

function buildCli(setPending: (promise: Promise<number>) => void): CAC {
  const cli = cac("agent-eval");

  cli
    .command("run", "Run eval cases")
    .option("--case <id>", "Case id or 'all'")
    .option("--file <paths>", "YAML/JSON file paths (glob supported)")
    .option("--inline <json>", "Inline JSON case definition")
    .option("--type <type>", "Filter by case type (plain/agent)")
    .option("--system-prompt <prompt>", "System prompt (inline plain case)")
    .option("--model <model>", "Model name (inline plain case)")
    .option("--preset-key <key>", "Preset key (inline agent case)")
    .option("--message <msg>", "Message in role:content format (repeatable)")
    .option("--expected-tools <tools>", "Expected tool names (comma-separated)")
    .option(
      "--forbidden-tools <tools>",
      "Forbidden tool names (comma-separated)",
    )
    .option("--expected-status <status>", "Expected status")
    .option("--judge-prompt <prompt>", "LLM judge prompt")
    .option("--judge-threshold <n>", "LLM judge pass threshold")
    .option(
      "--allowed-tool-names <tools>",
      "Allowed tool names (comma-separated)",
    )
    .option("--format <fmt>", "Output format: terminal or json", {
      default: "terminal",
    })
    .option("--share", "Auto-upload HTML report and print share link", {
      default: true,
    })
    .option(
      "--share-base-url <url>",
      "Share service base URL (fallback: EVAL_SHARE_BASE_URL)",
    )
    .option(
      "--record <dir>",
      "Save each case trace to <dir>/<case-id>.trace.json (auto-enabled for batch run when omitted)",
    )
    .option(
      "--replay <dir>",
      "Load traces from <dir>/<case-id>.trace.json (and use <case-id>.result.json cache when available)",
    )
    .option(
      "--replay-write-metrics",
      "When replay cache has result files without metrics, backfill metrics and write result.json (best-effort)",
    )
    .option("--verbose", "Include full conversation in output")
    .option(
      "--tier-max <n>",
      "Maximum assertion tier to evaluate: 1 (rule-based), 2 (default, +LLM judge), 3 (+human review)",
    )
    .option(
      "--concurrency <n>",
      "Number of concurrent executions (default: min(total cases, 8))",
    )
    .action((options: Record<string, unknown>) => {
      setPending(runCommand(parseRunCommandOptions(options)));
    });

  cli
    .command("diff", "Compare two configurations")
    .option("--case <id>", "Case id or 'all'")
    .option("--file <paths>", "YAML/JSON file paths")
    .option("--base <json>", "Base config overrides (JSON)")
    .option("--candidate <json>", "Candidate config overrides (JSON)")
    .option("--type <type>", "Filter by case type")
    .option("--format <fmt>", "Output format: terminal or json", {
      default: "terminal",
    })
    .option("--verbose", "Include full conversation")
    .option(
      "--concurrency <n>",
      "Number of concurrent executions (default: min(total cases, 8))",
    )
    .action((options: Record<string, unknown>) => {
      setPending(diffCommand(parseDiffCommandOptions(options)));
    });

  cli.command("list", "List built-in cases").action(() => {
    setPending(Promise.resolve(listCommand()));
  });

  cli
    .command("inspect", "Show case definition without running")
    .option("--case <id>", "Case id")
    .option("--file <path>", "YAML/JSON file path")
    .action((options: Record<string, unknown>) => {
      setPending(
        Promise.resolve(inspectCommand(parseInspectCommandOptions(options))),
      );
    });

  cli
    .command("doctor", "Check local config and suggest fixes")
    .option("--format <fmt>", "Output format: terminal or json", {
      default: "terminal",
    })
    .option("--mode <mode>", "Check scope: plain, agent, or all", {
      default: "all",
    })
    .action((options: Record<string, unknown>) => {
      setPending(
        Promise.resolve(doctorCommand(parseDoctorCommandOptions(options))),
      );
    });

  cli
    .command(
      "pull-online",
      "Pull online collection and generate agent case yaml",
    )
    .option("--collection-uuid <uuid>", "Collection UUID")
    .option("--base-url <url>", "Upstream API base URL")
    .option("--x-token <token>", "Upstream x-token")
    .option("--x-platform <platform>", "x-platform header", {
      default: "nieta-app/web",
    })
    .option("--page-index <n>", "Feed page index", {
      default: "0",
    })
    .option("--page-size <n>", "Feed page size", {
      default: "1",
    })
    .option("--out <path>", "Output yaml path")
    .option("--format <fmt>", "Output format: terminal or json", {
      default: "terminal",
    })
    .action((options: Record<string, unknown>) => {
      setPending(pullOnlineCommand(parsePullOnlineCommandOptions(options)));
    });

  cli
    .command("matrix", "Run cases × variants matrix evaluation")
    .option("--case <id>", "Case id or 'all'")
    .option("--file <paths>", "YAML/JSON file paths (glob supported)")
    .option("--inline <json>", "Inline JSON case definition")
    .option("--type <type>", "Filter by case type (plain/agent)")
    .option(
      "--variant <json>",
      'Variant config (repeatable): shorthand <label>=<model> or JSON with required "label" field',
    )
    .option(
      "--concurrency <n>",
      "Max parallel cells (default: min(total cells, 8))",
    )
    .option(
      "--record <dir>",
      "Save traces to <dir>/<variantLabel>/<caseId>.trace.json (auto-enabled for matrix batch when omitted)",
    )
    .option("--format <fmt>", "Output format: terminal or json", {
      default: "terminal",
    })
    .option(
      "--tier-max <n>",
      "Maximum assertion tier to evaluate: 1 (rule-based), 2 (default, +LLM judge), 3 (+human review)",
    )
    .action((options: Record<string, unknown>) => {
      setPending(matrixCommand(parseMatrixCommandOptions(options)));
    });

  cli
    .command("report", "Generate HTML report from existing result files")
    .option(
      "--from <dir>",
      "Directory containing .result.json files (required)",
    )
    .option(
      "--out <path>",
      "Output HTML file path (default: <from>/run-report.html)",
    )
    .option("--share", "Auto-upload HTML report and print share link", {
      default: true,
    })
    .option(
      "--share-base-url <url>",
      "Share service base URL (fallback: EVAL_SHARE_BASE_URL)",
    )
    .option("--format <fmt>", "Output format: terminal or json", {
      default: "terminal",
    })
    .action((options: Record<string, unknown>) => {
      setPending(reportCommand(parseReportCommandOptions(options)));
    });

  cli
    .command("matrix-report", "Generate HTML report from matrix result files")
    .option(
      "--from <dir>",
      "Directory containing variant subdirectories with .result.json files (required)",
    )
    .option(
      "--out <path>",
      "Output HTML file path (default: <from>/matrix-report.html)",
    )
    .option("--share", "Auto-upload HTML report and print share link", {
      default: true,
    })
    .option(
      "--share-base-url <url>",
      "Share service base URL (fallback: EVAL_SHARE_BASE_URL)",
    )
    .option("--format <fmt>", "Output format: terminal or json", {
      default: "terminal",
    })
    .action((options: Record<string, unknown>) => {
      setPending(matrixReportCommand(parseMatrixReportCommandOptions(options)));
    });

  cli.help();
  return cli;
}

function installFatalSafetyNet(jsonMode: boolean): void {
  const fatal = (error: unknown): void => {
    const cliError = mapUnknownError(error);
    printCliError(cliError, { json: jsonMode });
    process.exit(2);
  };

  process.on("unhandledRejection", (reason) => {
    fatal(reason);
  });

  process.on("uncaughtException", (error) => {
    fatal(error);
  });
}

async function main(argv: string[]): Promise<number> {
  autoLoadEnvFiles();

  // Load model registry at startup
  try {
    await loadModels();
  } catch {
    // Ignore errors - will be reported when resolveModel is called
  }

  const jsonMode = shouldUseJsonErrors(argv);
  installFatalSafetyNet(jsonMode);

  const inputCommand = pickCommandFromArgv(argv);
  if (inputCommand && !isCommandName(inputCommand)) {
    const suggestions = didYouMean(inputCommand, [...COMMANDS], 2);
    const error = unknownCommand(inputCommand, suggestions);
    printCliError(error, { json: jsonMode });
    return 2;
  }

  let pending: Promise<number> | null = null;
  let pendingError: unknown = null;

  const setPending = (promise: Promise<number>): void => {
    pending = promise.catch((error) => {
      pendingError = error;
      return 2;
    });
  };

  const cli = buildCli(setPending);

  try {
    cli.parse(argv);

    if (!pending) {
      if (argv.length <= 2) {
        cli.outputHelp();
        return 0;
      }

      const helpFlags = new Set(["--help", "-h"]);
      const firstUnknownFlag = argv
        .slice(2)
        .find((a) => a.startsWith("-") && a !== "--" && !helpFlags.has(a));
      if (firstUnknownFlag) {
        const optName = firstUnknownFlag.replace(/^-+/, "");
        printCliError(
          { kind: "UnknownOption", option: optName, command: "root" },
          { json: jsonMode },
        );
        return 2;
      }
      return 0;
    }

    const code = await pending;
    if (pendingError) {
      throw pendingError;
    }

    return code;
  } catch (error) {
    if (error instanceof Error) {
      const unknownOptionValue = parseUnknownOption(error);
      if (unknownOptionValue) {
        const command =
          inputCommand && isCommandName(inputCommand) ? inputCommand : "run";
        printCliError(
          {
            kind: "UnknownOption",
            option: unknownOptionValue,
            command,
          },
          { json: jsonMode },
        );
        return 2;
      }
    }

    const cliError = mapUnknownError(error);
    printCliError(cliError, { json: jsonMode });
    return 2;
  }
}

const exitCode = await main(process.argv);
process.exit(exitCode);
