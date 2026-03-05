import { resolveUpstreamXToken } from "../config.ts";
import type { EvalTrace, RunnerOptions } from "../types.ts";
import { SpanCollector } from "../utils/span-collector.ts";
import {
  buildErrorTrace,
  buildSuccessTrace,
  executeAgenticLoop,
  initializeRunContext,
  resolveModelOrThrow,
  type PlainRunnableCase,
  type RunContext,
} from "./minimal-agent/index.ts";

export const runPlain = async (
  evalCase: PlainRunnableCase,
  opts: RunnerOptions,
): Promise<EvalTrace> => {
  const modelResult = resolveModelOrThrow(evalCase.input);
  if ("error" in modelResult) {
    const spans = new SpanCollector();
    return buildErrorTrace({
      evalCase,
      spans,
      startTime: Date.now(),
      conversation: [{ role: "system", content: evalCase.input.system_prompt }],
      toolsCalled: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      error: modelResult.error,
    });
  }

  let ctx: RunContext;
  try {
    ctx = await initializeRunContext(evalCase, opts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const spans = new SpanCollector();
    return buildErrorTrace({
      evalCase,
      spans,
      startTime: Date.now(),
      conversation: [{ role: "system", content: evalCase.input.system_prompt }],
      toolsCalled: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      error: message,
    });
  }

  const { model, spans, startTime, mcpClient } = ctx;

  const xToken = resolveUpstreamXToken();
  const headers = xToken ? { "x-token": xToken } : undefined;

  let loopResult: Awaited<ReturnType<typeof executeAgenticLoop>>;
  try {
    loopResult = await executeAgenticLoop({
      ctx,
      opts,
      headers,
      model,
    });
  } finally {
    await mcpClient?.close();
  }

  if (loopResult.status === "error") {
    return buildErrorTrace({
      evalCase,
      spans,
      startTime,
      conversation: loopResult.conversation,
      toolsCalled: loopResult.toolsCalled,
      totalInputTokens: loopResult.totalInputTokens,
      totalOutputTokens: loopResult.totalOutputTokens,
      error: loopResult.error!,
    });
  }

  return buildSuccessTrace({
    evalCase,
    spans,
    startTime,
    conversation: loopResult.conversation,
    toolsCalled: loopResult.toolsCalled,
    finalResponse: loopResult.finalResponse,
    totalInputTokens: loopResult.totalInputTokens,
    totalOutputTokens: loopResult.totalOutputTokens,
  });
};
