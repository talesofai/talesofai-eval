# Skill Source Resolution UX Implementation Plan

**Goal:** Make `type: skill` evals resolve skills from real user-installed locations by default, especially `~/.agents/skills`, without requiring users to copy skills into the project source tree.
**Architecture:** Replace the hardcoded `SKILLS_DIR` runtime dependency with a resolver that chooses one concrete skills root per run using an explicit precedence order: CLI override, case override, env override, `~/.agents/skills`, then bundled fixtures. Keep the existing sandboxed `read` and `ls` design, but bind those builtin tools to the resolved root for the current run and record the resolved source in the trace for auditability.
**Tech Stack:** TypeScript, Node.js built-ins (`fs`, `path`, `os`), Zod, YAML loader, existing eval runner and Node test runner.

## Progress

- [x] Task 1: Add configurable skill source resolution ✅
- [x] Task 2: Add case-level and CLI-level skill root overrides ✅
- [x] Task 3: Bind builtin `read` and `ls` to the resolved skills root ✅
- [ ] Task 4: Record resolved skill provenance in traces
- [ ] Task 5: Update doctor output, docs, and end-to-end cases
- [ ] Task 6: Full verification

## Design Decisions

1. **Default UX must match installed skills**
   - If a user runs `agent-eval run --file case.yaml`, skill lookup should work against `~/.agents/skills` with no copy step.
2. **One resolved root per run**
   - For a given skill case, resolve one root directory up front. `discover` mode lists from that root. `inject` mode loads from that root. Builtin `read` and `ls` also sandbox to that same root.
3. **Precedence order**
   - `--skills-dir` CLI override
   - `input.skills_dir` in YAML
   - `EVAL_SKILLS_DIR`
   - `~/.agents/skills`
   - bundled fixture root `packages/eval/src/skills/evals-skills/skills`
4. **Trace provenance is required**
   - Skill traces must record which source won, what root was used, and which skill path was loaded. Without this, terminal UX improves but replay and debugging get weaker.
5. **Bundled fixtures remain**
   - Do not delete the bundled fixture directory. Keep it as the final fallback and as the main test fixture root.

---

### Task 1: Add configurable skill source resolution

**Files:**
- Modify: `packages/eval/src/config.ts`
- Modify: `packages/eval/src/skills/index.ts`
- Test: `packages/eval/src/tests/env.test.ts`
- Test: `packages/eval/src/tests/skills-index.test.ts`

**Step 1: Write the failing env resolver test**
Add tests in `packages/eval/src/tests/env.test.ts` for:
- `resolveSkillsDir({ EVAL_SKILLS_DIR: "/tmp/custom-skills" })` returning that path
- `resolveSkillsDir({ EVAL_SKILLS_DIR: "   " })` returning `undefined`

Example assertions:
```ts
assert.equal(
  resolveSkillsDir({ EVAL_SKILLS_DIR: "/tmp/custom-skills" }),
  "/tmp/custom-skills",
);
assert.equal(resolveSkillsDir({ EVAL_SKILLS_DIR: "   " }), undefined);
```

**Step 2: Run test to verify it fails**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/env.test.ts
```
Expected: FAIL with `resolveSkillsDir is not a function` or equivalent import error.

**Step 3: Implement the env resolver**
Add a new config key and resolver in `packages/eval/src/config.ts`:
```ts
export const ENV_KEYS = {
  // ...existing keys...
  SKILLS_DIR: "EVAL_SKILLS_DIR",
} as const;

export function resolveSkillsDir(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return readEnvValue(env, ENV_KEYS.SKILLS_DIR);
}
```

**Step 4: Write the failing skills resolver tests**
In `packages/eval/src/tests/skills-index.test.ts`, add tests for a new resolver API, for example:
- explicit root wins over fallback roots
- home root is used when present
- bundled root is used when nothing else exists
- missing root list throws a clear error

Use temp directories instead of the real home directory.

**Step 5: Run test to verify it fails**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/skills-index.test.ts
```
Expected: FAIL with missing exports such as `resolveSkillSource` or `listSkillsFromRoot`.

