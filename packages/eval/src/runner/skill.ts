import { resolveUpstreamXToken } from "../config.ts";
import {
  formatSkillsForPrompt,
  isValidSkillName,
  listSkillsFromRoot,
  loadSkillContentFromRoot,
  resolveSkillsRoot,
  type ResolvedSkillsRoot,
  type SkillMeta,
} from "../skills/index.ts";
import type {
  EvalTrace,
  RunnerOptions,
  SkillEvalCase,
  SkillResolutionTrace,
} from "../types.ts";
import { join } from "node:path";
import { SpanCollector } from "../utils/span-collector.ts";
import {
  createBashTool,
  createListDirTool,
  createReadFileTool,
} from "./builtin-tools/index.ts";
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
    "Use ls to explore the skills directory and read to load files by relative path from that root.",
    'For example, first ls a skill directory, then read files like "write-judge-prompt/SKILL.md".',
    "Do not assume skill details before loading them.",
    "Once you have loaded a skill, use bash to execute any commands it instructs you to run.",
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

function buildRunnableCase(
  evalCase: SkillEvalCase,
  systemPrompt: string,
): PlainRunnableCase {
  // Fall back to EVAL_JUDGE_MODEL when model is not specified in the case
  const model = evalCase.input.model ?? process.env["EVAL_JUDGE_MODEL"] ?? "";
  return {
    type: "skill",
    id: evalCase.id,
    description: evalCase.description,
    input: {
      system_prompt: systemPrompt,
      model,
      messages: [
        {
          role: "user",
          content: buildUserPrompt(evalCase.input.task, evalCase.input.fixtures),
        },
      ],
      // undefined = allow all MCP tools; [] = disable MCP; [...] = restrict to list
      ...(evalCase.input.allowed_tool_names !== undefined
        ? { allowed_tool_names: evalCase.input.allowed_tool_names }
        : {}),
    },
    criteria: evalCase.criteria,
  };
}

function buildSkillResolution(
  resolvedRoot: ResolvedSkillsRoot,
  skillName: string,
  skillContent?: string,
): SkillResolutionTrace {
  return {
    source: resolvedRoot.source,
    root_dir: resolvedRoot.rootDir,
    skill_name: skillName,
    skill_path: join(resolvedRoot.rootDir, skillName, "SKILL.md"),
    ...(skillContent !== undefined ? { skill_content: skillContent } : {}),
  };
}

function buildSkillErrorTrace(options: {
  evalCase: SkillEvalCase;
  error: string;
  runnableCase?: PlainRunnableCase;
  skillResolution?: SkillResolutionTrace;
}): EvalTrace {
  const spans = new SpanCollector();
  const runnableCase =
    options.runnableCase ?? buildRunnableCase(options.evalCase, "");

  const trace = buildErrorTrace({
    evalCase: runnableCase,
    spans,
    startTime: Date.now(),
    conversation: runnableCase.input.system_prompt
      ? [{ role: "system", content: runnableCase.input.system_prompt }]
      : [],
    toolsCalled: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    error: options.error,
  });

  return options.skillResolution
    ? { ...trace, skill_resolution: options.skillResolution }
    : trace;
}

function resolveRoot(evalCase: SkillEvalCase, opts: RunnerOptions): ResolvedSkillsRoot {
  return resolveSkillsRoot({
    ...(opts.skillsDir !== undefined ? { cliSkillsDir: opts.skillsDir } : {}),
    ...(evalCase.input.skills_dir !== undefined
      ? { caseSkillsDir: evalCase.input.skills_dir }
      : {}),
  });
}

export const runSkill = async (
  evalCase: SkillEvalCase,
  opts: RunnerOptions,
): Promise<EvalTrace> => {
  const mode = evalCase.input.evaluation_mode ?? "inject";
  const skillName = evalCase.input.skill;

  if (!isValidSkillName(skillName)) {
    return buildSkillErrorTrace({
      evalCase,
      error: `Invalid skill name: "${skillName}"`,
    });
  }

  let resolvedRoot: ResolvedSkillsRoot;
  try {
    resolvedRoot = resolveRoot(evalCase, opts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildSkillErrorTrace({ evalCase, error: message });
  }

  let resolvedSkillContent: string | undefined;
  let availableSkills: SkillMeta[] | undefined;

  if (mode === "discover") {
    availableSkills = listSkillsFromRoot(resolvedRoot.rootDir);
    const targetSkill = availableSkills.find((skill) => skill.name === skillName);
    if (!targetSkill) {
      return buildSkillErrorTrace({
        evalCase,
        error: `Target skill not found: "${skillName}"`,
        skillResolution: buildSkillResolution(resolvedRoot, skillName),
      });
    }

    try {
      resolvedSkillContent = loadSkillContentFromRoot(
        resolvedRoot.rootDir,
        skillName,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return buildSkillErrorTrace({
        evalCase,
        error: message,
        skillResolution: buildSkillResolution(resolvedRoot, skillName),
      });
    }
  }

  let systemPrompt: string;
  if (mode === "inject") {
    try {
      resolvedSkillContent = loadSkillContentFromRoot(
        resolvedRoot.rootDir,
        skillName,
      );
      systemPrompt = buildInjectSystemPrompt(
        resolvedSkillContent,
        evalCase.input.system_prompt_prefix,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return buildSkillErrorTrace({
        evalCase,
        error: message,
        skillResolution: buildSkillResolution(resolvedRoot, skillName),
      });
    }
  } else {
    systemPrompt = buildDiscoverSystemPrompt(
      availableSkills ?? listSkillsFromRoot(resolvedRoot.rootDir),
      evalCase.input.system_prompt_prefix,
    );
  }

  const skillResolution = buildSkillResolution(
    resolvedRoot,
    skillName,
    resolvedSkillContent,
  );

  const runnableCase = buildRunnableCase(evalCase, systemPrompt);

  const modelResult = resolveModelOrThrow(runnableCase.input);
  if ("error" in modelResult) {
    return buildSkillErrorTrace({
      evalCase,
      runnableCase,
      error: modelResult.error,
      skillResolution,
    });
  }

  let ctx: RunContext;
  try {
    ctx = await initializeRunContext(runnableCase, opts, {
      builtinTools: [
        createReadFileTool(resolvedRoot.rootDir),
        createListDirTool(resolvedRoot.rootDir),
        // bash is only added in discover mode so the agent can execute
        // the commands the loaded skill describes.
        ...(mode === "discover" ? [createBashTool()] : []),
      ],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildSkillErrorTrace({
      evalCase,
      runnableCase,
      error: message,
      skillResolution,
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
    return {
      ...buildErrorTrace({
        evalCase: runnableCase,
        spans,
        startTime,
        conversation: loopResult.conversation,
        toolsCalled: loopResult.toolsCalled,
        totalInputTokens: loopResult.totalInputTokens,
        totalOutputTokens: loopResult.totalOutputTokens,
        error: loopResult.error!,
      }),
      skill_resolution: skillResolution,
    };
  }

  return {
    ...buildSuccessTrace({
      evalCase: runnableCase,
      spans,
      startTime,
      conversation: loopResult.conversation,
      toolsCalled: loopResult.toolsCalled,
      finalResponse: loopResult.finalResponse,
      totalInputTokens: loopResult.totalInputTokens,
      totalOutputTokens: loopResult.totalOutputTokens,
    }),
    skill_resolution: skillResolution,
  };
};
