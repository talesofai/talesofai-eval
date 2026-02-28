import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeTraceMetrics,
  parseToolOutput,
  summarizeTraceMetrics,
} from "../metrics/trace-metrics.ts";
import type { EvalResult, EvalTrace } from "../types.ts";

function makeSyntheticTrace(): EvalTrace {
  const pictureUuid = "11111111-1111-1111-1111-111111111111";
  const pictureUrl = `https://cdn.example.com/picture/${pictureUuid}.webp`;
  const videoUuid = "22222222-2222-2222-2222-222222222222";
  const videoUrl = `https://cdn.example.com/video/${videoUuid}.mp4`;

  return {
    case_id: "trace-metrics-case",
    case_type: "plain",
    conversation: [],
    tools_called: [
      {
        tool_call_id: "call-1",
        name: "make_image_v1",
        arguments: { prompt: "draw" },
        output: JSON.stringify({
          structuredContent: {
            task_status: "SUCCESS",
            err_msg: null,
            artifacts: [
              {
                uuid: pictureUuid,
                url: pictureUrl,
                modality: "PICTURE",
                status: "SUCCESS",
              },
            ],
          },
        }),
        duration_ms: 1200,
      },
      {
        tool_call_id: "call-2",
        name: "make_video_v1",
        arguments: {
          image_url: `${pictureUrl}?from=${pictureUuid}`,
          duration: 4,
        },
        output: {
          isError: true,
          structuredContent: {
            err_msg: "timeout",
          },
        },
        duration_ms: 2100,
      },
      {
        tool_call_id: "call-3",
        name: "make_video_v1",
        arguments: {
          image_url: `${pictureUrl}?from=${pictureUuid}`,
          duration: 4,
        },
        output: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                structuredContent: {
                  task_status: "SUCCESS",
                  artifacts: [
                    {
                      uuid: videoUuid,
                      url: videoUrl,
                      modality: "VIDEO",
                      status: "SUCCESS",
                    },
                  ],
                },
              }),
            },
          ],
        },
        duration_ms: 3300,
      },
    ],
    final_response: `已完成，下载地址：${videoUrl}).`,
    status: "success",
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    duration_ms: 8000,
  };
}

function makeResult(trace: EvalTrace): EvalResult {
  return {
    case_id: trace.case_id,
    case_type: trace.case_type,
    passed: true,
    dimensions: [],
    trace,
    metrics: computeTraceMetrics(trace),
  };
}

describe("trace metrics", () => {
  it("parseToolOutput supports string/object/content text shapes", () => {
    const fromString = parseToolOutput(
      JSON.stringify({
        structuredContent: {
          task_status: "SUCCESS",
          artifacts: [{ uuid: "u", url: "https://a", modality: "PICTURE" }],
        },
      }),
    );
    assert.equal(fromString.taskStatus, "SUCCESS");
    assert.equal(fromString.artifacts.length, 1);

    const fromObject = parseToolOutput({
      isError: true,
      structuredContent: { err_msg: "boom" },
    });
    assert.equal(fromObject.explicitError, true);

    const fromContentText = parseToolOutput({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            structuredContent: {
              task_status: "SUCCESS",
              artifacts: [
                {
                  uuid: "v",
                  url: "https://video",
                  modality: "VIDEO",
                },
              ],
            },
          }),
        },
      ],
    });
    assert.equal(fromContentText.taskStatus, "SUCCESS");
    assert.equal(fromContentText.artifacts[0]?.modality, "VIDEO");
  });

  it("computes tool/artifact/binding/retry/delivery metrics", () => {
    const trace = makeSyntheticTrace();
    const metrics = computeTraceMetrics(trace);

    assert.equal(metrics.tool_calls_total, 3);
    assert.equal(metrics.tool_calls_by_name["make_image_v1"], 1);
    assert.equal(metrics.tool_calls_by_name["make_video_v1"], 2);

    assert.equal(metrics.tool_error_calls_total, 1);
    assert.equal(metrics.tool_error_calls_by_name["make_video_v1"], 1);

    assert.equal(metrics.tool_retry_calls_total, 1);
    assert.equal(metrics.tool_duration_ms_total, 6600);

    assert.equal(metrics.artifacts_total, 2);
    assert.equal(metrics.artifacts_by_modality["PICTURE"], 1);
    assert.equal(metrics.artifacts_by_modality["VIDEO"], 1);
    assert.equal(metrics.artifacts_success_total, 2);

    assert.equal(metrics.bindings_total, 2);
    assert.equal(metrics.bindings_by_to_tool["make_video_v1"], 2);
    assert.equal(metrics.make_video_calls_total, 2);
    assert.equal(metrics.make_video_bound_calls_total, 2);

    assert.equal(metrics.delivery_contains_artifact_url, true);
    assert.equal(metrics.milestones.has_picture, true);
    assert.equal(metrics.milestones.has_video, true);
    assert.equal(metrics.milestones.has_picture_to_video_binding, true);
    assert.equal(metrics.milestones.delivered_any_artifact, true);
    assert.equal(metrics.milestones.progress_image_only, 1);
    assert.equal(metrics.milestones.progress_image_to_video, 1);
    assert.equal(metrics.debug, undefined);
  });

  it("summarizes milestone rates for reporting", () => {
    const traceA = makeSyntheticTrace();
    const traceB: EvalTrace = {
      ...makeSyntheticTrace(),
      case_id: "trace-b",
      tools_called: [
        {
          tool_call_id: "call-b-1",
          name: "make_image_v1",
          arguments: { prompt: "still image" },
          output: JSON.stringify({
            structuredContent: {
              task_status: "SUCCESS",
              artifacts: [
                {
                  uuid: "33333333-3333-3333-3333-333333333333",
                  url: "https://cdn.example.com/picture/33333333.webp",
                  modality: "PICTURE",
                  status: "SUCCESS",
                },
              ],
            },
          }),
          duration_ms: 1000,
        },
      ],
      final_response: "done without url",
    };

    const summary = summarizeTraceMetrics([
      makeResult(traceA),
      makeResult(traceB),
    ]);

    assert.equal(summary.avg_tool_calls_total, 2);
    assert.equal(summary.avg_tool_error_calls_total, 0.5);
    assert.equal(summary.picture_rate, 1);
    assert.equal(summary.video_rate, 0.5);
    assert.equal(summary.binding_rate, 1);
    assert.equal(summary.delivery_rate, 0.5);
    assert.equal(summary.make_video_binding_rate, 1);
    assert.equal(summary.artifacts_by_modality["PICTURE"], 2);
    assert.equal(summary.artifacts_by_modality["VIDEO"], 1);
  });
});
