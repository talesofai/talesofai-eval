import { z } from "zod3";
import { type AgentEvalCase, DEFAULT_AGENT_PRESET_KEY } from "../types.ts";
import { isRecord } from "../utils/type-guards.ts";

const feedModuleSchema = z
  .object({
    json_data: z
      .object({
        cta_info: z
          .object({
            launch_prompt: z
              .object({
                core_input: z.string().optional(),
              })
              .optional(),
            interactive_config: z
              .object({
                manuscript_uuid: z.string().optional(),
                verse_uuid: z.string().optional(),
              })
              .optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .passthrough();

const feedResponseSchema = z
  .object({
    module_list: z.array(feedModuleSchema).default([]),
  })
  .passthrough();

const presetResponseSchema = z
  .object({
    uuid: z.string(),
    name: z.string().optional(),
    toolset_keys: z.array(z.string()).optional(),
    preset_description: z.string().optional(),
    reference_planning: z.string().optional(),
    reference_content: z.string().optional(),
    preset_content_schema: z.string().optional(),
  })
  .passthrough();

type FeedExtraction = {
  coreInput: string;
  manuscriptUUID?: string;
  verseUUID: string;
};

type PresetPayload = z.infer<typeof presetResponseSchema>;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type ExtractOnlineCaseOptions = {
  baseURL: string;
  token: string;
  collectionUUID: string;
  platform?: string;
  pageIndex?: number;
  pageSize?: number;
  fetchFn?: FetchLike;
};

export type ExtractOnlineCaseResult = {
  evalCase: AgentEvalCase;
  metadata: {
    collectionUUID: string;
    manuscriptUUID?: string;
    verseUUID: string;
  };
};

function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload === "string") {
    return payload;
  }

  if (!isRecord(payload)) {
    return null;
  }

  const message = payload["message"];
  if (typeof message === "string" && message.length > 0) {
    return message;
  }

  const detail = payload["detail"];
  if (typeof detail === "string" && detail.length > 0) {
    return detail;
  }

  const msg = payload["msg"];
  if (typeof msg === "string" && msg.length > 0) {
    return msg;
  }

  return null;
}

async function fetchJson(options: {
  fetchFn: FetchLike;
  url: URL;
  token: string;
  platform: string;
  context: string;
}): Promise<unknown> {
  const response = await options.fetchFn(options.url, {
    method: "GET",
    headers: {
      "x-token": options.token,
      "x-platform": options.platform,
    },
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(
        `${options.context} returned non-JSON response (status=${response.status})`,
      );
    }
  }

  if (!response.ok) {
    const reason =
      extractErrorMessage(payload) ??
      (text.length > 0 ? text : `HTTP ${response.status}`);
    throw new Error(
      `${options.context} failed (status=${response.status}): ${reason}`,
    );
  }

  return payload;
}

function extractFromFeed(payload: unknown): FeedExtraction {
  const parsed = feedResponseSchema.parse(payload);

  for (const moduleEntry of parsed.module_list) {
    const ctaInfo = moduleEntry.json_data?.cta_info;
    if (!ctaInfo) {
      continue;
    }

    const coreInput = ctaInfo.launch_prompt?.core_input;
    if (!coreInput || coreInput.trim().length === 0) {
      continue;
    }

    const verseUUID = ctaInfo.interactive_config?.verse_uuid;
    if (!verseUUID || verseUUID.trim().length === 0) {
      continue;
    }

    const manuscriptUUID = ctaInfo.interactive_config?.manuscript_uuid;
    return {
      coreInput,
      manuscriptUUID,
      verseUUID,
    };
  }

  throw new Error(
    "feed payload missing usable cta_info.launch_prompt.core_input and cta_info.interactive_config.verse_uuid",
  );
}

function mapPresetToParameters(preset: PresetPayload): Record<string, string> {
  return {
    preset_description: preset.preset_description ?? "",
    reference_planning: preset.reference_planning ?? "",
    reference_content: preset.reference_content ?? "",
    reference_content_schema: preset.preset_content_schema ?? "",
  };
}

function buildCaseId(collectionUUID: string): string {
  return `online-${collectionUUID}`;
}

const DEFAULT_ONLINE_LLM_JUDGE_PROMPT =
  "评估该回合执行质量（0-1分）。核心原则：1）结果导向：最终输出是否满足用户意图？2）工具使用合理：是否正确使用工具完成任务？不强制要求特定工具名，关注功能合理性；3）无干扰行为：未调用与任务无关的工具。评分：1.0=完美完成，0.7-0.9=基本完成有轻微冗余，0.4-0.6=部分完成有缺陷，0.1-0.3=严重偏离，0=完全失败。注意：执行计划仅供参考，工具名称可能变化，允许合理的多轮交互。";

function buildAgentCase(params: {
  collectionUUID: string;
  coreInput: string;
  preset: PresetPayload;
}): AgentEvalCase {
  const presetName = params.preset.name ? ` (${params.preset.name})` : "";

  return {
    type: "agent",
    id: buildCaseId(params.collectionUUID),
    description: `online extract from collection ${params.collectionUUID}${presetName}`,
    input: {
      preset_key: DEFAULT_AGENT_PRESET_KEY,
      parameters: mapPresetToParameters(params.preset),
      messages: [
        {
          role: "user",
          content: params.coreInput,
        },
      ],
      allowed_tool_names:
        params.preset.toolset_keys && params.preset.toolset_keys.length > 0
          ? [...params.preset.toolset_keys]
          : undefined,
      auto_followup: {
        mode: "adversarial_help_choose",
        max_turns: 1,
      },
    },
    criteria: {
      assertions: [
        {
          type: "llm_judge",
          prompt: DEFAULT_ONLINE_LLM_JUDGE_PROMPT,
          pass_threshold: 0.7,
        },
      ],
    },
  };
}

async function fetchPresetByUUID(options: {
  baseURL: string;
  token: string;
  platform: string;
  presetUUID: string;
  fetchFn: FetchLike;
}): Promise<PresetPayload> {
  const presetURL = new URL(
    `/v1/verse/preset/${options.presetUUID}`,
    options.baseURL,
  );
  const payload = await fetchJson({
    fetchFn: options.fetchFn,
    url: presetURL,
    token: options.token,
    platform: options.platform,
    context: `GET ${presetURL.pathname}`,
  });

  return presetResponseSchema.parse(payload);
}

export async function extractAgentCaseFromCollection(
  options: ExtractOnlineCaseOptions,
): Promise<ExtractOnlineCaseResult> {
  const platform = options.platform ?? "nieta-app/web";
  const fetchFn = options.fetchFn ?? fetch;
  const pageIndex = options.pageIndex ?? 0;
  const pageSize = options.pageSize ?? 1;

  const feedURL = new URL("/v1/home/feed/interactive", options.baseURL);
  feedURL.searchParams.set("page_index", String(pageIndex));
  feedURL.searchParams.set("page_size", String(pageSize));
  feedURL.searchParams.set("is_new_user", "false");
  feedURL.searchParams.set("collection_uuid", options.collectionUUID);

  const feedPayload = await fetchJson({
    fetchFn,
    url: feedURL,
    token: options.token,
    platform,
    context: `GET ${feedURL.pathname}`,
  });

  const extracted = extractFromFeed(feedPayload);
  const preset = await fetchPresetByUUID({
    baseURL: options.baseURL,
    token: options.token,
    platform,
    presetUUID: extracted.verseUUID,
    fetchFn,
  });

  return {
    evalCase: buildAgentCase({
      collectionUUID: options.collectionUUID,
      coreInput: extracted.coreInput,
      preset,
    }),
    metadata: {
      collectionUUID: options.collectionUUID,
      manuscriptUUID: extracted.manuscriptUUID,
      verseUUID: extracted.verseUUID,
    },
  };
}
