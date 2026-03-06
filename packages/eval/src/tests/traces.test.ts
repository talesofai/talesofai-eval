import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  loadResult,
  loadTrace,
  sanitizeCaseId,
  saveResult,
  saveTrace,
} from "../traces.ts";
import type { EvalResult, EvalTrace } from "../types.ts";

function makeTrace(caseId: string): EvalTrace {
  return {
    case_id: caseId,
    case_type: "plain",
    conversation: [
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "ok" },
    ],
    tools_called: [],
    final_response: "ok",
    status: "success",
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    duration_ms: 1,
  };
}

function makeResult(caseId: string): EvalResult {
  return {
    case_id: caseId,
    case_type: "plain",
    passed: true,
    dimensions: [
      {
        dimension: "llm_judge",
        passed: true,
        score: 0.9,
        reason: "looks good",
      },
    ],
    trace: makeTrace(caseId),
  };
}

describe("traces", () => {
  it("sanitizeCaseId replaces path-unsafe characters", () => {
    assert.equal(
      sanitizeCaseId('a/b\\c:d*e?f"g<h>i|j'),
      "a__b__c__d__e__f__g__h__i__j",
    );
  });

  it("saveTrace/loadTrace round-trip", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-eval-traces-"));

    try {
      const trace = makeTrace("roundtrip-case");
      await saveTrace(trace, tempDir);
      const loaded = await loadTrace(trace.case_id, tempDir);
      assert.deepEqual(loaded, trace);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("loadTrace accepts skill case_type", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-eval-traces-skill-"));

    try {
      const trace: EvalTrace = {
        ...makeTrace("skill-case"),
        case_type: "skill",
      };
      await saveTrace(trace, tempDir);
      const loaded = await loadTrace("skill-case", tempDir);
      assert.equal(loaded.case_type, "skill");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("loadTrace accepts skill_resolution provenance", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-eval-traces-skill-resolution-"));

    try {
      const trace: EvalTrace = {
        ...makeTrace("skill-resolution-case"),
        case_type: "skill",
        skill_resolution: {
          source: "home",
          root_dir: "/home/test/.agents/skills",
          skill_name: "write-judge-prompt",
          skill_path: "/home/test/.agents/skills/write-judge-prompt/SKILL.md",
        },
      };
      await saveTrace(trace, tempDir);
      const loaded = await loadTrace("skill-resolution-case", tempDir);
      assert.equal(loaded.skill_resolution?.source, "home");
      assert.equal(
        loaded.skill_resolution?.skill_path,
        "/home/test/.agents/skills/write-judge-prompt/SKILL.md",
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("loadTrace throws when file missing", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-eval-traces-missing-"));

    try {
      await assert.rejects(
        () => loadTrace("missing-case", tempDir),
        /Trace not found/,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("saveTrace/loadTrace round-trip with error field", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-eval-traces-err-"));

    try {
      const trace: EvalTrace = {
        case_id: "err-case",
        case_type: "plain",
        conversation: [],
        tools_called: [],
        final_response: null,
        status: "error",
        usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        duration_ms: 0,
        error: "something went wrong",
      };
      await saveTrace(trace, tempDir);
      const loaded = await loadTrace("err-case", tempDir);
      assert.equal(loaded.error, "something went wrong");
      assert.equal(loaded.status, "error");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("loadTrace rejects malformed skill_resolution", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-eval-traces-bad-skill-resolution-"));

    try {
      writeFileSync(
        join(tempDir, "bad-skill-resolution.trace.json"),
        JSON.stringify({
          ...makeTrace("bad-skill-resolution"),
          case_type: "skill",
          skill_resolution: {
            source: "wrong",
            root_dir: "/home/test/.agents/skills",
            skill_name: "write-judge-prompt",
            skill_path: 123,
          },
        }),
        "utf8",
      );

      await assert.rejects(
        () => loadTrace("bad-skill-resolution", tempDir),
        /Trace has invalid shape/,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("loadTrace accepts trace without error field", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-eval-traces-noerr-"));

    try {
      const trace = makeTrace("no-error-case");
      await saveTrace(trace, tempDir);
      const loaded = await loadTrace("no-error-case", tempDir);
      assert.equal(loaded.error, undefined);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("saveResult/loadResult round-trip", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-eval-results-"));

    try {
      const result = makeResult("result-case");
      await saveResult(result, tempDir);
      const loaded = await loadResult("result-case", tempDir);
      assert.deepEqual(loaded, result);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("loadResult returns null when file missing", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "agent-eval-results-missing-"));

    try {
      const loaded = await loadResult("missing-result", tempDir);
      assert.equal(loaded, null);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
