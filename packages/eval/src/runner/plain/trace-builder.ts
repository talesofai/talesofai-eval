import type { EvalTrace } from "../../types.ts";
import type {
  ErrorTraceParams,
  SuccessTraceParams,
} from "./types.ts";

/**
 * Build an error EvalTrace.
 */
export function buildErrorTrace(params: ErrorTraceParams): EvalTrace {
  const {
    evalCase,
    spans,
    startTime,
    conversation,
    toolsCalled,
    totalInputTokens,
    totalOutputTokens,
    error,
  } = params;

  return {
    case_id: evalCase.id,
    case_type: evalCase.type,
    conversation,
    tools_called: toolsCalled,
    final_response: null,
    status: "error",
    error,
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
    },
    duration_ms: Date.now() - startTime,
    spans: spans.getSpans(),
  };
}

/**
 * Build a success EvalTrace.
 */
export function buildSuccessTrace(params: SuccessTraceParams): EvalTrace {
  const {
    evalCase,
    spans,
    startTime,
    conversation,
    toolsCalled,
    finalResponse,
    totalInputTokens,
    totalOutputTokens,
  } = params;

  return {
    case_id: evalCase.id,
    case_type: evalCase.type,
    conversation,
    tools_called: toolsCalled,
    final_response: finalResponse,
    status: "success",
    usage: {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
    },
    duration_ms: Date.now() - startTime,
    spans: spans.getSpans(),
  };
}