**Step 6: Refactor `skills/index.ts` around an explicit root**
Replace the runtime hardcoding model with these exports:
```ts
export const BUNDLED_SKILLS_DIR = join(import.meta.dirname, "evals-skills", "skills");

export type SkillSourceKind = "cli" | "case" | "env" | "home" | "bundled";

export type ResolvedSkillsRoot = {
  source: SkillSourceKind;
  rootDir: string;
  canonicalRootDir: string;
};

export function resolveSkillsRoot(options: {
  cliSkillsDir?: string;
  caseSkillsDir?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): ResolvedSkillsRoot;

export function listSkillsFromRoot(rootDir: string): SkillMeta[];
export function loadSkillContentFromRoot(rootDir: string, skillName: string): string;
```

Implementation rules:
- canonicalize the chosen root with `realpathSync`
- require the root to exist and be a directory before accepting it
- use `homedir()` only inside the resolver, not in tests directly
- keep `listSkills()` and `loadSkillContent()` only as thin bundled-fixture wrappers if needed for backward compatibility in tests, otherwise remove them

**Step 7: Run tests to verify they pass**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/env.test.ts src/tests/skills-index.test.ts
```
Expected: PASS for the new resolver coverage and all existing skills index cases.

**Step 8: Commit**
```bash
git add packages/eval/src/config.ts packages/eval/src/skills/index.ts packages/eval/src/tests/env.test.ts packages/eval/src/tests/skills-index.test.ts
git commit -m "feat(eval): resolve skill roots from user and env locations"
```

---

### Task 2: Add case-level and CLI-level skill root overrides

**Files:**
- Modify: `packages/eval/src/types.ts`
- Modify: `packages/eval/src/loader/yaml.ts`
- Modify: `packages/eval/src/cli/index.ts`
- Modify: `packages/eval/src/cli/options.ts`
- Modify: `packages/eval/src/cli/command-utils.ts`
- Test: `packages/eval/src/tests/cli-options.test.ts`
- Test: `packages/eval/src/tests/loader.test.ts`

**Step 1: Write the failing CLI option tests**
Add tests in `packages/eval/src/tests/cli-options.test.ts` for:
- `parseRunCommandOptions({ skillsDir: "~/.agents/skills" })`
- `parseMatrixCommandOptions({ skillsDir: "/tmp/skills", variant: ... })`

Example assertions:
```ts
assert.equal(parsed.skillsDir, "~/.agents/skills");
```

**Step 2: Run test to verify it fails**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/cli-options.test.ts
```
Expected: FAIL because `skillsDir` is not yet parsed.

**Step 3: Extend CLI parsing**
Update `packages/eval/src/cli/options.ts`:
- add `skillsDir?: string` to `RunCommandOptions` and `MatrixCommandOptions`
- accept `--skills-dir <path>` in parser schemas
- return normalized `skillsDir`

Update `packages/eval/src/cli/index.ts`:
```ts
.option("--skills-dir <path>", "Override skills root directory for skill cases")
```
for `run` and `matrix`.

**Step 4: Write the failing YAML loader tests**
Add loader tests for:
- `type: skill` accepting `input.skills_dir`
- parsed case preserving `skills_dir`

Example case fragment:
```yaml
input:
  skill: test-skill
  model: gpt-4o-mini
  task: hello
  skills_dir: ~/.agents/skills
```

