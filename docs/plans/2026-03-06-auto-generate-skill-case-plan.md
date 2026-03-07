# Auto-Generate Skill Case Implementation Plan

**Goal:** Add a CLI command that generates a deterministic skill eval case scaffold from a target `SKILL.md`, including a concrete task prompt and default assertions.
**Architecture:** Keep v1 deterministic and filesystem-aware, but keep the scaffold builder itself pure. The CLI command should resolve and validate the skill root, load one target skill with the existing skills resolver and loader, then pass validated content into a rule-based scaffold generator that renders a `type: skill` eval case. Output must be stable, testable, replay-friendly, and suitable for piping or writing to disk.
**Tech Stack:** TypeScript, `cac`, existing skill resolution in `packages/eval/src/skills/index.ts`, existing YAML output pattern in `packages/eval/src/cli/aux-commands.ts`, existing YAML loader in `packages/eval/src/loader/yaml.ts`, node test runner.

## Scope

V1 generates a **full eval case scaffold**, not just a loose prompt string.

Recommended CLI shape:

```bash
agent-eval draft-skill-case \
  --skill write-judge-prompt \
  --mode discover \
  --skills-dir ~/.agents/skills \
  --out cases/skills/write-judge-prompt/discover-auto.eval.yaml
```

Output case should include:
- `type`, `id`, `description`
- `input.skill`, `input.model`, `input.evaluation_mode`
- optional `input.skills_dir` only when the user explicitly passed `--skills-dir`
- generated `input.task`
- default `criteria.assertions`

V1 supports two templates only:
- `inject`
- `discover`

V1 does **not** auto-generate negative cases.

## Non-goals

- No LLM-based generation in v1
- No automatic negative or adversarial case synthesis
- No automatic `llm_judge` prompt authoring in v1
- No loader special-casing for generated cases

## Output and UX rules

1. **Pure scaffold builder**
   - The scaffold builder should accept already-loaded skill content and metadata.
   - Skill root resolution and disk I/O belong in the CLI handler.

2. **Task text must describe the user goal, not the mechanism**
   - Do not mention the skill name in the generated task.
   - Do not tell the agent to "use the skill" or "load the skill" in the task.
   - The task should describe the end-user request that should naturally trigger the skill.

3. **Generation must be deterministic**
   - No randomness.
   - If multiple examples or sections match, use a stable first-match priority order.

4. **Terminal output must be pipe-safe**
   - If `--out` is omitted, print YAML to `stdout` only.
   - Print status lines and resolved-root metadata to `stderr` only.
   - If `--out` is provided, write the file and do not also print YAML to `stdout`.

5. **JSON output must not lie about file writes**
   - If `--out` is omitted, return the generated case object plus metadata and a `suggested_output` path.
   - If `--out` is provided, return the generated case object plus metadata and the actual `output` path.
   - Include `skills_source` and `skills_root` in JSON output for debuggability.

6. **Explicit overrides must fail loudly when invalid**
   - If `--skills-dir` is provided and does not exist or is not a directory, fail instead of silently falling back to env, home, or bundled roots.

---

### Task 1: Add command metadata, option parsing, and JSON error support ✅ (implemented, tests passing, commit deferred pending approval)

**Files:**
- Modify: `packages/eval/src/cli/index.ts`
- Modify: `packages/eval/src/cli/options.ts`
- Modify: `packages/eval/src/cli/helpers.ts`
- Modify: `packages/eval/src/cli/shared.ts`
- Test: `packages/eval/src/tests/cli-options.test.ts`
- Test: `packages/eval/src/tests/cli-shared.test.ts`
- Test: `packages/eval/src/tests/cli.test.ts`

**Step 1: Write failing parser and command-surface tests**
Add coverage for:
- `draft-skill-case --skill x --mode discover`
- optional `--skills-dir`
- optional `--out`
- optional `--model`
- invalid mode rejection
- missing `--skill` rejection
- invalid skill name rejection using the existing skill-name rules
- `draft-skill-case` appears in CLI help
- `shouldUseJsonErrors()` returns true for `draft-skill-case --format json`

