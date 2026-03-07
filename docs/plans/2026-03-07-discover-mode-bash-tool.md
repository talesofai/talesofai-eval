# Discover-Mode Bash Tool Implementation Plan

**Goal:** Add a `bash` execution builtin tool to discover-mode skill cases, and a `bash_execution` tier-2 assertion that LLM-judges whether the agent's shell execution reflects correct skill workflow enactment.

**Architecture:** Four self-contained milestones, each ending with a commit. New code is strictly additive — inject mode, agent cases, and plain cases are untouched. `createBashTool` mirrors the existing `createReadFileTool` / `createListDirTool` pattern. The `bash_execution` scorer reuses `callJudgeUnified` exactly like `skill_usage` and `task_success`.

**Tech Stack:** Node.js `child_process.execSync` / `spawn`, TypeScript, `@mariozechner/pi-ai` `Type` schema helpers, `node:test` + `node:assert/strict` (same as existing tests), `pnpm`.

---

## Milestone 1 — Bash Builtin Tool

**Files:**
- Create: `packages/eval/src/runner/builtin-tools/bash.ts`
- Modify: `packages/eval/src/runner/builtin-tools/index.ts`
- Modify: `packages/eval/src/tests/builtin-tools.test.ts`

---

### Task 1.1 — Write failing tests for `createBashTool`

Open `packages/eval/src/tests/builtin-tools.test.ts` and append the following test suite **at the end of the file** (before any trailing EOF):

```typescript
// ── Bash tool tests ──────────────────────────────────────────────────────────
import { createBashTool } from "../runner/builtin-tools/index.ts";

describe("createBashTool", () => {
  it("executes a simple command and returns stdout", async () => {
    const tool = createBashTool();
    const output = await tool.execute({ command: "echo hello" });
    assert.ok(typeof output === "string");
    assert.ok((output as string).includes("hello"));
  });

  it("returns stderr in output on command failure", async () => {
    const tool = createBashTool();
    const output = await tool.execute({ command: "ls /nonexistent_path_xyz" });
    assert.ok(typeof output === "string");
    // Either stderr text or an Error prefix
    assert.ok(
      (output as string).length > 0,
      "expected non-empty output on failure",
    );
  });

  it("returns error string when command is missing", async () => {
    const tool = createBashTool();
    const output = await tool.execute({});
    assert.ok(typeof output === "string");
    assert.ok((output as string).startsWith("Error:"));
  });

  it("blocks a denylisted command", async () => {
    const tool = createBashTool();
    // rm -rf / is on the denylist
    const output = await tool.execute({ command: "rm -rf /" });
    assert.ok(typeof output === "string");
    assert.ok((output as string).startsWith("Error:"));
    assert.ok((output as string).toLowerCase().includes("block"));
  });

  it("respects timeout and returns an error for hanging commands", async () => {
    const tool = createBashTool({ timeoutMs: 200 });
    const start = Date.now();
    const output = await tool.execute({ command: "sleep 10" });
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 3000, "should have timed out well under 3 s");
    assert.ok(typeof output === "string");
    assert.ok(
      (output as string).toLowerCase().includes("timeout") ||
        (output as string).startsWith("Error:"),
    );
  });

  it("caps output at maxOutputLength", async () => {
    const tool = createBashTool({ maxOutputLength: 50 });
    // Generate more than 50 chars of output
    const output = await tool.execute({
      command: "python3 -c \"print('x' * 200)\" 2>/dev/null || printf '%0.s.' {1..200}",
    });
    assert.ok(typeof output === "string");
    assert.ok((output as string).length <= 80, "output should be capped");
  });
});
```

**Step 1.1.1 — Run tests to confirm they fail**

```bash
cd packages/eval
node --test src/tests/builtin-tools.test.ts 2>&1 | tail -20
```

Expected: `SyntaxError` or `ERR_MODULE_NOT_FOUND` — `createBashTool` does not exist yet.

---

### Task 1.2 — Implement `createBashTool`

Create `packages/eval/src/runner/builtin-tools/bash.ts`:

```typescript
import { Type } from "@mariozechner/pi-ai";
import { spawnSync } from "node:child_process";
import type { BuiltinTool } from "../minimal-agent/types.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Denylist — command prefix/substring patterns that are always blocked.
// Conservative by default. Extend over time.
// ──────────────────────────────────────────────────────────────────────────────
const COMMAND_DENYLIST: RegExp[] = [
  /rm\s+-[a-z]*r[a-z]*f\s+\//, // rm -rf /  (system root)
  /mkfs\b/,                    // format filesystem
  /dd\s+.*of=\/dev\//,         // overwrite device
  />\s*\/dev\/sda/,            // write to raw disk
  /shutdown\b/,
  /reboot\b/,
  /halt\b/,
  /:\(\)\s*\{.*\}\s*;/,        // fork bomb
];

function isDenylisted(command: string): boolean {
  return COMMAND_DENYLIST.some((pattern) => pattern.test(command));
}

export type BashToolOptions = {
  /** Per-invocation timeout in milliseconds. Default: 30_000 (30 s) */
  timeoutMs?: number;
  /** Maximum output length in characters. Default: 8_000 */
  maxOutputLength?: number;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT = 8_000;

export function createBashTool(options: BashToolOptions = {}): BuiltinTool {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputLength = options.maxOutputLength ?? DEFAULT_MAX_OUTPUT;

  return {
    name: "bash",
    description:
      "Execute a shell command and return its combined stdout+stderr output. " +
      "Use this to run the commands described by the skill you have loaded.",
    parameters: Type.Object({
      command: Type.String({
        description: "Shell command to execute",
      }),
    }),
    execute: (args): string => {
      const command = args["command"];

      if (typeof command !== "string" || command.trim().length === 0) {
        return 'Error: Missing required argument "command".';
      }

      if (isDenylisted(command)) {
        return `Error: Command blocked by security denylist: ${command.slice(0, 80)}`;
      }

      const result = spawnSync("sh", ["-c", command], {
        timeout: timeoutMs,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      // spawnSync sets result.error when the process could not start or timed out
      if (result.error) {
        const msg = result.error.message ?? String(result.error);
        if (msg.includes("ETIMEDOUT") || result.signal === "SIGTERM") {
          return `Error: Command timed out after ${timeoutMs}ms: ${command.slice(0, 80)}`;
        }
        return `Error: ${msg}`;
      }

      const combined = [result.stdout ?? "", result.stderr ?? ""]
        .join("")
        .trimEnd();

      if (combined.length > maxOutputLength) {
        return (
          combined.slice(0, maxOutputLength) +
          `\n…(output truncated to ${maxOutputLength} chars)`
        );
      }

      return combined;
    },
  };
}
```

**Step 1.2.1 — Export from `index.ts`**

Edit `packages/eval/src/runner/builtin-tools/index.ts`:

```typescript
export { createReadFileTool } from "./read-file.ts";
export { createListDirTool } from "./list-dir.ts";
export { createBashTool } from "./bash.ts";
```

**Step 1.2.2 — Run tests again**

```bash
cd packages/eval
node --test src/tests/builtin-tools.test.ts 2>&1 | tail -30
```

Expected: all `createBashTool` tests pass. The cap test may vary by environment — if the `python3` command is unavailable it falls back to `printf`; adjust the command if needed, keeping the core assertion that output is capped.

**Step 1.2.3 — Commit**

```bash
git add packages/eval/src/runner/builtin-tools/bash.ts \
        packages/eval/src/runner/builtin-tools/index.ts \
        packages/eval/src/tests/builtin-tools.test.ts
git commit -m "feat: add createBashTool builtin with timeout and denylist"
```

---

## Milestone 2 — Runner Integration

**Files:**
- Modify: `packages/eval/src/runner/skill.ts`

---

### Task 2.1 — Wire bash into discover mode

Open `packages/eval/src/runner/skill.ts`.

**Step 2.1.1 — Add import at top**

