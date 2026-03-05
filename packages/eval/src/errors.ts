import pc from "picocolors";

// ─── Error Types ─────────────────────────────────────────────────────────────

export type CliError =
  | { kind: "UnknownCommand"; input: string; suggestions: string[] }
  | { kind: "UnknownOption"; option: string; command: string }
  | { kind: "CaseNotFound"; caseId: string; available: string[] }
  | {
      kind: "InvalidJson";
      flag: "inline" | "base" | "candidate" | "variant";
      message: string;
    }
  | {
      kind: "Validation";
      source: "inline" | "file" | "flags";
      issues: string[];
    }
  | {
      kind: "MissingConfig";
      keys: string[];
      command: "run" | "diff" | "matrix";
    }
  | {
      kind: "NoCases";
      command: "run" | "diff" | "inspect" | "matrix";
      unmatchedFilePatterns?: string[];
    }
  | { kind: "InvalidFormat"; format: string; valid: string[] }
  | { kind: "InvalidArgs"; message: string; hint: string };

export type CliErrorInfo = {
  code: string;
  message: string;
  hint: string;
  exitCode: number;
};

// ─── Error Code Mapping ──────────────────────────────────────────────────────

const ERROR_CODES: Record<CliError["kind"], string> = {
  UnknownCommand: "E_UNKNOWN_COMMAND",
  UnknownOption: "E_UNKNOWN_OPTION",
  CaseNotFound: "E_CASE_NOT_FOUND",
  InvalidJson: "E_INVALID_JSON",
  Validation: "E_VALIDATION",
  MissingConfig: "E_MISSING_CONFIG",
  NoCases: "E_NO_CASES",
  InvalidFormat: "E_INVALID_FORMAT",
  InvalidArgs: "E_INVALID_ARGS",
};

export function formatCliError(error: CliError): CliErrorInfo {
  switch (error.kind) {
    case "UnknownCommand": {
      const baseHint =
        error.suggestions.length > 0
          ? `Did you mean: ${error.suggestions.map((s) => `"${s}"`).join(", ")}?`
          : "Run `agent-eval --help` to see available commands.";
      const hint = `${baseHint}\nUse \`agent-eval ...\`; do not use \`eval run\` (shell builtin).`;
      return {
        code: ERROR_CODES.UnknownCommand,
        message: `Unknown command: "${error.input}"`,
        hint,
        exitCode: 2,
      };
    }

    case "UnknownOption": {
      const isRoot = error.command === "root";
      return {
        code: ERROR_CODES.UnknownOption,
        message: isRoot
          ? `Unknown option: "${error.option}" (no command given)`
          : `Unknown option: "${error.option}" (in command "${error.command}")`,
        hint: isRoot
          ? "Run `agent-eval --help` to see available commands."
          : `Run \`agent-eval ${error.command} --help\` to see available options.`,
        exitCode: 2,
      };
    }

    case "CaseNotFound": {
      const hint =
        error.available.length > 0
          ? `Available cases:\n  ${error.available.slice(0, 5).join("\n  ")}${error.available.length > 5 ? `\n  ... and ${error.available.length - 5} more` : ""}\nUse --case all to run all cases.`
          : "No cases registered. Use --file or --inline to define a case.";
      return {
        code: ERROR_CODES.CaseNotFound,
        message: `Case not found: "${error.caseId}"`,
        hint,
        exitCode: 2,
      };
    }

    case "InvalidJson": {
      return {
        code: ERROR_CODES.InvalidJson,
        message: `Invalid JSON for --${error.flag}: ${error.message}`,
        hint: 'Ensure the JSON is properly quoted and escaped. Example: --inline \'{"id":"test",...}\'',
        exitCode: 2,
      };
    }

    case "Validation": {
      const issuesText =
        error.issues.length === 1
          ? error.issues[0]
          : `\n  ${error.issues.join("\n  ")}`;
      return {
        code: ERROR_CODES.Validation,
        message: `Validation failed (${error.source}): ${issuesText}`,
        hint: "Fix the validation errors above and try again.",
        exitCode: 2,
      };
    }

    case "MissingConfig": {
      return {
        code: ERROR_CODES.MissingConfig,
        message: `Missing required configuration for "${error.command}": ${error.keys.join(", ")}`,
        hint: `Set the required environment variables before running \`agent-eval ${error.command}\`.`,
        exitCode: 2,
      };
    }

    case "NoCases": {
      const hasUnmatched =
        error.unmatchedFilePatterns && error.unmatchedFilePatterns.length > 0;
      const patternList = hasUnmatched
        ? error.unmatchedFilePatterns?.map((p) => `"${p}"`).join(", ")
        : null;
      const baseHint =
        "Use --case <id>, --file <path>, or --inline <json> to specify cases.";
      return {
        code: ERROR_CODES.NoCases,
        message: `No cases specified for ${error.command}`,
        hint: patternList
          ? `Pattern(s) matched no files: ${patternList}\n${baseHint}`
          : baseHint,
        exitCode: 2,
      };
    }

    case "InvalidFormat": {
      return {
        code: ERROR_CODES.InvalidFormat,
        message: `Invalid format: "${error.format}"`,
        hint: `Valid formats: ${error.valid.join(", ")}`,
        exitCode: 2,
      };
    }

    case "InvalidArgs": {
      return {
        code: ERROR_CODES.InvalidArgs,
        message: error.message,
        hint: error.hint,
        exitCode: 2,
      };
    }
  }
}