Example expected parsed shape:

```ts
{
  skill: "write-judge-prompt",
  mode: "discover",
  skillsDir: "~/.agents/skills",
  out: "cases/skills/write-judge-prompt/discover-auto.eval.yaml",
  format: "terminal",
}
```

**Step 2: Run tests to verify they fail**
Run:
```bash
pnpm --dir packages/eval exec node --test \
  src/tests/cli-options.test.ts \
  src/tests/cli-shared.test.ts \
  src/tests/cli.test.ts
```
Expected: FAIL because the parser, command registration, command metadata, and JSON error routing do not exist yet.

**Step 3: Add CLI option type and parser**
In `packages/eval/src/cli/options.ts` add:

```ts
export type DraftSkillCaseCommandOptions = {
  skill: string;
  mode: "inject" | "discover";
  skillsDir?: string;
  out?: string;
  model?: string;
  format: OutputFormat;
};
```

Add `parseDraftSkillCaseCommandOptions()` with validation:
- `skill` required, trimmed, non-empty
- `skill` must satisfy the existing `isValidSkillName()` rules so invalid names fail before root resolution/loading
- `mode` optional, default `discover`
- `mode` must be `inject` or `discover`
- `model` optional
- `skillsDir` optional
- `out` optional
- `format` default `terminal`

**Step 4: Register the command and update command metadata**
In `packages/eval/src/cli/index.ts` add:

```ts
cli
  .command("draft-skill-case", "Generate a skill eval case scaffold")
  .option("--skill <name>", "Skill name")
  .option("--mode <mode>", "inject or discover", { default: "discover" })
  .option("--skills-dir <path>", "Override skills root")
  .option("--model <model>", "Model id for generated case")
  .option("--out <path>", "Output yaml path")
  .option("--format <fmt>", "Output format: terminal or json", {
    default: "terminal",
  })
```

Also update `packages/eval/src/cli/helpers.ts`:
- add `draft-skill-case` to `CommandName`
- add `draft-skill-case` to `COMMANDS`

Also update `packages/eval/src/cli/shared.ts`:
- include `draft-skill-case` in `shouldUseJsonErrors()`

**Step 5: Run tests to verify they pass**
Run:
```bash
pnpm --dir packages/eval exec node --test \
  src/tests/cli-options.test.ts \
  src/tests/cli-shared.test.ts \
  src/tests/cli.test.ts
```
Expected: PASS.

**Step 6: Commit**
```bash
git add \
  packages/eval/src/cli/index.ts \
  packages/eval/src/cli/options.ts \
  packages/eval/src/cli/helpers.ts \
  packages/eval/src/cli/shared.ts \
  packages/eval/src/tests/cli-options.test.ts \
  packages/eval/src/tests/cli-shared.test.ts \
  packages/eval/src/tests/cli.test.ts
git commit -m "Add draft-skill-case CLI surface"
```

---

### Task 2: Add a pure deterministic scaffold generator ✅ (implemented, tests passing, commit deferred pending approval)

**Files:**
- Create: `packages/eval/src/skill-case-scaffold.ts`
- Test: `packages/eval/src/tests/skill-case-scaffold.test.ts`

**Step 1: Write failing generator tests**
Add tests for:
- generates a valid `discover` scaffold from loaded skill content
- generates a valid `inject` scaffold from loaded skill content
- includes `tool_usage` + `skill_usage` for `discover`
- includes only `skill_usage` for `inject`
- omits `input.skills_dir` when no explicit `--skills-dir` was provided
- preserves the caller-supplied `skillsDir` string when explicitly provided
- derives task text from frontmatter description via the existing frontmatter parser when examples are absent
- falls back to heading-based task wording when both examples and description are weak or absent
- does not mention the skill name in the generated task
- is deterministic across repeated runs for the same input

Test fixtures should pass raw skill markdown into the generator. Do not make generator tests depend on filesystem resolution.

