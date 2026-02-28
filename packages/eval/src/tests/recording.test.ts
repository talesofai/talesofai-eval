import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  makeAutoRecordDir,
  resolveMatrixRecordDir,
  resolveRunRecordDir,
} from "../utils/recording.ts";

describe("recording path helpers", () => {
  const fixed = new Date("2026-02-26T10:22:33.456Z");

  it("makeAutoRecordDir uses stable timestamp format", () => {
    const dir = makeAutoRecordDir("run", fixed);
    assert.equal(dir, ".eval-records/run-20260226-102233-456");
  });

  it("makeAutoRecordDir supports replay report directory", () => {
    const dir = makeAutoRecordDir("replay", fixed);
    assert.equal(dir, ".eval-records/replay-20260226-102233-456");
  });

  it("resolveRunRecordDir returns explicit dir when provided", () => {
    const dir = resolveRunRecordDir({
      explicitRecordDir: "./custom-record",
      caseCount: 43,
      now: fixed,
    });
    assert.equal(dir, "./custom-record");
  });

  it("resolveRunRecordDir disables auto record in replay mode", () => {
    const dir = resolveRunRecordDir({
      replayDir: "./replay",
      caseCount: 43,
      now: fixed,
    });
    assert.equal(dir, undefined);
  });

  it("resolveRunRecordDir enables auto record for batch run", () => {
    const dir = resolveRunRecordDir({
      caseCount: 43,
      now: fixed,
    });
    assert.equal(dir, ".eval-records/run-20260226-102233-456");
  });

  it("resolveRunRecordDir keeps single-case run without auto record", () => {
    const dir = resolveRunRecordDir({
      caseCount: 1,
      now: fixed,
    });
    assert.equal(dir, undefined);
  });

  it("resolveMatrixRecordDir enables auto record for matrix batch", () => {
    const dir = resolveMatrixRecordDir({
      cellCount: 6,
      now: fixed,
    });
    assert.equal(dir, ".eval-records/matrix-20260226-102233-456");
  });

  it("resolveMatrixRecordDir keeps explicit directory", () => {
    const dir = resolveMatrixRecordDir({
      explicitRecordDir: "./matrix-rec",
      cellCount: 6,
      now: fixed,
    });
    assert.equal(dir, "./matrix-rec");
  });
});
