import { ZodError } from "zod3";
import { type CliError, invalidFormat, validationError } from "../errors.ts";

export { isRecord } from "../utils/type-guards.ts";

export type CommandName =
  | "run"
  | "diff"
  | "list"
  | "inspect"
  | "doctor"
  | "pull-online"
  | "matrix"
  | "report";

export type OutputFormat = "terminal" | "json";

const FORMATS: OutputFormat[] = ["terminal", "json"];

export const COMMANDS: CommandName[] = [
  "run",
  "diff",
  "list",
  "inspect",
  "doctor",
  "pull-online",
  "matrix",
  "report",
];

export function isCommandName(value: string): value is CommandName {
  return COMMANDS.some((command) => command === value);
}

export function parseFormat(raw: unknown): OutputFormat {
  if (raw === "terminal" || raw === "json") {
    return raw;
  }
  throw invalidFormat(String(raw ?? ""), [...FORMATS]);
}

export function getStringOption(
  options: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

export function getStringArrayOption(
  options: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = options[key];
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  return undefined;
}

export function getNumberOption(
  options: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = options[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function isCliError(error: unknown): error is CliError {
  if (!error || typeof error !== "object") {
    return false;
  }
  if (!("kind" in error)) {
    return false;
  }
  return typeof error.kind === "string";
}

export function formatZodIssues(error: ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "<root>" : issue.path.join(".");
    return `${path}: ${issue.message}`;
  });
}

export function mapUnknownError(error: unknown): CliError {
  if (isCliError(error)) {
    return error;
  }

  if (error instanceof ZodError) {
    return validationError("file", formatZodIssues(error));
  }

  if (error instanceof Error) {
    return validationError("flags", [error.message]);
  }

  return validationError("flags", [String(error)]);
}

export function parseUnknownOption(error: Error): string | null {
  const match = /Unknown option `([^`]+)`/.exec(error.message);
  if (!match) {
    return null;
  }
  return match[1] ?? null;
}

export function pickCommandFromArgv(argv: string[]): string | null {
  const args = argv.slice(2);
  for (const arg of args) {
    if (arg === "--") {
      break;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return arg;
  }
  return null;
}
