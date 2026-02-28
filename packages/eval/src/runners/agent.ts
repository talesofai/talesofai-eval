import {
  parseCommonLLMMessages,
  type CommonLLMMessage as RunnerLLMMessage,
  run,
} from "@agent-eval/agent-runner";
import { createApis, createManuscriptModel } from "@agent-eval/apis";
import type {
  AgentEvalCase,
  CommonLLMMessage,
  EvalMessage,
  EvalTrace,
  RunnerOptions,
} from "../types.ts";
import { injectAndReplaceCharacters } from "../utils/character-injector.ts";
import {
  buildAdversarialHelpChooseMessage,
  shouldInjectAdversarialHelpChooseFollowup,
} from "./auto-followup.ts";
import { createInMemoryEventsHandler } from "./events.ts";
import { extractMessageText } from "./message-utils.ts";

const REQUIRED_PARAMETER_KEYS = [
  "preset_description",
  "reference_planning",
  "reference_content",
  "reference_content_schema",
] as const;

export const validateAgentCaseParameters = (
  parameters: Record<string, string | number | boolean>,
): void => {
  const missing = REQUIRED_PARAMETER_KEYS.filter((key) => !(key in parameters));
  if (missing.length > 0) {
    throw new Error(
      `agent case parameters missing required keys: ${missing.join(", ")}`,
    );
  }

  const invalidType = REQUIRED_PARAMETER_KEYS.filter(
    (key) => typeof parameters[key] !== "string",
  );
  if (invalidType.length > 0) {
    throw new Error(
      `agent case parameters must be string (empty string allowed): ${invalidType.join(", ")}`,
    );
  }
};

const resolveOpenaiBaseURL = (): string => {
  const value = process.env["OPENAI_BASE_URL"];
  if (!value) {
    throw new Error("OPENAI_BASE_URL is required");
  }
  return value;
};

const resolveMcpUrl = (baseURL: string): string => {
  return baseURL.endsWith("/mcp") ? baseURL : `${baseURL}/mcp`;
};

const resolveOpenaiApiKey = (): string => {
  const value = process.env["OPENAI_API_KEY"];
  if (!value) {
    throw new Error("OPENAI_API_KEY is required");
  }
  return value;
};

const toCommonMessage = (message: EvalMessage): RunnerLLMMessage => {
  if (message.role === "assistant") {
    const text = extractMessageText(message.content, "assistant");
    return {
      role: "assistant",
      content: [{ type: "text", text }],
      tool_calls: message.tool_calls,
    };
  }

  if (typeof message.content === "string") {
    return {
      role: "user",
      content: [{ type: "text", text: message.content }],
    };
  }

  const content: (
    | { type: "text"; text: string }
    | {
        type: "image_url";
        image_url: { url: string };
      }
  )[] = [];

  for (const item of message.content) {
    if (item.type === "text" || item.type === "input_text") {
      content.push({
        type: "text",
        text: item.text,
      });
      continue;
    }

    if (item.type === "image_url") {
      content.push({
        type: "image_url",
        image_url: { url: item.image_url.url },
      });
      continue;
    }

    if (item.type === "input_image") {
      content.push({
        type: "image_url",
        image_url: { url: item.image },
      });
    }
  }

  return {
    role: "user",
    content,
  };
};

const toEvalMessageFromCase = (message: EvalMessage): CommonLLMMessage => {
  if (message.role === "assistant") {
    const content = extractMessageText(message.content, "assistant");
    return {
      role: "assistant",
      content: content.length > 0 ? content : null,
      tool_calls: message.tool_calls?.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.function.name,
          arguments: call.function.arguments,
        },
      })),
    };
  }

  const content = extractMessageText(message.content, "user");

  return {
    role: "user",
    content,
  };
};

