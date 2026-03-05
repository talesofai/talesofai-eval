import { resolveUpstreamXToken } from "../config.ts";
import {
  formatSkillsForPrompt,
  listSkills,
  loadSkillContent,
  type SkillMeta,
} from "../skills/index.ts";
import type { EvalTrace, RunnerOptions, SkillEvalCase } from "../types.ts";
import { SpanCollector } from "../utils/span-collector.ts";
import { readSkillTool } from "./builtin-tools/index.ts";
import {
  buildErrorTrace,
  buildSuccessTrace,
  executeAgenticLoop,
  initializeRunContext,
  resolveModelOrThrow,
  type PlainRunnableCase,
  type RunContext,
} from "./minimal-agent/index.ts";

export function buildInjectSystemPrompt(
  skillContent: string,
  systemPromptPrefix?: string,
): string {
  const prefix = systemPromptPrefix?.trim();
  return [prefix, skillContent].filter(Boolean).join("\n\n");
}

export function buildDiscoverSystemPrompt(
  skills: SkillMeta[],
  systemPromptPrefix?: string,
): string {
  const prefix = systemPromptPrefix?.trim();
  const availableSkills = formatSkillsForPrompt(skills);

  const instruction = [
    "You have access to optional skills listed below.",
    "Load skill content only when needed by calling read_skill with {\"skill_name\": \"<skill-name>\"}.",
    "Do not assume skill details before loading them.",
  ].join("\n");

  return [prefix, availableSkills, instruction].filter(Boolean).join("\n\n");
}

export function buildUserPrompt(
  task: string,
  fixtures?: Record<string, unknown>,
): string {
  if (fixtures === undefined) {
    return task;
  }

  return `${task}\n\nFixtures:\n${JSON.stringify(fixtures, null, 2)}`;
}

export const runSkill = async (
  evalCase: SkillEvalCase,
  opts: RunnerOptions,
): Promise<EvalTrace> => {
  const mode = evalCase.input.evaluation_mode ?? "inject";

  const systemPrompt =
    mode === "inject"
      ? buildInjectSystemPrompt(
          loadSkillContent(evalCase.input.skill),
          evalCase.input.system_prompt_prefix,
        )
      : buildDiscoverSystemPrompt(
          listSkills(),
          evalCase.input.system_prompt_prefix,
        );

  const runnableCase: PlainRunnableCase = {
    type: "skill",
    id: evalCase.id,
    description: evalCase.description,
    input: {
      system_prompt: systemPrompt,
      model: evalCase.input.model,
      messages: [
        {
          role: "user",
          content: buildUserPrompt(evalCase.input.task, evalCase.input.fixtures),
        },
      ],
      allowed_tool_names: [],
    },
    criteria: evalCase.criteria,
  };

  const modelResult = resolveModelOrThrow(runnableCase.input);
  if ("error" in modelResult) {
    const spans = new SpanCollector();
    return buildErrorTrace({
      evalCase: runnableCase,
      spans,
      startTime: Date.now(),
      conversation: [{ role: "system", content: runnableCase.input.system_prompt }],
      toolsCalled: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      error: modelResult.error,
    });
  }

  let ctx: RunContext;
  try {
    ctx = await initializeRunContext(
      runnableCase,
      opts,
      mode === "discover" ? { builtinTools: [readSkillTool] } : undefined,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const spans = new SpanCollector();
    return buildErrorTrace({
      evalCase: runnableCase,
      spans,
      startTime: Date.now(),
      conversation: [{ role: "system", content: runnableCase.input.system_prompt }],
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
      evalCase: runnableCase,
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
    evalCase: runnableCase,
    spans,
    startTime,
    conversation: loopResult.conversation,
    toolsCalled: loopResult.toolsCalled,
    finalResponse: loopResult.finalResponse,
    totalInputTokens: loopResult.totalInputTokens,
    totalOutputTokens: loopResult.totalOutputTokens,
  });
};
