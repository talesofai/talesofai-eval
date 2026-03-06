# Skill Usage Evaluation Implementation Plan

**Goal:** Improve agent-eval's ability to evaluate whether an agent actually uses a skill to complete a task, going beyond surface-level tool usage checks.
**Architecture:** Add a new assertion type `skill_usage` that combines deterministic trace inspection with LLM-based semantic scoring. Use deterministic checks for whether the target skill was actually loaded, and use an LLM judge only for workflow adherence and skill-influenced output. Persist the exact resolved skill content in the trace so scoring and replay stay hermetic even if the external skills directory changes later.
**Tech Stack:** TypeScript, existing scorer registry, existing judge infrastructure via `callJudgeUnified`, skill runner trace provenance, YAML loader validation.

---

## Problem Statement

Current skill evaluation has gaps:

1. **Tool usage is shallow**. Checking `expected_tools: ["ls", "read"]` only verifies that tools were called, not whether the agent read the correct skill file or used it.
2. **No target-skill verification**. In `discover` mode we do not verify that the agent read `<target-skill>/SKILL.md` successfully rather than browsing unrelated files.
3. **No workflow validation**. Skills define structured workflows, but we do not check whether the agent followed those workflows in its reasoning and output.
4. **No output attribution**. We cannot tell whether the final answer reflects the skill content or was produced independently.
5. **Replay is not hermetic for skill-aware scoring**. A scorer that re-reads the skill from disk would depend on mutable external files, which conflicts with record-and-replay expectations documented in `README.md`.

---

## Design Decisions

1. **New assertion type: `skill_usage`**. This is a dedicated assertion for skill-specific evaluation.
2. **Hybrid scoring model**.
   - `skill_loaded` is deterministic and should inspect the trace's recorded tool calls.
   - `workflow_followed` and `skill_influenced_output` are semantic and should use the LLM judge.
3. **One aggregated dimension**. The scorer must return a single `DimensionResult` with `dimension: "skill_usage"`, because the current scorer interface returns one dimension per assertion. Per-check details belong in the reason payload, not as extra dimensions.
4. **Hermetic trace snapshot**. Store the exact resolved skill content in `trace.skill_resolution.skill_content`. The scorer should use the embedded snapshot first, then fall back to disk only for backward compatibility with older traces.
5. **Mode-aware applicability**.
   - `skill_loaded` applies to `discover` mode.
   - `workflow_followed` and `skill_influenced_output` apply to both `inject` and `discover`.
   - If a case requests only checks that are not applicable for the current mode, the scorer should fail with a clear configuration error.
6. **Guard before judge call**. If `skill_loaded` is requested and fails, return a failed result immediately instead of paying for an LLM judge call.
7. **Backward compatible**. Existing `tool_usage` and `llm_judge` assertions continue to work. `skill_usage` is opt-in.

---

## Progress

- [x] Task 1: Define `skill_usage` assertion types and loader schema ✅
- [x] Task 2: Implement `skill_usage` scorer and registry integration ✅
- [x] Task 3: Snapshot resolved skill content in traces for hermetic scoring ✅
- [x] Task 4: Add focused tests for loader, scorer, trace, and replay behavior ✅
- [x] Task 5: Update and add skill cases that actually exercise skill usage ✅
- [ ] Task 6: Documentation and verification

---

## Task 1: Define `skill_usage` assertion types and loader schema

**Files:**
- Modify: `packages/eval/src/types.ts`
- Modify: `packages/eval/src/loader/yaml.ts`
- Test: `packages/eval/src/tests/loader.test.ts`

**Step 1: Extend assertion and dimension types**

In `packages/eval/src/types.ts`:

- Add a reusable check union, for example:

```ts
export type SkillUsageCheck =
  | "skill_loaded"
  | "workflow_followed"
  | "skill_influenced_output";
```

- Add a new assertion variant to `AssertionConfig`:

```ts
| {
    type: "skill_usage";
    tier?: EvalTier;
    /** Defaults to all applicable checks for the current evaluation mode. */
    checks?: SkillUsageCheck[];
    /** Defaults to 0.7. */
    pass_threshold?: number;
  }
```

- Add `"skill_usage"` to `DimensionKind`.

**Step 2: Extend Zod schema in `loader/yaml.ts`**

Add a new schema branch for `skill_usage`:

- `checks` should accept only the three supported enum values.
- Reject empty `checks` arrays.
- Reject duplicate check names.
- `pass_threshold` should remain optional but, when present, must be `0..1`.

**Step 3: Add loader tests**

Add tests in `packages/eval/src/tests/loader.test.ts` for:

- parsing a valid `skill_usage` assertion
- rejecting invalid check names
- rejecting duplicate checks
- rejecting empty `checks`

**Verification:**
```bash
pnpm --dir packages/eval exec node --test src/tests/loader.test.ts
```

---

## Task 2: Implement `skill_usage` scorer and registry integration

**Files:**
- Create: `packages/eval/src/scorers/skill-usage.ts`
- Modify: `packages/eval/src/scorers/registry.ts`
- Modify: `packages/eval/src/scorers/index.ts`
- Test: `packages/eval/src/tests/skill-usage-scorer.test.ts`
- Test: `packages/eval/src/tests/new-scorers.test.ts`

**Step 1: Write the failing scorer tests**

Create `packages/eval/src/tests/skill-usage-scorer.test.ts` with focused tests that do not require a live judge:

- `discover` trace with a successful `read` of `<skill-name>/SKILL.md` passes `skill_loaded`
- `discover` trace that only reads another skill fails `skill_loaded`
- `discover` trace with a failed `read` call does not count as loaded
- non-skill cases fail gracefully with a clear reason
- traces without `skill_resolution` fail gracefully
- semantic checks reach the judge path and fail cleanly with `no judge model configured` when judge env is absent
- scorer prefers `trace.skill_resolution.skill_content` over disk fallback when present

In `packages/eval/src/tests/new-scorers.test.ts`, add integration coverage that `scoreTrace()` assigns default tier 2 to `skill_usage`.

**Step 2: Implement deterministic helpers**

In `packages/eval/src/scorers/skill-usage.ts`, implement helpers for:

- narrowing `assertion.type === "skill_usage"`
- resolving active checks for the case mode
- normalizing read paths (`./foo/SKILL.md`, `foo/SKILL.md`, slash normalization)
- determining whether the target skill was successfully loaded by inspecting `trace.tools_called`

`skill_loaded` should inspect recorded tool calls, not use an LLM judge.

Success criteria for `skill_loaded`:

- tool name is `read`
- `arguments.path` resolves to the target relative path `<skill-name>/SKILL.md`
- tool output is not an error result

**Step 3: Implement semantic scoring for workflow and output influence**

Still in `packages/eval/src/scorers/skill-usage.ts`:

- Resolve the target skill content from `trace.skill_resolution.skill_content` first
- Fall back to `loadSkillContentFromRoot(trace.skill_resolution.root_dir, trace.skill_resolution.skill_name)` only when the snapshot is absent
- Build a judge prompt that includes:
  - the target skill content
  - the evaluation mode
  - the requested semantic checks
  - the relevant trace conversation and final response
- Use `callJudgeUnified` from `packages/eval/src/judge/multi.ts`

Do not duplicate the multi-judge branching logic already handled by `callJudgeUnified`.

**Step 4: Aggregate into one `skill_usage` dimension**

The scorer must return one `DimensionResult`:

```ts
{
  dimension: "skill_usage",
  passed,
  score,
  reason,
}
```

Aggregation rules:

- If `skill_loaded` is requested and fails, short-circuit to `score = 0`, `passed = false`
- Otherwise, aggregate requested check scores into one overall score
- Encode per-check detail in `reason`, for example as structured prose or JSON-like text
- Default `pass_threshold` to `0.7` when omitted

**Step 5: Register the scorer and default tier**

- Add `skill_usage` to `SCORER_REGISTRY` in `packages/eval/src/scorers/registry.ts`
- Add `skill_usage: 2` to `DEFAULT_TIER` in `packages/eval/src/scorers/index.ts`

**Verification:**
```bash
pnpm --dir packages/eval exec node --test src/tests/skill-usage-scorer.test.ts src/tests/new-scorers.test.ts
```

---

## Task 3: Snapshot resolved skill content in traces for hermetic scoring

**Files:**
- Modify: `packages/eval/src/types.ts`
- Modify: `packages/eval/src/runner/skill.ts`
- Modify: `packages/eval/src/traces.ts`
- Test: `packages/eval/src/tests/traces.test.ts`
- Test: `packages/eval/src/tests/skill-runner.test.ts`

