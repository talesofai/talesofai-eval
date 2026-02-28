import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { EvalResult, EvalTrace } from "./types.ts";
import { isRecord } from "./utils/type-guards.ts";

function isCaseType(value: unknown): value is EvalTrace["case_type"] {
  return value === "plain" || value === "agent";
}

function isTraceStatus(value: unknown): value is EvalTrace["status"] {
  return (
    value === "success" ||
    value === "failure" ||
    value === "cancelled" ||
    value === "error"
  );
}

function isUsage(value: unknown): value is EvalTrace["usage"] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value["input_tokens"] === "number" &&
    typeof value["output_tokens"] === "number" &&
    typeof value["total_tokens"] === "number"
  );
}

function isAssistantToolCall(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const fn = value["function"];
  if (!isRecord(fn)) {
    return false;
  }

  return (
    typeof value["id"] === "string" &&
    value["type"] === "function" &&
    typeof fn["name"] === "string" &&
    typeof fn["arguments"] === "string"
  );
}

function isConversationMessage(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  const role = value["role"];

  if (role === "system" || role === "user") {
    return typeof value["content"] === "string";
  }

  if (role === "assistant") {
    const content = value["content"];
    if (!(typeof content === "string" || content === null)) {
      return false;
    }

    if (!("tool_calls" in value)) {
      return true;
    }

    const toolCalls = value["tool_calls"];
    return (
      Array.isArray(toolCalls) &&
      toolCalls.every((item) => isAssistantToolCall(item))
    );
  }

  if (role === "tool") {
    return (
      typeof value["content"] === "string" &&
      typeof value["tool_call_id"] === "string"
    );
  }

  return false;
}

function isToolCallRecord(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    (value["tool_call_id"] === undefined ||
      typeof value["tool_call_id"] === "string") &&
    typeof value["name"] === "string" &&
    isRecord(value["arguments"]) &&
    typeof value["duration_ms"] === "number"
  );
}

function isDimensionKind(
  value: unknown,
): value is "tool_usage" | "final_status" | "llm_judge" {
  return (
    value === "tool_usage" || value === "final_status" || value === "llm_judge"
  );
}

function isDimensionResult(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isDimensionKind(value["dimension"]) &&
    typeof value["passed"] === "boolean" &&
    typeof value["score"] === "number" &&
    typeof value["reason"] === "string"
  );
}

function isEvalTrace(value: unknown): value is EvalTrace {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !(
      typeof value["case_id"] === "string" &&
      isCaseType(value["case_type"]) &&
      Array.isArray(value["conversation"]) &&
      value["conversation"].every((item) => isConversationMessage(item)) &&
      Array.isArray(value["tools_called"]) &&
      value["tools_called"].every((item) => isToolCallRecord(item)) &&
      (typeof value["final_response"] === "string" ||
        value["final_response"] === null) &&
      isTraceStatus(value["status"]) &&
      isUsage(value["usage"]) &&
      typeof value["duration_ms"] === "number"
    )
  ) {
    return false;
  }

  // error is optional; if present it must be a string
  if ("error" in value && typeof value["error"] !== "string") {
    return false;
  }

  return true;
}

function isEvalResult(value: unknown): value is EvalResult {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !(
      typeof value["case_id"] === "string" &&
      isCaseType(value["case_type"]) &&
      typeof value["passed"] === "boolean" &&
      Array.isArray(value["dimensions"]) &&
      value["dimensions"].every((item) => isDimensionResult(item)) &&
      isEvalTrace(value["trace"])
    )
  ) {
    return false;
  }

  if ("error" in value && typeof value["error"] !== "string") {
    return false;
  }

  return true;
}

export const sanitizeCaseId = (id: string): string =>
  id.replace(/[/\\:*?"<>|]/g, "__");

const getTracePath = (caseId: string, dir: string): string =>
  join(dir, `${sanitizeCaseId(caseId)}.trace.json`);

const getResultPath = (caseId: string, dir: string): string =>
  join(dir, `${sanitizeCaseId(caseId)}.result.json`);

export const saveTrace = async (
  trace: EvalTrace,
  dir: string,
): Promise<void> => {
  await mkdir(dir, { recursive: true });
  const path = getTracePath(trace.case_id, dir);
  await writeFile(path, JSON.stringify(trace, null, 2));
};

export const loadTrace = async (
  caseId: string,
  dir: string,
): Promise<EvalTrace> => {
  const path = getTracePath(caseId, dir);
  const raw = await readFile(path, "utf8").catch(() => {
    throw new Error(`Trace not found: ${path} — run without --replay first`);
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Trace is not valid JSON: ${path}`);
  }

  if (!isEvalTrace(parsed)) {
    throw new Error(`Trace has invalid shape: ${path}`);
  }

  if (parsed.case_id !== caseId) {
    throw new Error(
      `Trace case_id mismatch: expected "${caseId}", got "${parsed.case_id}" (${path})`,
    );
  }

  return parsed;
};

export const saveResult = async (
  result: EvalResult,
  dir: string,
): Promise<void> => {
  await mkdir(dir, { recursive: true });
  const path = getResultPath(result.case_id, dir);
  await writeFile(path, JSON.stringify(result, null, 2));
};

export const loadResult = async (
  caseId: string,
  dir: string,
): Promise<EvalResult | null> => {
  const path = getResultPath(caseId, dir);

  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isRecord(error) && error["code"] === "ENOENT") {
      return null;
    }
    throw error;
  });

  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isEvalResult(parsed)) {
    return null;
  }

  if (parsed.case_id !== caseId) {
    return null;
  }

  return parsed;
};