**Step 5: Run test to verify it fails**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/loader.test.ts
```
Expected: FAIL with schema validation error for unknown or missing `skills_dir` support.

**Step 6: Extend case types and schemas**
Update `packages/eval/src/types.ts`:
```ts
export type SkillEvalCase = {
  type: "skill";
  id: string;
  description: string;
  input: {
    skill: string;
    model: string;
    task: string;
    skills_dir?: string;
    fixtures?: Record<string, unknown>;
    system_prompt_prefix?: string;
    evaluation_mode?: "inject" | "discover";
  };
  criteria: EvalCriteria;
};
```

Update `packages/eval/src/loader/yaml.ts` to accept:
```ts
skills_dir: z.string().optional(),
```

**Step 7: Thread CLI override into runner options**
Update `packages/eval/src/types.ts`:
```ts
export type RunnerOptions = {
  mcpServerBaseURL: string;
  skillsDir?: string;
  // ...existing callbacks...
};
```

Update `packages/eval/src/cli/command-utils.ts`:
```ts
export function createRunnerOptions(options: {
  reporter: Reporter;
  mcpServerBaseURL: string;
  skillsDir?: string;
}): RunnerOptions {
  return {
    mcpServerBaseURL: options.mcpServerBaseURL,
    ...(options.skillsDir ? { skillsDir: options.skillsDir } : {}),
    onDelta: (delta) => options.reporter.onDelta(delta),
    onToolStart: (call) => options.reporter.onToolStart(call),
    onToolCall: (call) => options.reporter.onToolCall(call),
  };
}
```

Update `run-command.ts` and `matrix-command.ts` to pass `skillsDir: options.skillsDir` into `createRunnerOptions(...)`.

**Step 8: Run tests to verify they pass**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/cli-options.test.ts src/tests/loader.test.ts
```
Expected: PASS with parsed CLI and YAML support.

**Step 9: Commit**
```bash
git add packages/eval/src/types.ts packages/eval/src/loader/yaml.ts packages/eval/src/cli/index.ts packages/eval/src/cli/options.ts packages/eval/src/cli/command-utils.ts packages/eval/src/cli/run-command.ts packages/eval/src/cli/matrix-command.ts packages/eval/src/tests/cli-options.test.ts packages/eval/src/tests/loader.test.ts
git commit -m "feat(eval): allow skill root overrides from yaml and cli"
```

---

### Task 3: Bind builtin `read` and `ls` to the resolved skills root

**Files:**
- Modify: `packages/eval/src/runner/builtin-tools/read-file.ts`
- Modify: `packages/eval/src/runner/builtin-tools/list-dir.ts`
- Modify: `packages/eval/src/runner/builtin-tools/index.ts`
- Modify: `packages/eval/src/runner/skill.ts`
- Test: `packages/eval/src/tests/builtin-tools.test.ts`
- Test: `packages/eval/src/tests/tool-executor.test.ts`
- Test: `packages/eval/src/tests/skill-runner.test.ts`

**Step 1: Write the failing builtin-tool factory tests**
Refactor tests to expect factory functions, for example:
```ts
const readTool = createReadFileTool(tempSkillsRoot);
const listTool = createListDirTool(tempSkillsRoot);
```
Add one explicit test proving the tool reads from a temp root that is not the bundled fixture directory.

**Step 2: Run test to verify it fails**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/builtin-tools.test.ts src/tests/tool-executor.test.ts src/tests/skill-runner.test.ts
```
Expected: FAIL because `createReadFileTool` and `createListDirTool` do not exist yet.

**Step 3: Refactor builtin tools into factories**
In `packages/eval/src/runner/builtin-tools/read-file.ts`:
```ts
export function createReadFileTool(skillsDir: string): BuiltinTool {
  let canonicalSkillsDir: string | null = null;
  const getCanonicalSkillsDir = (): string => {
    if (canonicalSkillsDir === null) {
      canonicalSkillsDir = realpathSync(skillsDir);
    }
    return canonicalSkillsDir;
  };

  return {
    name: "read",
    description: "Read a file from the skills directory by relative path.",
    parameters: Type.Object({
      path: Type.String({
        description: "Relative path to the file within the skills directory",
      }),
    }),
    execute: (args) => {
      // same validation logic, but join against skillsDir
    },
  };
}
```

In `packages/eval/src/runner/builtin-tools/list-dir.ts` implement the symmetric `createListDirTool(skillsDir: string)`.

In `packages/eval/src/runner/builtin-tools/index.ts` export the factories.

**Step 4: Resolve the root inside `runSkill` and instantiate tools per run**
Update `packages/eval/src/runner/skill.ts` to:
- resolve one root via `resolveSkillsRoot({ cliSkillsDir: opts.skillsDir, caseSkillsDir: evalCase.input.skills_dir })`
- use `listSkillsFromRoot(root.rootDir)` and `loadSkillContentFromRoot(root.rootDir, skillName)`
- instantiate builtin tools with that root:
```ts
const sandboxTools = [
  createReadFileTool(root.rootDir),
  createListDirTool(root.rootDir),
];
```
- remove the module-level `SANDBOX_TOOLS` constant

**Step 5: Keep discover semantics unchanged**
`buildDiscoverSystemPrompt()` should still say:
- use `ls` to explore
- use `read` with relative paths from the root

No prompt changes beyond keeping examples accurate.

**Step 6: Run tests to verify they pass**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/builtin-tools.test.ts src/tests/tool-executor.test.ts src/tests/skill-runner.test.ts
```
Expected: PASS, including tests that now operate on non-bundled temp roots.

