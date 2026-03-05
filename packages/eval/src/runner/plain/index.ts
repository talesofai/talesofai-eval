import { resolveUpstreamXToken } from "../../config.ts";
import type { EvalTrace, RunnerOptions } from "../../types.ts";
import { SpanCollector } from "../../utils/span-collector.ts";
import { type PlainRunnableCase, type RunContext } from "./types.ts";
import { initializeRunContext, resolveModelOrThrow } from "./context.ts";
import { buildErrorTrace, buildSuccessTrace } from "./trace-builder.ts";
import { executeAgenticLoop } from "./agentic-loop.ts";

/**
 * Run a plain eval case.
 * 
 * This function orchestrates the evaluation of a plain (non-agentic) test case.
 * It handles:
 * 1. Model resolution and validation
 * 2. MCP client connection and tool loading
 * 3. Context building with system prompt and messages
 * 4. Agentic loop execution with tool calls
 * 5. Trace building for success or error cases
 */
export const runPlain = async (
  evalCase: PlainRunnableCase,
  opts: RunnerOptions,
): Promise<EvalTrace> => {
  // Quick model resolution check before initializing context
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

  // Initialize context (includes MCP connection and tool loading)
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

  // Resolve x-token header
  const xToken = resolveUpstreamXToken();
  const headers = xToken ? { "x-token": xToken } : undefined;

  // Execute the agentic loop
  const loopResult = await executeAgenticLoop({
    ctx,
    opts,
    headers,
    model,
  });

  // Close MCP client if connected
  await mcpClient?.close();

  // Build and return trace
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

// Re-export types for external use
export type { PlainRunnableCase, RunContext } from "./types.ts";
