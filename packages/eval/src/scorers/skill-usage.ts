import { posix } from "node:path";
import { callJudgeUnified } from "../judge/multi.ts";
import { loadSkillContentFromRoot } from "../skills/index.ts";
import type {
  AssertionConfig,
  DimensionResult,
  EvalCase,
  EvalTrace,
  SkillUsageCheck,
  ToolCallRecord,
} from "../types.ts";

type SkillUsageAssertion = Extract<AssertionConfig, { type: "skill_usage" }>;

type SkillUsageMode = "inject" | "discover";

type SkillResolutionWithContent = NonNullable<EvalTrace["skill_resolution"]> & {
  skill_content?: string;
};

const CHECKS_BY_MODE: Record<SkillUsageMode, SkillUsageCheck[]> = {
  inject: ["workflow_followed", "skill_influenced_output"],
  discover: [
    "skill_loaded",
    "workflow_followed",
    "skill_influenced_output",
  ],
};

function getEvaluationMode(evalCase: EvalCase): SkillUsageMode | null {
  if (evalCase.type !== "skill") {
    return null;
  }

  return evalCase.input.evaluation_mode ?? "inject";
}

function getRequestedChecks(
  assertion: SkillUsageAssertion,
  mode: SkillUsageMode,
): SkillUsageCheck[] {
  return assertion.checks ?? CHECKS_BY_MODE[mode];
}

function getApplicableChecks(
  requestedChecks: SkillUsageCheck[],
  mode: SkillUsageMode,
): SkillUsageCheck[] {
  const applicable = new Set(CHECKS_BY_MODE[mode]);
  return requestedChecks.filter((check) => applicable.has(check));
}

function normalizeReadPath(pathValue: string): string {
  const normalized = posix.normalize(pathValue.replaceAll("\\", "/"));
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function isToolOutputError(output: unknown): boolean {
  if (typeof output === "string") {
    return /^error:/i.test(output.trim());
  }

  return (
    typeof output === "object" &&
    output !== null &&
    "isError" in output &&
    output.isError === true
  );
}

function wasTargetSkillLoaded(
  trace: EvalTrace,
  skillName: string,
): { passed: boolean; reason: string } {
  const targetPath = normalizeReadPath(`${skillName}/SKILL.md`);
  const matchingRead = trace.tools_called.find((call) => {
    if (call.name !== "read") {
      return false;
    }

    const pathValue = call.arguments["path"];
    if (typeof pathValue !== "string") {
      return false;
    }

    return normalizeReadPath(pathValue) === targetPath;
  });

  if (!matchingRead) {
    return {
      passed: false,
      reason: `skill_loaded=false target read not found for ${targetPath}`,
    };
  }

  if (isToolOutputError(matchingRead.output)) {
    return {
      passed: false,
      reason: `skill_loaded=false target read failed for ${targetPath}`,
    };
  }

  return {
    passed: true,
    reason: `skill_loaded=true loaded ${targetPath}`,
  };
}

function formatTrace(trace: EvalTrace): string {
  const lines: string[] = [];

  for (const msg of trace.conversation) {
    if (msg.role === "system") {
      lines.push(`[System] ${msg.content}`);
      continue;
    }

    if (msg.role === "user") {
      lines.push(`[User] ${msg.content}`);
      continue;
    }

    if (msg.role === "assistant") {
      if (msg.content) {
        lines.push(`[Assistant] ${msg.content}`);
      }
      if (msg.tool_calls) {
        for (const toolCall of msg.tool_calls) {
          lines.push(
            `[Assistant → Tool] ${toolCall.function.name}(${toolCall.function.arguments})`,
          );
        }
      }
      continue;
    }

    const preview =
      msg.content.length > 500 ? `${msg.content.slice(0, 500)}…` : msg.content;
    lines.push(`[Tool Result] ${preview}`);
  }

  if (lines.length === 0) {
    return "(no conversation recorded)";
  }

  return lines.join("\n");
}

function formatToolCalls(toolCalls: ToolCallRecord[]): string {
  if (toolCalls.length === 0) {
    return "(no tool calls recorded)";
  }

  return toolCalls
    .map((call) => {
      const args = JSON.stringify(call.arguments);
      const output =
        typeof call.output === "string"
          ? call.output
          : JSON.stringify(call.output);
      const preview = output.length > 500 ? `${output.slice(0, 500)}…` : output;
      return `[${call.name}] args=${args} output=${preview}`;
    })
    .join("\n");
}

function buildSkillUsagePrompts(options: {
  trace: EvalTrace;
  mode: SkillUsageMode;
  checks: SkillUsageCheck[];
  skillContent: string;
}): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You are evaluating whether an agent actually used a target skill.",
    "Return only JSON: {\"score\": <0..1>, \"reason\": \"<brief explanation>\"}.",
    "Focus only on the requested semantic checks.",
    "Score 1.0 when the agent clearly follows the skill workflow and the final output shows the skill's influence.",
    "Score 0.0 when the agent ignores the skill or the output could not plausibly come from it.",
  ].join("\n");

  const userPrompt = [
    `## Evaluation mode\n${options.mode}`,
    `## Requested semantic checks\n${options.checks.join(", ")}`,
    `## Target skill content\n${options.skillContent}`,
    `## Conversation\n${formatTrace(options.trace)}`,
    `## Tool calls\n${formatToolCalls(options.trace.tools_called)}`,
    `## Final response\n${options.trace.final_response ?? "(no final response)"}`,
  ].join("\n\n");

  return { systemPrompt, userPrompt };
}