const toEvalMessageFromRunner = (
  message: RunnerLLMMessage,
): CommonLLMMessage => {
  if (message.role === "assistant") {
    const content = message.content?.map((item) => item.text).join("") ?? null;
    return {
      role: "assistant",
      content,
      tool_calls: message.tool_calls?.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.function.name,
          arguments: call.function.arguments,
        },
      })),
    };
  }

  if (message.role === "user") {
    const content = message.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    return {
      role: "user",
      content,
    };
  }

  return {
    role: "tool",
    content: message.content,
    tool_call_id: message.tool_call_id,
  };
};

const createEvalManuscript = async (
  proxyURL: string,
  token: string,
): Promise<string> => {
  const response = await fetch(`${proxyURL}/v1/manuscript`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-token": token,
    },
    body: JSON.stringify({ entrance_type: "VERSE" }),
  });

  if (!response.ok) {
    throw new Error(`create manuscript failed: ${response.status}`);
  }

  const raw = await response.json();
  const uuid =
    typeof raw === "object" &&
    raw !== null &&
    "uuid" in raw &&
    typeof raw.uuid === "string"
      ? raw.uuid
      : null;
  if (!uuid) {
    throw new Error("create manuscript failed: missing uuid");
  }
  return uuid;
};

type AgentRunInputs = Parameters<typeof run>[0];
type AgentRunHistory = Parameters<typeof run>[1];

type AgentRuntime = {
  manuscriptUUID: string;
  upstreamToken: string;
  apis: ReturnType<typeof createApis>;
  manuscript: Awaited<ReturnType<typeof createManuscriptModel>>;
};

type AgentTurnResult = {
  status: EvalTrace["status"];
  finalResponse: string | null;
  conversation: RunnerLLMMessage[];
  tools: EvalTrace["tools_called"];
  usage: EvalTrace["usage"];
};

async function runSingleTurn(options: {
  evalCase: AgentEvalCase;
  runnerOptions: RunnerOptions;
  runtime: AgentRuntime;
  pendingInputs: AgentRunInputs;
  history: AgentRunHistory;
}): Promise<AgentTurnResult> {
  const events = createInMemoryEventsHandler({
    onDelta: options.runnerOptions.onDelta,
    onToolStart: options.runnerOptions.onToolStart,
    onToolCall: options.runnerOptions.onToolCall,
  });

  const context = {
    apis: options.runtime.apis,
    manuscript: options.runtime.manuscript,
    eventsHandler: events.handler,
  };

  try {
    const result = await run(options.pendingInputs, options.history, {
      mcpServerOptions: {
        name: "eval-agent-mcp",
        version: "0.0.1",
        url: resolveMcpUrl(options.runnerOptions.mcpServerBaseURL),
        headers: {
          authorization: `Bearer ${options.runtime.upstreamToken}`,
          "x-manuscript-uuid": options.runtime.manuscriptUUID,
          "x-platform": "nieta-app/web",
        },
        toolFilter: {
          allowedToolNames: options.evalCase.input.allowed_tool_names,
          needsApprovalToolNames:
            options.evalCase.input.need_approval_tool_names,
        },
      },
      openaiClientOptions: {
        baseURL: resolveOpenaiBaseURL(),
        apiKey: resolveOpenaiApiKey(),
        headers: {
          "x-token": options.runtime.upstreamToken,
        },
      },
      agentRunOptions: {
        name: "eval-agent",
        presetKey: options.evalCase.input.preset_key,
        parameters: options.evalCase.input.parameters,
        autoApprove: true,
      },
      context,
      signal: AbortSignal.timeout(60 * 60 * 1000),
      onStreamEvent: async (event) => {
        await events.handler.handleStreamEvent(event);
      },
      updateEvents: async () => {},
    });

    await events.handler.handleRunResult({
      cancelled: result.cancelled,
      error: result.error
        ? {
            type: "run_error",
            message: String(result.error),
          }
        : null,
      lastInputs: null,
    });

    const state = events.getState();
    const status = result.cancelled
      ? "cancelled"
      : result.error
        ? "failure"
        : state.status;

    return {
      status,
      finalResponse: state.final_response,
      conversation: state.conversation,
      tools: state.tools_called,
      usage: {
        input_tokens: result.state.usage.inputTokens,
        output_tokens: result.state.usage.outputTokens,
        total_tokens: result.state.usage.totalTokens,
      },
    };
  } finally {
    await events.handler.close();
  }
}