Find the existing import:
```typescript
import {
  createListDirTool,
  createReadFileTool,
} from "./builtin-tools/index.ts";
```
Replace with:
```typescript
import {
  createBashTool,
  createListDirTool,
  createReadFileTool,
} from "./builtin-tools/index.ts";
```

**Step 2.1.2 — Update `buildDiscoverSystemPrompt`**

Find:
```typescript
  const instruction = [
    "You have access to optional skills listed below.",
    "Use ls to explore the skills directory and read to load files by relative path from that root.",
    'For example, first ls a skill directory, then read files like "write-judge-prompt/SKILL.md".',
    "Do not assume skill details before loading them.",
  ].join("\n");
```

Replace with:
```typescript
  const instruction = [
    "You have access to optional skills listed below.",
    "Use ls to explore the skills directory and read to load files by relative path from that root.",
    'For example, first ls a skill directory, then read files like "write-judge-prompt/SKILL.md".',
    "Do not assume skill details before loading them.",
    "Once you have loaded a skill, use bash to execute any commands it instructs you to run.",
  ].join("\n");
```

**Step 2.1.3 — Add `createBashTool` to discover-mode `builtinTools`**

In `runSkill`, find the `initializeRunContext` call that already passes `builtinTools`:

```typescript
    ctx = await initializeRunContext(runnableCase, opts, {
      builtinTools: [
        createReadFileTool(resolvedRoot.rootDir),
        createListDirTool(resolvedRoot.rootDir),
      ],
    });
```

Replace with:
```typescript
    ctx = await initializeRunContext(runnableCase, opts, {
      builtinTools: [
        createReadFileTool(resolvedRoot.rootDir),
        createListDirTool(resolvedRoot.rootDir),
        // bash is only added in discover mode so the agent can execute
        // the commands the loaded skill describes.
        ...(mode === "discover" ? [createBashTool()] : []),
      ],
    });
```

**Step 2.1.4 — Run full test suite**

```bash
cd packages/eval
node --test src/tests/*.test.ts 2>&1 | tail -30
```

Expected: all existing tests still pass; no new failures.

**Step 2.1.5 — Commit**

```bash
git add packages/eval/src/runner/skill.ts
git commit -m "feat: add bash builtin to discover-mode skill runner"
```

---

## Milestone 3 — `bash_execution` Assertion

**Files:**
- Modify: `packages/eval/src/types.ts`
- Create: `packages/eval/src/scorers/bash-execution.ts`
- Modify: `packages/eval/src/scorers/registry.ts`
- Create: `packages/eval/src/tests/bash-execution-scorer.test.ts`

---

### Task 3.1 — Extend `types.ts`

**Step 3.1.1 — Add to `AssertionConfig` union**

In `packages/eval/src/types.ts`, find the last variant in `AssertionConfig` (currently `{ type: "human_review" ... }`):

```typescript
  | { type: "human_review"; tier?: EvalTier; reason?: string };
```

Replace with:
```typescript
  | { type: "human_review"; tier?: EvalTier; reason?: string }
  | {
      type: "bash_execution";
      tier?: EvalTier;
      pass_threshold?: number;
      /** Optional free-text hint for the judge, e.g. the expected outcome. */
      expected_goal?: string;
    };
```

**Step 3.1.2 — Add to `DimensionKind`**

Find:
```typescript
export type DimensionKind =
  | "tool_usage"
  | "final_status"
  | "llm_judge"
  | "task_success"
  | "tool_parameter_accuracy"
  | "error_recovery"
  | "skill_usage"
  | "human_review";
```

Replace with:
```typescript
export type DimensionKind =
  | "tool_usage"
  | "final_status"
  | "llm_judge"
  | "task_success"
  | "tool_parameter_accuracy"
  | "error_recovery"
  | "skill_usage"
  | "human_review"
  | "bash_execution";
```

**Step 3.1.3 — Typecheck**

```bash
cd packages/eval
pnpm typecheck 2>&1 | tail -20
```