**Step 2: Run test to verify it fails**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/skill-case-scaffold.test.ts
```
Expected: FAIL because the generator module does not exist.

**Step 3: Implement pure analysis and rendering helpers**
In `packages/eval/src/skill-case-scaffold.ts` keep the public surface minimal and reuse existing parsing utilities instead of inventing a second markdown/frontmatter parser.

Recommended structure:
- reuse `parseFrontmatter()` from `packages/eval/src/utils/frontmatter.ts`
- keep `buildSkillCaseScaffold(input)` as the only required export
- add only the smallest internal helpers needed for deterministic extraction, for example:
  - parse skill doc metadata/body
  - extract stable example candidates from markdown
  - classify intent from description/headings/examples
  - build task text
  - build default assertions

Recommended input shape:

```ts
type BuildSkillCaseScaffoldInput = {
  skillName: string;
  mode: "inject" | "discover";
  skillContent: string;
  model?: string;
  explicitSkillsDir?: string;
};
```

Recommended output shape:

```ts
{
  type: "skill",
  id: `skill-${skillName}-${mode}-auto`,
  description: `Auto-generated ${mode} skill case for ${skillName}`,
  input: {
    skill: skillName,
    model: input.model ?? "deepseek/deepseek-chat",
    evaluation_mode: mode,
    ...(input.explicitSkillsDir
      ? { skills_dir: input.explicitSkillsDir }
      : {}),
    task,
  },
  criteria: {
    assertions,
  },
}
```

Default assertions:

For `discover`:
```ts
[
  { type: "tool_usage", tier: 1, expected_tools: ["ls", "read"] },
  {
    type: "skill_usage",
    tier: 2,
    checks: ["skill_loaded", "workflow_followed", "skill_influenced_output"],
    pass_threshold: 0.7,
  },
]
```

For `inject`:
```ts
[
  {
    type: "skill_usage",
    tier: 2,
    checks: ["workflow_followed", "skill_influenced_output"],
    pass_threshold: 0.7,
  },
]
```

Task-generation rules:
- Task text must express the user goal only.
- Do not mention the skill name.
- Do not mention loading, discovering, or using the skill.
- If the skill contains clear example artifacts, generate the smallest concrete request that should naturally trigger the skill.
- If the skill is research or analysis oriented, ask for a concrete analysis artifact, not a generic summary.
- If the skill is creation oriented, ask for the smallest concrete output that demonstrates the workflow.
- If examples are ambiguous or absent, derive the task from frontmatter description or the first strong heading.
- Keep the task short, directly executable, and text-output-oriented.
- Use a stable first-match heuristic for any extracted examples.

**Step 4: Run test to verify it passes**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/skill-case-scaffold.test.ts
```
Expected: PASS.

**Step 5: Commit**
```bash
git add \
  packages/eval/src/skill-case-scaffold.ts \
  packages/eval/src/tests/skill-case-scaffold.test.ts
git commit -m "Add deterministic skill case scaffold generator"
```

---

### Task 3: Add command handler, root validation, and output semantics ✅ (implemented, tests passing, commit deferred pending approval)

**Files:**
- Modify: `packages/eval/src/cli/aux-commands.ts`
- Modify: `packages/eval/src/cli/index.ts`
- Modify: `packages/eval/src/cli/options.ts`
- Test: `packages/eval/src/tests/cli.test.ts`

**Step 1: Write failing CLI integration tests**
Add tests for:
- `agent-eval draft-skill-case --skill write-judge-prompt --format json`
- `agent-eval draft-skill-case --skill write-judge-prompt --out <file> --format json`
- terminal mode without `--out` prints YAML to `stdout` and status to `stderr`
- terminal mode with `--out` writes file, creates parent directories as needed, and does not print YAML to `stdout`
- invalid skill reports a useful error
- invalid skill name reports a useful error before any root/loader fallback behavior
- invalid explicit `--skills-dir` reports a useful error and does not silently fall back
- `draft-skill-case --format json` returns structured JSON errors for argument/validation failures

Expected JSON output when `--out` is omitted:

```json
{
  "type": "draft-skill-case",
  "skill": "write-judge-prompt",
  "mode": "discover",
  "written": false,
  "suggested_output": "cases/skills/write-judge-prompt/discover-auto.eval.yaml",
  "skills_source": "bundled",
  "skills_root": "/abs/path/to/skills",
  "case": {
    "type": "skill"
  }
}
```

Expected JSON output when `--out` is provided:

```json
{
  "type": "draft-skill-case",
  "skill": "write-judge-prompt",
  "mode": "discover",
  "written": true,
  "output": "/tmp/write-judge-prompt.discover.eval.yaml",
  "skills_source": "bundled",
  "skills_root": "/abs/path/to/skills",
  "case": {
    "type": "skill"
  }
}
```

**Step 2: Run test to verify it fails**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/cli.test.ts
```
Expected: FAIL because the handler does not exist.

**Step 3: Implement handler**
In `packages/eval/src/cli/aux-commands.ts` add `draftSkillCaseCommand(options)` that:
- validates explicit `--skills-dir` first when provided
- applies the same `~` expansion / canonical root behavior as the existing skills resolver
- preserves the user-supplied `--skills-dir` string in generated `input.skills_dir` while using the resolved root for loading
- rejects invalid skill names up front using the existing skill-name rules
- resolves the skills root with existing resolver logic
- loads the target skill content with `loadSkillContentFromRoot()`
- passes loaded content into `buildSkillCaseScaffold()`
- stringifies with `YAML.stringify`
- creates `dirname(--out)` recursively before writing
- writes to `--out` if provided, otherwise prints YAML to `stdout`
- prints status and resolved-root metadata to `stderr` only in terminal mode
- maps user-facing resolution/validation failures to `invalidArgs(...)` so terminal and json errors stay consistent with the rest of the CLI
- emits structured metadata plus the generated case object in json mode

Suggested default output path for metadata only:
```ts
cases/skills/${skill}/${mode}-auto.eval.yaml
```

Wire the handler in `packages/eval/src/cli/index.ts`.

**Step 4: Run test to verify it passes**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/cli.test.ts
```
Expected: PASS.

**Step 5: Commit**
```bash
git add \
  packages/eval/src/cli/aux-commands.ts \
  packages/eval/src/cli/index.ts \
  packages/eval/src/cli/options.ts \
  packages/eval/src/tests/cli.test.ts
git commit -m "Add draft-skill-case command"
```

---

### Task 4: Validate generated cases through the existing loader ✅ (implemented, tests passing, commit deferred pending approval)

**Files:**
- Modify: `packages/eval/src/tests/skill-case-scaffold.test.ts`
- Modify: `packages/eval/src/tests/loader.test.ts`

**Step 1: Add failing round-trip tests**
Generated scaffold should:
- stringify to YAML
- write to a temp file
- parse back through `parseYamlFile()`
- remain a valid `SkillEvalCase`
- preserve the intended assertion structure for both modes

Also add one loader-level assertion that a generated discover scaffold with both `tool_usage` and `skill_usage` parses cleanly.

**Step 2: Run test to verify it fails**
Run:
```bash
pnpm --dir packages/eval exec node --test \
  src/tests/skill-case-scaffold.test.ts \
  src/tests/loader.test.ts
```
Expected: FAIL if the scaffold shape is not loader-compatible.

**Step 3: Adjust generator output until round-trip passes**
Do not add loader special cases. Fix the scaffold output instead.

**Step 4: Run tests to verify they pass**
Run:
```bash
pnpm --dir packages/eval exec node --test \
  src/tests/skill-case-scaffold.test.ts \
  src/tests/loader.test.ts
```
Expected: PASS.

**Step 5: Commit**
```bash
git add \
  packages/eval/src/tests/skill-case-scaffold.test.ts \
  packages/eval/src/tests/loader.test.ts
git commit -m "Validate generated skill cases through loader"
```

---

### Task 5: Documentation ✅ (implemented, command examples verified, commit deferred pending approval)

**Files:**
- Modify: `README.md`
- Modify: `docs/skill-eval-plan.md`

