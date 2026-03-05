import type { Context, Tool, Usage } from "@mariozechner/pi-ai";
import type { McpClient } from "../mcp.ts";
import type {
  CaseType,
  CommonLLMMessage,
  PlainEvalCase,
  ToolCallRecord,
} from "../../types.ts";
import type { ModelConfig } from "../../models/index.ts";
import type { SpanCollector } from "../../utils/span-collector.ts";

export type PlainRunnableCase = Omit<PlainEvalCase, "type"> & {
  type: CaseType;
};

/**
 * Configuration constants for the runner.
 */
export const RUNNER_DEFAULTS = {
  maxTurns: 20,
  mcpToolTimeoutMs: 5 * 60 * 1000,
} as const;

/**
 * Zero usage object for default values.
 */
export const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

/**
 * Context for running plain eval cases without tools.
 */
export interface RunContextWithoutTools {
  readonly model: ModelConfig;
  readonly tools: readonly Tool[];
  readonly mcpClient: null;
  readonly context: Context;
  readonly conversation: CommonLLMMessage[];
  readonly spans: SpanCollector;
  readonly startTime: number;
  readonly toolsExplicitlyDisabled: true;
}

/**
 * Context for running plain eval cases with tools.
 */
export interface RunContextWithTools {
  readonly model: ModelConfig;
  readonly tools: readonly Tool[];
  readonly mcpClient: McpClient;
  readonly context: Context;
  readonly conversation: CommonLLMMessage[];
  readonly spans: SpanCollector;
  readonly startTime: number;
  readonly toolsExplicitlyDisabled: false;
}

/**
 * Union type for run context.
 */
export type RunContext = RunContextWithoutTools | RunContextWithTools;

/**
 * Type guard for checking if context has tools.
 */
export const hasTools = (ctx: RunContext): ctx is RunContextWithTools => {
  return !ctx.toolsExplicitlyDisabled && ctx.mcpClient !== null;
};

/**
 * Result of a single turn execution.
 */
export interface TurnResult {
  assistantContent: string;
  assistantMessage: import("@mariozechner/pi-ai").AssistantMessage | null;
  toolCalls: readonly import("@mariozechner/pi-ai").ToolCall[];
  firstTokenMs: number | null;
  stopReason: "stop" | "toolUse" | "error";
  error?: string;
}

/**
 * Result of the agentic loop execution.
 */
export interface LoopResult {
  conversation: CommonLLMMessage[];
  toolsCalled: ToolCallRecord[];
  finalResponse: string | null;
  status: "success" | "error";
  error?: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

/**
 * Parameters for building an error trace.
 */
export interface ErrorTraceParams {
  evalCase: PlainRunnableCase;
  spans: SpanCollector;
  startTime: number;
  conversation: CommonLLMMessage[];
  toolsCalled: ToolCallRecord[];
  totalInputTokens: number;
  totalOutputTokens: number;
  error: string;
}

/**
 * Parameters for building a success trace.
 */
export interface SuccessTraceParams {
  evalCase: PlainRunnableCase;
  spans: SpanCollector;
  startTime: number;
  conversation: CommonLLMMessage[];
  toolsCalled: ToolCallRecord[];
  finalResponse: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
}
