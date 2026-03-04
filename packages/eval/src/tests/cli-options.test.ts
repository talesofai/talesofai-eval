import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseDiffCommandOptions,
  parseDoctorCommandOptions,
  parseInspectCommandOptions,
  parseMatrixCommandOptions,
  parsePullOnlineCommandOptions,
  parseReportCommandOptions,
  parseRunCommandOptions,
} from "../cli/options.ts";
import type { CliError } from "../errors.ts";

function assertCliError(error: unknown): asserts error is CliError {
  assert.ok(error && typeof error === "object");
  assert.ok("kind" in error);
}

describe("cli option parsers", () => {
  it("parseRunCommandOptions normalizes list/csv/number fields", () => {
    const parsed = parseRunCommandOptions({
      case: "all",
      file: "cases/a.eval.yaml",
      message: "user:hello",
      expectedTools: "make_image_v1, make_video_v1",
      forbiddenTools: "request_audio_v1",
      allowedToolNames: "make_image_v1, make_video_v1",
      tierMax: "2",
      concurrency: "3",
      judgeThreshold: "0.8",
    });

    assert.deepEqual(parsed.file, ["cases/a.eval.yaml"]);
    assert.deepEqual(parsed.message, ["user:hello"]);
    assert.deepEqual(parsed.expectedTools, ["make_image_v1", "make_video_v1"]);
    assert.deepEqual(parsed.forbiddenTools, ["request_audio_v1"]);
    assert.deepEqual(parsed.allowedToolNames, [
      "make_image_v1",
      "make_video_v1",
    ]);
    assert.equal(parsed.tierMax, 2);
    assert.equal(parsed.concurrency, 3);
    assert.equal(parsed.judgeThreshold, 0.8);
    assert.equal(parsed.format, "terminal");
    assert.equal(parsed.share, false);
    assert.equal(parsed.replayWriteMetrics, false);
  });

  it("parseRunCommandOptions rejects invalid tierMax", () => {
    assert.throws(
      () => parseRunCommandOptions({ tierMax: "4" }),
      (error) => {
        assertCliError(error);
        assert.equal(error.kind, "InvalidArgs");
        assert.match(error.message, /tier-max/);
        return true;
      },
    );
  });

  it("parseRunCommandOptions rejects replay-write-metrics without replay", () => {
    assert.throws(
      () => parseRunCommandOptions({ replayWriteMetrics: true }),
      (error) => {
        assertCliError(error);
        assert.equal(error.kind, "InvalidArgs");
        assert.match(error.message, /replay-write-metrics/);
        return true;
      },
    );
  });

  it("parseDiffCommandOptions parses base/candidate JSON overrides", () => {
    const parsed = parseDiffCommandOptions({
      base: '{"label":"base","model":"qwen-plus"}',
      candidate: '{"label":"cand","model":"qwen-max"}',
      file: "cases/a.eval.yaml",
      concurrency: "2",
    });

    assert.deepEqual(parsed.file, ["cases/a.eval.yaml"]);
    assert.equal(parsed.concurrency, 2);
    assert.equal(parsed.baseOverrides["label"], "base");
    assert.equal(parsed.candidateOverrides["label"], "cand");
  });

  it("parseDiffCommandOptions rejects missing required overrides", () => {
    assert.throws(
      () => parseDiffCommandOptions({ base: "{}" }),
      (error) => {
        assertCliError(error);
        assert.equal(error.kind, "Validation");
        return true;
      },
    );
  });

  it("parsePullOnlineCommandOptions validates page-index", () => {
    assert.throws(
      () =>
        parsePullOnlineCommandOptions({
          collectionUuid: "abc",
          pageIndex: "abc",
        }),
      (error) => {
        assertCliError(error);
        assert.equal(error.kind, "InvalidArgs");
        assert.match(error.message, /page-index/);
        return true;
      },
    );
  });

  it("parsePullOnlineCommandOptions applies defaults", () => {
    const parsed = parsePullOnlineCommandOptions({ collectionUuid: "abc" });
    assert.equal(parsed.collectionUuid, "abc");
    assert.equal(parsed.xPlatform, "nieta-app/web");
    assert.equal(parsed.pageIndex, 0);
    assert.equal(parsed.pageSize, 1);
    assert.equal(parsed.format, "terminal");
  });

  it("parseReportCommandOptions requires from", () => {
    assert.throws(
      () => parseReportCommandOptions({}),
      (error) => {
        assertCliError(error);
        assert.equal(error.kind, "InvalidArgs");
        assert.match(error.message, /--from/);
        return true;
      },
    );
  });

  it("parseMatrixCommandOptions parses JSON variants and tier max", () => {
    const parsed = parseMatrixCommandOptions({
      variant: '{"label":"v1","model":"qwen-plus"}',
      tierMax: "1",
      concurrency: "4",
    });

    assert.equal(parsed.variants.length, 1);
    assert.equal(parsed.variants[0]?.label, "v1");
    assert.equal(parsed.variants[0]?.overrides["model"], "qwen-plus");
    assert.equal(parsed.tierMax, 1);
    assert.equal(parsed.concurrency, 4);
  });

  it("parseMatrixCommandOptions parses shorthand variants as label=model", () => {
    const parsed = parseMatrixCommandOptions({
      variant: ["qwen=qwen3.5-plus", "doubao=doubao-2.0-lite"],
    });

    assert.equal(parsed.variants.length, 2);
    assert.equal(parsed.variants[0]?.label, "qwen");
    assert.equal(parsed.variants[0]?.overrides["model"], "qwen3.5-plus");
    assert.equal(parsed.variants[1]?.label, "doubao");
    assert.equal(parsed.variants[1]?.overrides["model"], "doubao-2.0-lite");
  });

  it("parseMatrixCommandOptions rejects duplicate variant labels", () => {
    assert.throws(
      () =>
        parseMatrixCommandOptions({
          variant: ['{"label":"v1","model":"a"}', '{"label":"v1","model":"b"}'],
        }),
      (error) => {
        assertCliError(error);
        assert.equal(error.kind, "Validation");
        assert.match(error.issues.join("\n"), /duplicate variant label/);
        return true;
      },
    );
  });

  it("parseMatrixCommandOptions rejects empty variant label", () => {
    assert.throws(
      () => parseMatrixCommandOptions({ variant: '{"label":""}' }),
      (error) => {
        assertCliError(error);
        assert.equal(error.kind, "Validation");
        assert.match(error.issues.join("\n"), /label/);
        return true;
      },
    );
  });

  it("parseMatrixCommandOptions rejects invalid shorthand variant", () => {
    assert.throws(
      () => parseMatrixCommandOptions({ variant: "qwen=" }),
      (error) => {
        assertCliError(error);
        assert.equal(error.kind, "Validation");
        assert.match(error.issues.join("\n"), /label>=<model>/);
        return true;
      },
    );
  });

  it("parseInspect/Doctor options provide normalized values", () => {
    const inspect = parseInspectCommandOptions({ file: "cases/a.eval.yaml" });
    assert.deepEqual(inspect.file, ["cases/a.eval.yaml"]);

    const doctor = parseDoctorCommandOptions({});
    assert.equal(doctor.format, "terminal");
    assert.equal(doctor.mode, "all");
  });
});