// ─── Error Output ────────────────────────────────────────────────────────────

export function printCliError(
  error: CliError,
  options?: { json?: boolean },
): void {
  const info = formatCliError(error);

  if (options?.json) {
    const output = {
      type: "error",
      code: info.code,
      message: info.message,
      hint: info.hint,
    };
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } else {
    process.stderr.write(pc.red(`error[${info.code}]: ${info.message}\n`));
    process.stderr.write(pc.dim(`hint: ${info.hint}\n`));
  }
}

export function exitWithError(
  error: CliError,
  options?: { json?: boolean },
): never {
  printCliError(error, options);
  const info = formatCliError(error);
  process.exit(info.exitCode);
}

// ─── Error Factory Functions ─────────────────────────────────────────────────

export function unknownCommand(
  input: string,
  suggestions: string[] = [],
): CliError {
  return { kind: "UnknownCommand", input, suggestions };
}

export function unknownOption(option: string, command: string): CliError {
  return { kind: "UnknownOption", option, command };
}

export function caseNotFound(caseId: string, available: string[]): CliError {
  return { kind: "CaseNotFound", caseId, available };
}

export function invalidJson(
  flag: "inline" | "base" | "candidate" | "variant",
  message: string,
): CliError {
  return { kind: "InvalidJson", flag, message };
}

export function validationError(
  source: "inline" | "file" | "flags",
  issues: string[],
): CliError {
  return { kind: "Validation", source, issues };
}

export function missingConfig(
  keys: string[],
  command: "run" | "diff" | "matrix",
): CliError {
  return { kind: "MissingConfig", keys, command };
}

export function noCases(
  command: "run" | "diff" | "inspect" | "matrix",
  unmatchedFilePatterns?: string[],
): CliError {
  return {
    kind: "NoCases",
    command,
    ...(unmatchedFilePatterns !== undefined ? { unmatchedFilePatterns } : {}),
  };
}

export function invalidFormat(format: string, valid: string[]): CliError {
  return { kind: "InvalidFormat", format, valid };
}

export function invalidArgs(message: string, hint: string): CliError {
  return { kind: "InvalidArgs", message, hint };
}

// ─── Did You Mean ────────────────────────────────────────────────────────────

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  let previous = Array.from({ length: a.length + 1 }, (_, index) => index);

  for (let i = 1; i <= b.length; i++) {
    const current: number[] = [i];

    for (let j = 1; j <= a.length; j++) {
      const substitutionBase = previous[j - 1] ?? Number.POSITIVE_INFINITY;
      const insertionBase = current[j - 1] ?? Number.POSITIVE_INFINITY;
      const deletionBase = previous[j] ?? Number.POSITIVE_INFINITY;

      if (b[i - 1] === a[j - 1]) {
        current[j] = substitutionBase;
      } else {
        current[j] = Math.min(
          substitutionBase + 1,
          insertionBase + 1,
          deletionBase + 1,
        );
      }
    }

    previous = current;
  }

  return previous[a.length] ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Find closest matching strings from candidates.
 */
export function didYouMean(
  input: string,
  candidates: string[],
  maxDistance = 2,
): string[] {
  const matches: Array<{ candidate: string; distance: number }> = [];

  for (const candidate of candidates) {
    const distance = levenshtein(input.toLowerCase(), candidate.toLowerCase());
    if (distance <= maxDistance) {
      matches.push({ candidate, distance });
    }
  }

  return matches
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((m) => m.candidate);
}