**Step 7: Commit**
```bash
git add packages/eval/src/runner/builtin-tools/read-file.ts packages/eval/src/runner/builtin-tools/list-dir.ts packages/eval/src/runner/builtin-tools/index.ts packages/eval/src/runner/skill.ts packages/eval/src/tests/builtin-tools.test.ts packages/eval/src/tests/tool-executor.test.ts packages/eval/src/tests/skill-runner.test.ts
git commit -m "refactor(eval): bind skill builtin tools to resolved roots"
```

---

### Task 4: Record resolved skill provenance in traces

**Files:**
- Modify: `packages/eval/src/types.ts`
- Modify: `packages/eval/src/traces.ts`
- Modify: `packages/eval/src/runner/skill.ts`
- Test: `packages/eval/src/tests/traces.test.ts`
- Test: `packages/eval/src/tests/skill-runner.test.ts`

**Step 1: Write the failing trace validation tests**
Add tests in `packages/eval/src/tests/traces.test.ts` for a `skill` trace containing:
```ts
skill_resolution: {
  source: "home",
  root_dir: "/home/test/.agents/skills",
  skill_name: "write-judge-prompt",
  skill_path: "/home/test/.agents/skills/write-judge-prompt/SKILL.md",
}
```

Add a negative test where `skill_resolution` is malformed.

**Step 2: Run test to verify it fails**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/traces.test.ts
```
Expected: FAIL because trace validation ignores or rejects the new field.

**Step 3: Extend trace types**
In `packages/eval/src/types.ts` add:
```ts
export type SkillResolutionTrace = {
  source: "cli" | "case" | "env" | "home" | "bundled";
  root_dir: string;
  skill_name: string;
  skill_path: string;
};

export type EvalTrace = {
  // ...existing fields...
  skill_resolution?: SkillResolutionTrace;
};
```

**Step 4: Validate the field in `traces.ts`**
Extend `isEvalTrace()` with a helper that accepts absent `skill_resolution`, but when present requires all fields to be strings and `source` to be one of the allowed literals.

**Step 5: Attach the field in `runSkill`**
After building the trace, patch in provenance:
```ts
const trace = buildSuccessTrace(...);
return {
  ...trace,
  skill_resolution: {
    source: resolvedRoot.source,
    root_dir: resolvedRoot.rootDir,
    skill_name: skillName,
    skill_path: join(resolvedRoot.rootDir, skillName, "SKILL.md"),
  },
};
```
Do the same for error traces after root resolution succeeds.

**Step 6: Run tests to verify they pass**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/traces.test.ts src/tests/skill-runner.test.ts
```
Expected: PASS with round-trip trace loading for skill provenance.

**Step 7: Commit**
```bash
git add packages/eval/src/types.ts packages/eval/src/traces.ts packages/eval/src/runner/skill.ts packages/eval/src/tests/traces.test.ts packages/eval/src/tests/skill-runner.test.ts
git commit -m "feat(eval): record resolved skill source in traces"
```

---

### Task 5: Update doctor output, docs, and end-to-end cases

**Files:**
- Modify: `packages/eval/src/cli/shared.ts`
- Modify: `docs/skill-eval-plan.md`
- Modify: existing or new `packages/eval/cases/skills/**/*.eval.yaml`
- Test: `packages/eval/src/tests/cli-shared.test.ts`

