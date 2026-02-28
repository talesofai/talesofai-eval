import { join } from "node:path";

type RecordCommand = "run" | "matrix" | "replay";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

function formatTimestamp(now: Date): string {
  const yyyy = now.getFullYear();
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const min = pad2(now.getMinutes());
  const sec = pad2(now.getSeconds());
  const ms = pad3(now.getMilliseconds());
  return `${yyyy}${mm}${dd}-${hh}${min}${sec}-${ms}`;
}

export function makeAutoRecordDir(
  command: RecordCommand,
  now = new Date(),
): string {
  return join(".eval-records", `${command}-${formatTimestamp(now)}`);
}

export function resolveRunRecordDir(options: {
  explicitRecordDir?: string;
  replayDir?: string;
  caseCount: number;
  now?: Date;
}): string | undefined {
  if (options.explicitRecordDir) {
    return options.explicitRecordDir;
  }

  if (options.replayDir) {
    return undefined;
  }

  if (options.caseCount <= 1) {
    return undefined;
  }

  return makeAutoRecordDir("run", options.now);
}

export function resolveMatrixRecordDir(options: {
  explicitRecordDir?: string;
  cellCount: number;
  now?: Date;
}): string | undefined {
  if (options.explicitRecordDir) {
    return options.explicitRecordDir;
  }

  if (options.cellCount <= 1) {
    return undefined;
  }

  return makeAutoRecordDir("matrix", options.now);
}
