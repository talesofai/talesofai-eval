import { callJudgeUnified } from "../judge/multi.ts";
import { loadSkillContentFromRoot } from "../skills/index.ts";
import type {
  AssertionConfig,
  DimensionResult,
  EvalCase,
  EvalTrace,
  ToolCallRecord,
} from "../types.ts";

type BashExecutionAssertion = Extract<
  AssertionConfig,
  { type: "bash_execution" }
>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractBashCalls(trace: EvalTrace): ToolCallRecord[] {
  return trace.tools_called.filter((call) => call.name === "bash");
}

function formatBashCalls(calls: ToolCallRecord[]): string {
  if (calls.length === 0) {
    return "(no bash commands executed)";
  }

  return calls
    .map((call, i) => {
      const cmd =
        typeof call.arguments["command"] === "string"
          ? call.arguments["command"]
          : JSON.stringify(call.arguments);
      const output =
        typeof call.output === "string"
          ? call.output
          : JSON.stringify(call.output);
      const preview =
        output.length > 800 ? `${output.slice(0, 800)}…` : output;
      return `[${i + 1}] $ ${cmd}\n${preview}`;
    })
    .join("\n\n");
}

type SkillContentResult = { content: string } | { error: string };

function getSkillContent(trace: EvalTrace): SkillContentResult {
  const resolution = trace.skill_resolution;
  if (!resolution) {
    return { error: "trace is missing skill_resolution" };
  }

  if (typeof resolution.skill_content === "string") {
    return { content: resolution.skill_content };
  }

  try {
    return {
      content: loadSkillContentFromRoot(
        resolution.root_dir,
        resolution.skill_name,
      ),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `failed to resolve skill content: ${msg}` };
  }
}

function buildJudgePrompts(options: {
  skillContent: string;
  bashCalls: ToolCallRecord[];
  finalResponse: string | null;
  expectedGoal?: string;
}): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You are evaluating whether an agent correctly executed shell commands as instructed by a skill.",
    'Return only JSON: {"score": <0..1>, "reason": "<brief explanation>"}.',
    "Score 1.0 when the agent ran commands that meaningfully implement the skill workflow and the outputs indicate success.",
    "Score 0.0 when the agent did not run any relevant commands, or the outputs show clear failure without recovery.",
  ].join("\n");

  const goalSection = options.expectedGoal
    ? `## Expected goal\n${options.expectedGoal}`
    : "";

  const userPrompt = [
    `## Target skill content\n${options.skillContent}`,
    goalSection,
    `## Bash commands executed\n${formatBashCalls(options.bashCalls)}`,
    `## Final response\n${options.finalResponse ?? "(no final response)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { systemPrompt, userPrompt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Scorer
// ─────────────────────────────────────────────────────────────────────────────

export const scoreBashExecutionAssertion = async (
  trace: EvalTrace,
  assertion: AssertionConfig,
  _evalCase: EvalCase,
): Promise<DimensionResult> => {
  if (assertion.type !== "bash_execution") {
    return {
      dimension: "bash_execution",
      passed: false,
      score: 0,
      reason: `internal error: expected bash_execution assertion, got ${assertion.type}`,
    };
  }

  const a = assertion as BashExecutionAssertion;

  if (trace.status === "error" || trace.error) {
    return {
      dimension: "bash_execution",
      passed: false,
      score: 0,
      reason: `runner error: ${trace.error ?? "runner returned error trace"}`,
    };
  }

  const skillContent = getSkillContent(trace);
  if ("error" in skillContent) {
    return {
      dimension: "bash_execution",
      passed: false,
      score: 0,
      reason: skillContent.error,
    };
  }

  const bashCalls = extractBashCalls(trace);
  const prompts = buildJudgePrompts({
    skillContent: skillContent.content,
    bashCalls,
    finalResponse: trace.final_response,
    ...(a.expected_goal !== undefined ? { expectedGoal: a.expected_goal } : {}),
  });

  const judgeResult = await callJudgeUnified(
    prompts.systemPrompt,
    prompts.userPrompt,
  );

  if ("error" in judgeResult) {
    return {
      dimension: "bash_execution",
      passed: false,
      score: 0,
      reason: judgeResult.error,
    };
  }

  const passThreshold = a.pass_threshold ?? 0.7;
  return {
    dimension: "bash_execution",
    passed: judgeResult.score >= passThreshold,
    score: judgeResult.score,
    reason: judgeResult.reason,
  };
};