**Step 1: Document the new command**
In `README.md` add:
- `draft-skill-case` command usage
- example invocations for stdout and `--out`
- note that v1 is deterministic and generates a scaffold, not a complete benchmark
- note that generated tasks describe the user goal and should be reviewed before committing

**Step 2: Document generation behavior**
In `docs/skill-eval-plan.md` add:
- how the command resolves a skills root
- when `input.skills_dir` is included in the generated case
- how tasks are derived from `SKILL.md`
- what assertions are generated by default
- JSON and terminal output behavior
- limitations of the scaffold approach

**Step 3: Verify docs examples**
Run:
```bash
pnpm --dir packages/eval run agent-eval draft-skill-case --skill write-judge-prompt --format json
```
Expected: valid JSON with scaffold metadata and case object.

Run:
```bash
pnpm --dir packages/eval run agent-eval draft-skill-case --skill write-judge-prompt
```
Expected: YAML on `stdout`, status on `stderr`.

**Step 4: Commit**
```bash
git add README.md docs/skill-eval-plan.md
git commit -m "Document skill case scaffold command"
```

---

### Task 6: End-to-end verification ✅ (focused tests, typecheck, scaffold generation, inspect, and invalid override verified; commit deferred pending approval)

**Files:**
- No new files required

**Step 1: Run focused tests**
```bash
pnpm --dir packages/eval exec node --test \
  src/tests/cli-options.test.ts \
  src/tests/cli-shared.test.ts \
  src/tests/skill-case-scaffold.test.ts \
  src/tests/loader.test.ts \
  src/tests/cli.test.ts
```

**Step 2: Run typecheck**
```bash
pnpm --dir packages/eval run typecheck
```

**Step 3: Generate one discover scaffold to stdout**
```bash
pnpm --dir packages/eval run agent-eval draft-skill-case \
  --skill write-judge-prompt \
  --mode discover
```

**Step 4: Generate one inject scaffold to file**
```bash
pnpm --dir packages/eval run agent-eval draft-skill-case \
  --skill write-judge-prompt \
  --mode inject \
  --out /tmp/write-judge-prompt.inject.eval.yaml
```

**Step 5: Parse the generated file through inspect**
```bash
pnpm --dir packages/eval run agent-eval inspect --file /tmp/write-judge-prompt.inject.eval.yaml
```

**Step 6: Verify explicit invalid override fails**
```bash
pnpm --dir packages/eval run agent-eval draft-skill-case \
  --skill write-judge-prompt \
  --skills-dir /definitely/missing/path
```
Expected: clear error, no silent fallback.

**Step 7: Optional manual smoke test**
If a real skill root and judge config are available, run one generated discover case end-to-end. Do not treat this as a required completion gate for the feature because it is environment-dependent and non-deterministic.

**Step 8: Commit**
```bash
git add \
  packages/eval/src/cli/index.ts \
  packages/eval/src/cli/options.ts \
  packages/eval/src/cli/helpers.ts \
  packages/eval/src/cli/shared.ts \
  packages/eval/src/cli/aux-commands.ts \
  packages/eval/src/skill-case-scaffold.ts \
  packages/eval/src/tests/cli-options.test.ts \
  packages/eval/src/tests/cli-shared.test.ts \
  packages/eval/src/tests/cli.test.ts \
  packages/eval/src/tests/skill-case-scaffold.test.ts \
  packages/eval/src/tests/loader.test.ts \
  README.md \
  docs/skill-eval-plan.md
git commit -m "Add skill case scaffold workflow"
```

---

## Notes

1. Prefer deterministic generation over LLM generation in v1.
2. Generate full cases, not just loose prompt text.
3. Reuse existing skill resolution and YAML machinery.
4. Keep the builder pure and keep filesystem access in the CLI layer.
5. Keep templates simple. Two modes only in v1.
6. Preserve portability by only writing `input.skills_dir` when the user explicitly requested it.
7. Negative-case synthesis and automatic `llm_judge` authoring are separate follow-ups.

## Execution Handoff

1. **Subagent-driven** - `/implement add draft-skill-case command`
2. **Manual execution** - use the nobody-executes-plans skill in a new session