**Step 1: Extend `SkillResolutionTrace`**

In `packages/eval/src/types.ts`, extend the trace type:

```ts
export type SkillResolutionTrace = {
  source: "cli" | "case" | "env" | "home" | "bundled";
  root_dir: string;
  skill_name: string;
  skill_path: string;
  /** Exact skill content used for scoring and replay. */
  skill_content?: string;
};
```

**Step 2: Capture the snapshot in the skill runner**

In `packages/eval/src/runner/skill.ts`:

- In `inject` mode, reuse the loaded skill content for both the system prompt and `skill_resolution.skill_content`
- In `discover` mode, load the target skill content after validating the skill exists, then store it in `skill_resolution.skill_content`
- Keep the existing `skill_path` and `root_dir` provenance fields

This makes `skill_usage` replayable even if the external skills directory changes after the run.

**Step 3: Update trace validation**

In `packages/eval/src/traces.ts`, update `isSkillResolutionTrace()` so `skill_content`, when present, must be a string.

**Step 4: Add trace and runner tests**

Add tests for:

- `runSkill()` including `skill_resolution.skill_content` in inject mode
- `runSkill()` including `skill_resolution.skill_content` in discover mode
- `loadTrace()` accepting the new field
- scorer fallback behavior for old traces without `skill_content`

**Verification:**
```bash
pnpm --dir packages/eval exec node --test src/tests/traces.test.ts src/tests/skill-runner.test.ts src/tests/skill-usage-scorer.test.ts
```

---

## Task 4: Add focused tests for loader, scorer, trace, and replay behavior

**Files:**
- Modify: `packages/eval/src/tests/loader.test.ts`
- Create: `packages/eval/src/tests/skill-usage-scorer.test.ts`
- Modify: `packages/eval/src/tests/new-scorers.test.ts`
- Modify: `packages/eval/src/tests/traces.test.ts`
- Modify: `packages/eval/src/tests/skill-runner.test.ts`

**Step 1: Cover deterministic skill-loading behavior**

Verify:

- target skill read passes
- wrong skill read fails
- failed read does not count
- inject mode rejects `skill_loaded`-only assertions with a configuration error

**Step 2: Cover semantic scorer behavior without live judge dependency**

Follow the existing pattern used by `task_success` tests:

- do not require a live judge in unit tests
- assert graceful failure when judge env is missing
- unit test prompt-building helpers directly so the semantic prompt contents are still covered

**Step 3: Cover replay compatibility**

Add at least one automated test that proves scoring can use the embedded snapshot rather than live files. Example shape:

1. create a temporary skills root
2. run a skill case and capture a trace with `skill_content`
3. remove the temporary skills root
4. score or replay from the saved trace
5. verify the scorer no longer depends on the deleted skill file

**Verification:**
```bash
pnpm --dir packages/eval exec node --test src/tests/loader.test.ts src/tests/skill-usage-scorer.test.ts src/tests/new-scorers.test.ts src/tests/traces.test.ts src/tests/skill-runner.test.ts
```

---

## Task 5: Update and add skill cases that actually exercise skill usage

**Files:**
- Create: `packages/eval/cases/skills/write-judge-prompt/workflow-adherence.eval.yaml`
- Create: `packages/eval/cases/skills/write-judge-prompt/discover-with-usage.eval.yaml`
- Modify: `packages/eval/cases/skills/write-judge-prompt/tone-mismatch.eval.yaml`
- Modify: `packages/eval/cases/skills/write-judge-prompt/discover-tone-mismatch.eval.yaml`
- Modify: `packages/eval/cases/skills/error-analysis/categorize-failures.eval.yaml`

**Step 1: Add an inject case that checks actual workflow usage**

Create `workflow-adherence.eval.yaml`:

```yaml
type: skill
id: skill-write-judge-prompt-workflow
description: Verify agent follows write-judge-prompt skill workflow

input:
  skill: write-judge-prompt
  model: gpt-4o-mini
  evaluation_mode: inject
  task: |
    Create a judge prompt for this failure mode:
    **Failure Mode**: SQL query returns wrong results
    **Context**: User asks for active users, query returns all users.

criteria:
  assertions:
    - type: skill_usage
      tier: 2
      checks:
        - workflow_followed
        - skill_influenced_output
      pass_threshold: 0.7
```

**Step 2: Add a discover case that requires actual skill use, not just summarization**