Expected: no errors (registry.ts will show a TS error about missing `bash_execution` key — that's fine, fix it in Task 3.3).

---

### Task 3.2 — Write failing tests for the scorer

Create `packages/eval/src/tests/bash-execution-scorer.test.ts`:

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreBashExecutionAssertion } from "../scorers/bash-execution.ts";
import type { AssertionConfig, EvalCase, EvalTrace } from "../types.ts";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeTrace(overrides: Partial<EvalTrace> = {}): EvalTrace {
  return {
    case_id: "test-case",
    case_type: "skill",
    conversation: [],
    tools_called: [],
    final_response: "done",
    status: "success",
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    duration_ms: 100,
    skill_resolution: {
      source: "cli",
      root_dir: "/tmp/skills",
      skill_name: "my-skill",
      skill_path: "/tmp/skills/my-skill/SKILL.md",
      skill_content: "---\nname: my-skill\ndescription: test skill\n---\nSkill body.",
    },
    ...overrides,
  };
}

function makeCase(): EvalCase {
  return {
    type: "skill",
    id: "test-case",
    description: "test",
    input: {
      skill: "my-skill",
      task: "do something",
      evaluation_mode: "discover",
    },
    criteria: { assertions: [] },
  };
}

function makeAssertion(overrides: Partial<Extract<AssertionConfig, { type: "bash_execution" }>> = {}): AssertionConfig {
  return {
    type: "bash_execution",
    pass_threshold: 0.7,
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("scoreBashExecutionAssertion", () => {
  it("returns passed=false when assertion type is wrong", async () => {
    const result = await scoreBashExecutionAssertion(
      makeTrace(),
      { type: "llm_judge", prompt: "x", pass_threshold: 0.7 },
      makeCase(),
    );
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes("internal error"));
  });

  it("returns passed=false when trace status is error", async () => {
    const result = await scoreBashExecutionAssertion(
      makeTrace({ status: "error", error: "runner crash" }),
      makeAssertion(),
      makeCase(),
    );
    assert.equal(result.passed, false);
    assert.ok(result.reason.includes("runner error"));
  });

  it("returns passed=false with reason when no bash calls found and trace has no skill_resolution skill_content", async () => {
    const trace = makeTrace({
      skill_resolution: {
        source: "cli",
        root_dir: "/tmp/skills",
        skill_name: "my-skill",
        skill_path: "/tmp/skills/my-skill/SKILL.md",
        // no skill_content — would need disk read; we skip in unit tests
      },
    });
    // No bash calls in tools_called
    // The scorer should still call the judge (with empty bash calls)
    // We just check it doesn't throw
    // (actual judge call will fail without real env vars — mark as non-critical)
    let threw = false;
    try {
      await scoreBashExecutionAssertion(trace, makeAssertion(), makeCase());
    } catch {
      threw = true;
    }
    // Should not throw (judge error is returned as a DimensionResult, not thrown)
    assert.equal(threw, false);
  });

  it("returns dimension = bash_execution", async () => {
    // Without EVAL_JUDGE_MODEL set the judge will return an error,
    // but the dimension name must still be correct.
    const result = await scoreBashExecutionAssertion(
      makeTrace(),
      makeAssertion(),
      makeCase(),
    );
    assert.equal(result.dimension, "bash_execution");
  });
});
```

**Step 3.2.1 — Run tests to confirm they fail**

```bash
cd packages/eval
node --test src/tests/bash-execution-scorer.test.ts 2>&1 | tail -20
```

Expected: `ERR_MODULE_NOT_FOUND` — scorer file does not exist yet.

---

### Task 3.3 — Implement the scorer

Create `packages/eval/src/scorers/bash-execution.ts`:

```typescript
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

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────────────────────────
// Scorer
// ──────────────────────────────────────────────────────────────────────────────

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
    expectedGoal: a.expected_goal,
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
```

**Step 3.3.1 — Register in `scorers/registry.ts`**

Edit `packages/eval/src/scorers/registry.ts`:

Add import at top (after existing imports):
```typescript
import { scoreBashExecutionAssertion } from "./bash-execution.ts";
```

Add entry to `SCORER_REGISTRY`:
```typescript
  bash_execution: (trace, assertion, evalCase) =>
    scoreBashExecutionAssertion(trace, assertion, evalCase),
```

**Step 3.3.2 — Run tests**

```bash
cd packages/eval
node --test src/tests/bash-execution-scorer.test.ts 2>&1 | tail -30
```

Expected: all 4 tests pass (the third test — judge call without env vars — passes because the scorer returns a `DimensionResult` with `passed: false` rather than throwing).

**Step 3.3.3 — Run full suite + typecheck**

```bash
cd packages/eval
node --test src/tests/*.test.ts 2>&1 | tail -30
pnpm typecheck 2>&1 | tail -20
```

Expected: no failures, no type errors.

**Step 3.3.4 — Commit**

```bash
git add packages/eval/src/types.ts \
        packages/eval/src/scorers/bash-execution.ts \
        packages/eval/src/scorers/registry.ts \
        packages/eval/src/tests/bash-execution-scorer.test.ts
git commit -m "feat: add bash_execution assertion type and scorer"
```

---

## Milestone 4 — `draft-skill-case` Auto-Heuristic

**Files:**
- Modify: `packages/eval/src/skill-case-scaffold.ts`
- Modify (or create): `packages/eval/src/tests/skill-case-scaffold.test.ts` (add new describe block)

---

### Task 4.1 — Write failing tests

Find or create `packages/eval/src/tests/skill-case-scaffold.test.ts`. Append a new describe block (or create the file if it doesn't exist):

```typescript
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCaseFromWorkflow_testOnly } from "../skill-case-scaffold.ts";
// Note: we expose a testOnly export below; see Task 4.2

describe("designAssertionsForWorkflow — bash_execution heuristic", () => {
  it("includes bash_execution when workflow task contains 'run'", () => {
    const workflow = {
      name: "run-scaffold",
      description: "Run the draft-skill-case command",
      task: "run agent-eval draft-skill-case for this skill",
    };
    const assertions = buildCaseFromWorkflow_testOnly(workflow, "inject");
    const types = assertions.map((a) => a.type);
    assert.ok(types.includes("bash_execution"), `expected bash_execution in ${types.join(", ")}`);
  });

  it("includes bash_execution when workflow description contains 'execute'", () => {
    const workflow = {
      name: "execute-command",
      description: "Execute the CLI command to generate output",
      task: "Generate eval cases for the skill",
    };
    const assertions = buildCaseFromWorkflow_testOnly(workflow, "inject");
    const types = assertions.map((a) => a.type);
    assert.ok(types.includes("bash_execution"), `expected bash_execution in ${types.join(", ")}`);
  });

  it("does not include bash_execution for a purely conceptual workflow", () => {
    const workflow = {
      name: "review-output",
      description: "Review the judge prompt for tone and accuracy",
      task: "Review the judge prompt and give feedback",
    };
    const assertions = buildCaseFromWorkflow_testOnly(workflow, "inject");
    const types = assertions.map((a) => a.type);
    assert.ok(!types.includes("bash_execution"), `unexpected bash_execution in ${types.join(", ")}`);
  });

  it("bash_execution in discover mode includes expected_goal derived from workflow", () => {
    const workflow = {
      name: "generate-case",
      description: "Generate eval cases by running draft-skill-case",
      task: "Run draft-skill-case to generate eval cases",
    };
    const assertions = buildCaseFromWorkflow_testOnly(workflow, "discover");
    const bashAssertion = assertions.find((a) => a.type === "bash_execution") as
      | { type: "bash_execution"; expected_goal?: string }
      | undefined;
    assert.ok(bashAssertion, "expected bash_execution assertion");
    assert.ok(
      bashAssertion.expected_goal && bashAssertion.expected_goal.length > 0,
      "expected_goal should be set",
    );
  });
});
```

**Step 4.1.1 — Run tests to confirm they fail**

```bash
cd packages/eval
node --test src/tests/skill-case-scaffold.test.ts 2>&1 | tail -20
```

Expected: `ERR_MODULE_NOT_FOUND` or named export not found — function doesn't exist yet.

---

### Task 4.2 — Update `designAssertionsForWorkflow`

Open `packages/eval/src/skill-case-scaffold.ts`.

**Step 4.2.1 — Add the heuristic helper function** just before `designAssertionsForWorkflow`:

```typescript
const COMMAND_SIGNAL_PATTERNS = [
  /\brun\b/i,
  /\bexecut/i,
  /\bgenerat/i,
  /\binvok/i,
  /\bcall\b/i,
  /\blaunch\b/i,
  /\bcommand\b/i,
  /\bcli\b/i,
  /agent-eval\b/i,
];

function workflowInvolvesCommandExecution(workflow: IdentifiedWorkflow): boolean {
  const text = `${workflow.task} ${workflow.description}`;
  return COMMAND_SIGNAL_PATTERNS.some((pattern) => pattern.test(text));
}
```

**Step 4.2.2 — Update `designAssertionsForWorkflow`**

Find the function body of `designAssertionsForWorkflow`. After the existing `skill_usage` push, add:

```typescript
  // Tier 2: bash_execution when the workflow involves running commands
  if (workflowInvolvesCommandExecution(workflow)) {
    assertions.push({
      type: "bash_execution",
      tier: 2,
      pass_threshold: 0.7,
      expected_goal: `Agent should run the commands described in the "${workflow.name}" workflow. ${workflow.description}`,
    });
  }
```

**Step 4.2.3 — Export `buildCaseFromWorkflow_testOnly` for unit tests**

At the bottom of `skill-case-scaffold.ts`, add:

```typescript
/** @internal — used only in unit tests */
export function buildCaseFromWorkflow_testOnly(
  workflow: IdentifiedWorkflow,
  mode: "inject" | "discover",
): AssertionDesign[] {
  return designAssertionsForWorkflow(workflow, mode);
}
```

Also add `AssertionDesign` to the list of internal types at the top of that file (it's currently defined locally — just mark it as `export type AssertionDesign = ...`).

**Step 4.2.4 — Run tests**

```bash
cd packages/eval
node --test src/tests/skill-case-scaffold.test.ts 2>&1 | tail -30
```

Expected: all 4 new tests pass.

**Step 4.2.5 — Full suite + typecheck**

```bash
cd packages/eval
node --test src/tests/*.test.ts 2>&1 | tail -30
pnpm typecheck 2>&1 | tail -20
```

Expected: no failures, no type errors.

**Step 4.2.6 — Commit**

```bash
git add packages/eval/src/skill-case-scaffold.ts \
        packages/eval/src/tests/skill-case-scaffold.test.ts
git commit -m "feat: auto-include bash_execution assertion in draft-skill-case for command workflows"
```

---

## Final Verification

```bash
cd packages/eval
node --test src/tests/*.test.ts 2>&1
pnpm typecheck 2>&1
pnpm lint 2>&1
```

Expected: all tests pass, no type errors, no lint warnings.

---

## Summary of Changes

| File | Action |
|------|--------|
| `src/runner/builtin-tools/bash.ts` | ✅ Create — bash tool with timeout + denylist |
| `src/runner/builtin-tools/index.ts` | ✅ Modify — export `createBashTool` |
| `src/runner/skill.ts` | ✅ Modify — add bash to discover builtins; update prompt |
| `src/types.ts` | ✅ Modify — `bash_execution` in `AssertionConfig` + `DimensionKind` |
| `src/scorers/bash-execution.ts` | ✅ Create — `scoreBashExecutionAssertion` |
| `src/scorers/registry.ts` | ✅ Modify — register `bash_execution` |
| `src/skill-case-scaffold.ts` | ✅ Modify — auto-assertion heuristic + test export |
| `src/tests/builtin-tools.test.ts` | ✅ Modify — append `createBashTool` tests |
| `src/tests/bash-execution-scorer.test.ts` | ✅ Create — scorer unit tests |
| `src/tests/skill-case-scaffold.test.ts` | ✅ Modify/Create — heuristic tests |