export const runAgent = async (
  evalCase: AgentEvalCase,
  opts: RunnerOptions,
): Promise<EvalTrace> => {
  validateAgentCaseParameters(evalCase.input.parameters);

  const startAt = Date.now();
  const proxyPort = opts.proxyPort ?? 19000;
  const proxyURL = `http://127.0.0.1:${proxyPort}`;

  const upstreamToken = process.env["EVAL_UPSTREAM_X_TOKEN"] ?? "eval-token";
  const manuscriptUUID = await createEvalManuscript(proxyURL, upstreamToken);

  // try/finally 包裹所有后续操作，确保 manuscript 被清理
  try {
    const apis = createApis({
      baseUrl: proxyURL,
      headers: {
        "x-token": upstreamToken,
        "x-platform": "nieta-app/web",
      },
    });
    const manuscript = await createManuscriptModel(manuscriptUUID, apis);

    // 注入随机角色到 manuscript assigns 并替换 input 中的占位符
    const injectedCase = await injectAndReplaceCharacters(
      evalCase,
      manuscriptUUID,
      apis,
      opts.logger,
    );

    const traceConversation: CommonLLMMessage[] = [
      ...injectedCase.input.messages.map(toEvalMessageFromCase),
    ];
    const traceTools: EvalTrace["tools_called"] = [];

    const usage = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };

    let finalResponse: string | null = null;
    let finalStatus: EvalTrace["status"] = "success";
    let followupTurnsUsed = 0;

    let history: RunnerLLMMessage[] = [];
    let pendingMessages: RunnerLLMMessage[] =
      injectedCase.input.messages.map(toCommonMessage);
    let pendingInputs = parseCommonLLMMessages(pendingMessages);

    const runtime: AgentRuntime = {
      manuscriptUUID,
      upstreamToken,
      apis,
      manuscript,
    };

    while (true) {
      const turn = await runSingleTurn({
        evalCase: injectedCase,
        runnerOptions: opts,
        runtime,
        pendingInputs,
        history,
      });

      traceConversation.push(...turn.conversation.map(toEvalMessageFromRunner));
      traceTools.push(...turn.tools);
      if (turn.finalResponse) {
        finalResponse = turn.finalResponse;
      }
      finalStatus = turn.status;
      usage.input_tokens += turn.usage.input_tokens;
      usage.output_tokens += turn.usage.output_tokens;
      usage.total_tokens += turn.usage.total_tokens;

      history = [...history, ...pendingMessages, ...turn.conversation];

      if (
        !shouldInjectAdversarialHelpChooseFollowup({
          evalCase: injectedCase,
          followupTurnsUsed,
          turnStatus: turn.status,
          turnFinalResponse: turn.finalResponse,
          turnToolCalls: turn.tools.length,
        })
      ) {
        break;
      }

      const followupMessage = buildAdversarialHelpChooseMessage();
      traceConversation.push(toEvalMessageFromCase(followupMessage));
      pendingMessages = [toCommonMessage(followupMessage)];
      pendingInputs = parseCommonLLMMessages(pendingMessages);
      followupTurnsUsed += 1;
    }

    return {
      case_id: injectedCase.id,
      case_type: "agent",
      conversation: traceConversation,
      tools_called: traceTools,
      final_response: finalResponse,
      status: finalStatus,
      usage,
      duration_ms: Date.now() - startAt,
    };
  } finally {
    await fetch(`${proxyURL}/v1/manuscript/${manuscriptUUID}`, {
      method: "DELETE",
      headers: {
        "x-token": upstreamToken,
      },
    });
  }
};