Create `discover-with-usage.eval.yaml`:

```yaml
type: skill
id: skill-write-judge-prompt-discover-usage
description: Verify agent discovers and properly uses write-judge-prompt skill

input:
  skill: write-judge-prompt
  model: gpt-4o-mini
  evaluation_mode: discover
  task: |
    I need to evaluate whether my AI assistant's responses match the expected tone.
    Create a judge prompt for this.

criteria:
  assertions:
    - type: tool_usage
      tier: 1
      expected_tools: ["ls", "read"]
    - type: skill_usage
      tier: 2
      checks:
        - skill_loaded
        - workflow_followed
        - skill_influenced_output
      pass_threshold: 0.7
```

**Step 3: Update existing cases carefully**

- `tone-mismatch.eval.yaml` should gain `skill_usage` because it already asks the agent to produce a real artifact using the skill
- `error-analysis/categorize-failures.eval.yaml` should gain `skill_usage` because it also tests actual skill execution
- `discover-tone-mismatch.eval.yaml` should remain a discovery-oriented case and only add `skill_usage` if it is limited to `checks: [skill_loaded]`

Do not force full workflow-following checks onto a case whose task is only to inspect and summarize a skill.

---

## Task 6: Documentation and verification

**Files:**
- Update: `docs/skill-eval-plan.md`
- Update: `README.md`

**Step 1: Document `skill_usage` semantics**

In `docs/skill-eval-plan.md`, add a section that explains:

- what `skill_usage` measures
- which checks are deterministic vs judge-based
- which checks apply to `inject` vs `discover`
- that traces now snapshot `skill_content` for replay stability

**Step 2: Document replay expectations**

In `README.md`, update the record/replay documentation to mention that skill traces now embed the exact resolved skill content so skill-aware scoring remains stable across replay.

**Step 3: Run focused tests**

```bash
pnpm --dir packages/eval exec node --test src/tests/loader.test.ts src/tests/skill-usage-scorer.test.ts src/tests/new-scorers.test.ts src/tests/traces.test.ts src/tests/skill-runner.test.ts
```

**Step 4: Run typecheck**

```bash
pnpm --dir packages/eval run typecheck
```

**Step 5: Run full package tests**

```bash
pnpm --dir packages/eval test
```

**Step 6: Run one inject and one discover case**

```bash
pnpm --dir packages/eval run agent-eval run \
  --file cases/skills/write-judge-prompt/workflow-adherence.eval.yaml \
  --format terminal \
  --verbose
```

```bash
pnpm --dir packages/eval run agent-eval run \
  --file cases/skills/write-judge-prompt/discover-with-usage.eval.yaml \
  --format terminal \
  --verbose
```

**Step 7: Verify replay still scores skill usage correctly**

```bash
pnpm --dir packages/eval run agent-eval run \
  --file cases/skills/write-judge-prompt/discover-with-usage.eval.yaml \
  --record ./.eval-records/skill-usage-review
```

```bash
pnpm --dir packages/eval run agent-eval run \
  --file cases/skills/write-judge-prompt/discover-with-usage.eval.yaml \
  --replay ./.eval-records/skill-usage-review
```

---

## Notes for the Implementer

1. **Use deterministic checks where possible.** `skill_loaded` is a trace-inspection problem, not an LLM-judge problem.
2. **Do not return multiple dimensions from one assertion.** The current scorer architecture expects one `DimensionResult` per assertion.
3. **Use the embedded skill snapshot first.** Falling back to the filesystem is only for backward compatibility with older traces.
4. **Keep path handling strict.** Normalize relative paths before comparing against `<skill-name>/SKILL.md`.
5. **Keep reasons diagnostic.** Include per-check outcomes in `reason` so failures are debuggable.
6. **Do not over-apply `skill_usage`.** Discovery-only cases should usually check `skill_loaded`, while execution cases should check workflow and output influence.

---

## Recommended Execution Order

1. Task 1, define the assertion and dimension types
2. Task 2, implement the scorer and registry wiring
3. Task 3, snapshot skill content in traces
4. Task 4, add focused tests including replay behavior
5. Task 5, update existing cases and add usage-oriented cases
6. Task 6, update docs and run verification

---

## Execution Handoff

1. **Subagent-driven**: Use the nobody-executes-plans skill
2. **Manual execution**: Work through the tasks sequentially, verifying after each change
