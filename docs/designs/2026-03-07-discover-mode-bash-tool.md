# Design: Bash Execution Tool for Discover-Mode Skill Cases

**Date:** 2026-03-07  
**Status:** Approved

---

## Goal

Add a `bash` execution builtin tool to discover-mode skill cases so that agents can actually execute the CLI commands that evaluated skills describe, and introduce a `bash_execution` assertion type to grade the quality of that execution.

---

## Problem & Motivation

The skill runner has two evaluation modes: **inject** (skill pre-loaded in the system prompt) and **discover** (agent must find and load the skill via `read`/`ls` tools). Discover mode is intended to test realistic skill usage, mirroring how agents behave in production.

The gap: many skills describe workflows involving *running commands* — e.g. `agent-eval draft-skill-case --skill my-skill`. In discover mode today, the only available tools are `read` and `ls`. Once the agent loads and understands the skill, it has nowhere to go — it cannot execute the workflow. The evaluation grades only whether the agent *found and read* the skill, not whether it could *carry it out*.

---

## Approach

### 1. Bash Builtin Tool (`runner/builtin-tools/bash.ts`)

A new `createBashTool` function returns a tool named `bash`.

**Contract:**
- Input: `{ command: string }`
- Executes the command in a child process
- Returns combined stdout/stderr (capped at a reasonable max length)
- **Working directory:** the eval runner's current working directory (no sandboxing)

**Safety — two layers:**

| Layer | Mechanism |
|-------|-----------|
| Timeout | Hard per-invocation timeout (default: 30 s). Configurable via env/config. If exceeded, process is killed and an error string is returned. |
| Denylist | A set of blocked command prefixes/patterns targeting obviously destructive operations (`rm -rf /`, system path mutations, etc.). Conservative by default; extensible over time. Blocked commands return an error, never execute. |

Tool description in the system prompt: clarifies it is for executing commands described by the loaded skill, not arbitrary system exploration.

---

### 2. Runner Integration (`runner/skill.ts`)

- `createBashTool` is added to the `builtinTools` array passed to `initializeRunContext` **only in discover mode**.
- Inject mode is unchanged — it tests skill documentation quality, not execution.
- `buildDiscoverSystemPrompt` is updated to mention `bash` alongside `ls` and `read`.
- Each bash invocation is recorded as a `ToolCallRecord` (`name: "bash"`, `arguments: { command }`, `output: "<stdout+stderr>"`) in `tools_called` — no structural changes to `EvalTrace`.
- Timing is captured as a `tool_call` span, consistent with MCP tool calls.
- Module lives in `runner/builtin-tools/bash.ts`, mirroring `read.ts` and `list-dir.ts`.

---

### 3. `bash_execution` Assertion Type (`scorers/bash-execution.ts`)

**Tier:** 2 (LLM-as-a-judge)

**Input to judge:**
- Target skill content (from `skill_resolution.skill_content`)
- Bash tool calls extracted from `tools_called` (filtered to `name === "bash"`)
- Agent final response

**Judge output:** `{ score: 0–1, reason: string }` — passed through `callJudgeUnified` (same path as `llm_judge`, `task_success`, `skill_usage`).

**YAML shape:**
```yaml
- type: bash_execution
  tier: 2
  pass_threshold: 0.7         # optional, default 0.7
  expected_goal: "..."        # optional hint for the judge
```

`expected_goal` is a free-text string the case author can use to guide the judge toward a specific criterion (e.g. "agent should have run draft-skill-case and produced a valid YAML file").

**`types.ts` addition:**
```typescript
| {
    type: "bash_execution";
    tier?: EvalTier;
    pass_threshold?: number;
    expected_goal?: string;
  }
```

---

### 4. YAML Case Format

No mandatory changes to existing cases. Case authors add `bash_execution` explicitly when they want to evaluate execution quality:

```yaml
type: skill
id: skill-write-judge-prompt-discover-execute
description: Agent discovers skill, runs draft-skill-case, validates output

input:
  skill: write-judge-prompt
  model: deepseek/deepseek-chat
  evaluation_mode: discover
  task: Generate an eval case for the write-judge-prompt skill

criteria:
  assertions:
    - type: tool_usage
      tier: 1
      expected_tools: [ls, read, bash]
    - type: skill_usage
      tier: 2
      checks: [skill_loaded, workflow_followed, skill_influenced_output]
      pass_threshold: 0.7
    - type: bash_execution
      tier: 2
      pass_threshold: 0.7
      expected_goal: >
        Agent should run agent-eval draft-skill-case and produce
        a valid .eval.yaml scaffold.
```

---

### 5. `draft-skill-case` Auto-Inclusion (`skill-case-scaffold.ts`)

`designAssertionsForWorkflow` is extended with a heuristic: if the identified workflow's `task` or `description` contains command-like language (e.g. "run", "execute", "generate"), a `bash_execution` assertion is automatically included in the generated case's `criteria.assertions`.

---

## Files Changed

| File | Change |
|------|--------|
| `src/runner/builtin-tools/bash.ts` | **New** — `createBashTool`, timeout + denylist logic |
| `src/runner/builtin-tools/index.ts` | Export `createBashTool` |
| `src/runner/skill.ts` | Add `createBashTool` to discover-mode `builtinTools`; update `buildDiscoverSystemPrompt` |
| `src/scorers/bash-execution.ts` | **New** — `scoreBashExecutionAssertion` |
| `src/scorers/registry.ts` | Register `bash_execution` scorer |
| `src/types.ts` | Add `bash_execution` to `AssertionConfig` union; add `"bash_execution"` to `DimensionKind` |
| `src/skill-case-scaffold.ts` | Auto-include `bash_execution` in `designAssertionsForWorkflow` heuristic |

---

## Constraints & Out of Scope

**Out of scope (this iteration):**
- Filesystem sandboxing / containerisation
- Per-case timeout override in YAML (env/config only)
- Replay of bash execution (replay re-scores only; bash re-runs live, same as today)
- Exposing `bash` in inject mode, agent cases, or plain cases

**Designed for future extension:**
- `createBashTool` is composable — can be added to plain/agent case runners later without redesign

---

## Success Criteria

1. An agent in discover mode can call `bash` and the invocation appears in `tools_called` in the recorded trace.
2. The `bash_execution` scorer returns a meaningful pass/fail score and reason using the existing judge infrastructure.
3. `draft-skill-case` auto-includes `bash_execution` when the identified workflow involves command execution.
4. No regressions in existing inject-mode or plain/agent cases — bash is strictly additive.
5. Unit tests confirm: timeout kills hanging commands; denylist returns error without executing; normal commands return stdout/stderr correctly.