**Step 1: Write the failing doctor check test**
Add a test that `collectDoctorChecks()` includes `EVAL_SKILLS_DIR` as an optional UX hint for skill runs.

**Step 2: Run test to verify it fails**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/cli-shared.test.ts
```
Expected: FAIL because the check is not present.

**Step 3: Add doctor guidance**
Update `packages/eval/src/cli/shared.ts` with a new optional check:
```ts
{
  key: "EVAL_SKILLS_DIR",
  requiredFor: "skill run",
  ok: isSet("EVAL_SKILLS_DIR"),
  hint: "Optional: override skill lookup root. By default skill evals will try ~/.agents/skills, then bundled fixtures.",
  optional: true,
}
```

**Step 4: Update docs**
Update `docs/skill-eval-plan.md` to describe the actual shipped UX:
- default root search order
- `--skills-dir`
- `input.skills_dir`
- `EVAL_SKILLS_DIR`
- `~/.agents/skills` compatibility
- trace provenance field

**Step 5: Add or update one real-world-ready case**
Adapt a skill case to rely on name-based resolution only, with no project-local copy assumption. Example:
```yaml
type: skill
id: skill-user-installed-discover
input:
  skill: write-judge-prompt
  model: gpt-4o-mini
  evaluation_mode: discover
  task: |
    Use the relevant skill for this request. Inspect the skill first and summarize its required workflow.
criteria:
  assertions:
    - type: tool_usage
      tier: 1
      expected_tools: ["ls", "read"]
```

**Step 6: Run focused tests and docs sanity check**
Run:
```bash
pnpm --dir packages/eval exec node --test src/tests/cli-shared.test.ts
```
Expected: PASS.

**Step 7: Commit**
```bash
git add packages/eval/src/cli/shared.ts docs/skill-eval-plan.md packages/eval/cases/skills packages/eval/src/tests/cli-shared.test.ts
git commit -m "docs(eval): document user-installed skill resolution"
```

---

### Task 6: Full verification

**Files:**
- Verify only

**Step 1: Run full package tests**
Run:
```bash
pnpm --dir packages/eval test
```
Expected: PASS.

**Step 2: Run typecheck**
Run:
```bash
pnpm --dir packages/eval run typecheck
```
Expected: PASS.

**Step 3: Run doctor in terminal format**
Run:
```bash
pnpm --dir packages/eval run agent-eval doctor --format terminal
```
Expected: terminal output includes normal config checks and the new optional skill-root guidance.

**Step 4: Run one terminal-format skill eval against a user-style root**
Prepare a temp or real skills root, then run:
```bash
pnpm --dir packages/eval run agent-eval run \
  --file cases/skills/write-judge-prompt/discover-tone-mismatch.eval.yaml \
  --skills-dir ~/.agents/skills \
  --format terminal \
  --verbose
```
Expected:
- terminal output shows a normal case run
- assistant calls `ls` and `read`
- no project-local copy step is required
- saved trace contains `skill_resolution`

**Step 5: Commit final verification state**
```bash
git add -A
git commit -m "test(eval): verify user-installed skill resolution flow"
```

---

## Notes for the implementer

- Do not let builtin `read` and `ls` inspect multiple roots at once. Resolve one root first, then sandbox to it.
- Keep the security posture unchanged: canonicalize with `realpathSync`, reject path traversal, reject symlink escapes.
- Prefer small compatibility wrappers over large rewrites. For example, `listSkills()` can call `listSkillsFromRoot(BUNDLED_SKILLS_DIR)` if other tests still rely on it.
- If a chosen root exists but the requested skill is missing, the error should say which root was searched.
- If no root can be resolved, return a clear runner error that lists the checked locations.

## Recommended execution order

1. Task 1
2. Task 2
3. Task 3
4. Task 4
5. Task 5
6. Task 6

## Execution handoff

1. **Subagent-driven**: `/implement skill source resolution UX`
2. **Manual execution**: use the nobody-executes-plans skill in a new session