function getSkillContent(trace: EvalTrace): { content?: string; error?: string } {
  const skillResolution = trace.skill_resolution as SkillResolutionWithContent | undefined;

  if (!skillResolution) {
    return { error: "trace is missing skill_resolution" };
  }

  if (typeof skillResolution.skill_content === "string") {
    return { content: skillResolution.skill_content };
  }

  try {
    return {
      content: loadSkillContentFromRoot(
        skillResolution.root_dir,
        skillResolution.skill_name,
      ),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `failed to resolve skill content: ${message}` };
  }
}

export const scoreSkillUsageAssertion = async (
  trace: EvalTrace,
  assertion: AssertionConfig,
  evalCase: EvalCase,
): Promise<DimensionResult> => {
  if (assertion.type !== "skill_usage") {
    return {
      dimension: "skill_usage",
      passed: false,
      score: 0,
      reason: `internal error: expected skill_usage assertion, got ${assertion.type}`,
    };
  }

  if (evalCase.type !== "skill") {
    return {
      dimension: "skill_usage",
      passed: false,
      score: 0,
      reason: "skill_usage requires a skill case",
    };
  }

  if (!trace.skill_resolution) {
    return {
      dimension: "skill_usage",
      passed: false,
      score: 0,
      reason: "trace is missing skill_resolution",
    };
  }

  if (trace.status === "error" || trace.error) {
    return {
      dimension: "skill_usage",
      passed: false,
      score: 0,
      reason: `runner error: ${trace.error ?? "runner returned error trace"}`,
    };
  }

  const mode = getEvaluationMode(evalCase);
  if (!mode) {
    return {
      dimension: "skill_usage",
      passed: false,
      score: 0,
      reason: "could not resolve skill evaluation mode",
    };
  }

  const requestedChecks = getRequestedChecks(assertion, mode);
  const activeChecks = getApplicableChecks(requestedChecks, mode);
  if (activeChecks.length === 0) {
    return {
      dimension: "skill_usage",
      passed: false,
      score: 0,
      reason: `skill_usage configuration error: requested checks are not applicable in ${mode} mode (${requestedChecks.join(", ")})`,
    };
  }

  const checkScores = new Map<SkillUsageCheck, number>();
  const reasons: string[] = [];
  const skippedChecks = requestedChecks.filter(
    (check) => !activeChecks.includes(check),
  );

  if (activeChecks.includes("skill_loaded")) {
    const result = wasTargetSkillLoaded(trace, trace.skill_resolution.skill_name);
    reasons.push(result.reason);

    if (!result.passed) {
      return {
        dimension: "skill_usage",
        passed: false,
        score: 0,
        reason: skippedChecks.length
          ? `${result.reason}; skipped_inapplicable=${skippedChecks.join(",")}`
          : result.reason,
      };
    }

    checkScores.set("skill_loaded", 1);
  }

  const semanticChecks = activeChecks.filter(
    (check) => check !== "skill_loaded",
  );

  if (semanticChecks.length > 0) {
    const skillContent = getSkillContent(trace);
    if (!skillContent.content) {
      return {
        dimension: "skill_usage",
        passed: false,
        score: 0,
        reason: skillContent.error ?? "failed to resolve skill content",
      };
    }

    const prompts = buildSkillUsagePrompts({
      trace,
      mode,
      checks: semanticChecks,
      skillContent: skillContent.content,
    });
    const judgeResult = await callJudgeUnified(
      prompts.systemPrompt,
      prompts.userPrompt,
    );

    if ("error" in judgeResult) {
      return {
        dimension: "skill_usage",
        passed: false,
        score: 0,
        reason: judgeResult.error,
      };
    }

    for (const check of semanticChecks) {
      checkScores.set(check, judgeResult.score);
    }
    reasons.push(
      `semantic_checks=${semanticChecks.join(",")} score=${judgeResult.score.toFixed(2)} reason=${judgeResult.reason}`,
    );
  }

  const scores = activeChecks.map((check) => checkScores.get(check) ?? 0);
  const score =
    scores.length === 0 ? 0 : scores.reduce((sum, value) => sum + value, 0) / scores.length;
  const passThreshold = assertion.pass_threshold ?? 0.7;

  if (skippedChecks.length > 0) {
    reasons.push(`skipped_inapplicable=${skippedChecks.join(",")}`);
  }

  return {
    dimension: "skill_usage",
    passed: score >= passThreshold,
    score,
    reason: reasons.join("; "),
  };
};

export {
  buildSkillUsagePrompts,
  getApplicableChecks,
  getRequestedChecks,
  normalizeReadPath,
  wasTargetSkillLoaded,
};
