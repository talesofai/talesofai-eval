import { registerCase } from "../loader/registry.ts";
import {
  DEFAULT_AGENT_PRESET_KEY,
  DEFAULT_ALLOWED_TOOL_NAMES,
} from "../types.ts";

registerCase({
  type: "agent",
  id: "agent-make-image-basic",
  description: "基础图片生成",
  input: {
    preset_key: DEFAULT_AGENT_PRESET_KEY,
    parameters: {
      style: "realistic",
      preset_description: "",
      reference_planning: "",
      reference_content: "",
      reference_content_schema: "",
    },
    messages: [
      {
        role: "user",
        content: "帮我生成一张猫咪的图片",
      },
    ],
    allowed_tool_names: [...DEFAULT_ALLOWED_TOOL_NAMES],
  },
  criteria: {
    assertions: [
      {
        type: "tool_usage",
        expected_tools: ["make_image_v1"],
      },
      {
        type: "llm_judge",
        prompt:
          "agent 应调用 make_image 并在完成后返回一条友好的确认消息，不应跳过工具直接回复",
        pass_threshold: 0.7,
      },
    ],
  },
});

registerCase({
  type: "plain",
  id: "system-prompt-tone",
  description: "语气风格测试",
  input: {
    system_prompt: "你是一个友好的创作助手，用轻松活泼的语气回复。",
    model: "qwen-plus",
    messages: [
      {
        role: "user",
        content: "帮我想个故事开头",
      },
    ],
    // Explicitly disable tools: this is a pure language-style test that does
    // not need any MCP tools. Without this, the runner fetches all tools from
    // the MCP server and the LLM may attempt a tool call that requires
    // preset_key, causing a backend validation error.
    allowed_tool_names: [],
  },
  criteria: {
    assertions: [
      {
        type: "llm_judge",
        prompt: "回复语气应轻松活泼，不应正式死板",
        pass_threshold: 0.7,
      },
    ],
  },
});

export { registerCase };
