# Skill Case Generator Refactor Implementation Plan

**Goal:** Refactor the skill case generator to correctly separate meta-skills (evaluation methods) from user skills (evaluation targets), and use meta-skills to intelligently generate test cases.

**Architecture:** 
- Separate `skills_root` (user's skills to be evaluated) from `meta_skills_dir` (bundled evaluation method skills)
- Remove bundled fallback from `resolveSkillsRoot()` 
- Refactor `draft-skill-case` to invoke LLM with meta-skills for intelligent case generation

**Tech Stack:** TypeScript, Zod, existing @talesofai/agent-eval infrastructure

---

## Task 1: Define New Types and Constants

**Files:**
- Modify: `packages/eval/src/skills/index.ts`
- Modify: `packages/eval/src/types.ts`

**Step 1: Add META_SKILLS_DIR constant**

In `packages/eval/src/skills/index.ts`, rename and add:

```typescript
// Existing bundled skills are META skills (evaluation methods)
export const META_SKILLS_DIR = join(
  import.meta.dirname,
  "evals-skills",
  "skills",
);

// Remove or deprecate BUNDLED_SKILLS_DIR and SKILLS_DIR exports
// These are misleading - they suggest these are skills to be evaluated
```

**Step 2: Add MetaSkillSource type**

In `packages/eval/src/types.ts`, add:

```typescript
export type MetaSkillSource = "bundled";

export type SkillSourceKind = "cli" | "case" | "env" | "home";
// Remove "bundled" from SkillSourceKind - meta-skills are separate
```

**Step 3: Run typecheck**

Run: `cd packages/eval && pnpm typecheck`
Expected: Type errors in files using `BUNDLED_SKILLS_DIR` or `"bundled"` source

---

## Task 2: Update ResolvedSkillsRoot

**Files:**
- Modify: `packages/eval/src/skills/index.ts`

**Step 1: Remove bundled from resolveSkillsRoot candidates**

```typescript
export function resolveSkillsRoot(options: {
  cliSkillsDir?: string;
  caseSkillsDir?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): ResolvedSkillsRoot {
  // ... existing candidate logic ...
  
  pushCandidate("cli", options.cliSkillsDir);
  pushCandidate("case", options.caseSkillsDir);
  pushCandidate("env", envSkillsDir);
  pushCandidate("home", join(resolvedHomeDir, ".agents", "skills"));
  // REMOVE: pushCandidate("bundled", BUNDLED_SKILLS_DIR);

  if (candidates.length === 0) {
    throw new Error(
      `No skills root configured. Set --skills-dir, EVAL_SKILLS_DIR, or create ~/.agents/skills`
    );
  }
  // ...
}
```

**Step 2: Update ResolvedSkillsRoot type**

```typescript
export type ResolvedSkillsRoot = {
  source: SkillSourceKind;  // No longer includes "bundled"
  rootDir: string;
  canonicalRootDir: string;
};
```

**Step 3: Run typecheck**

Run: `cd packages/eval && pnpm typecheck`
Expected: More type errors to fix

---

## Task 3: Update Builtin Tools

**Files:**
- Modify: `packages/eval/src/runner/builtin-tools/read-file.ts`
- Modify: `packages/eval/src/runner/builtin-tools/list-dir.ts`
- Modify: `packages/eval/src/runner/builtin-tools/index.ts`

**Step 1: Remove default skillsDir parameter**

In `read-file.ts`:

```typescript
// Remove this default export
// export const readFileTool = createReadFileTool(BUNDLED_SKILLS_DIR);

// Keep only the factory function
export function createReadFileTool(skillsDir: string): BuiltinTool {
  // ... existing implementation ...
}
```

Same for `list-dir.ts`.

**Step 2: Update index.ts exports**

```typescript
export { createReadFileTool } from "./read-file.ts";
export { createListDirTool } from "./list-dir.ts";
// Remove exports of readFileTool, listDirTool
```

**Step 3: Verify runner passes skillsDir**

Check `packages/eval/src/runner/skill.ts` - it already calls:
```typescript
builtinTools: [
  createReadFileTool(resolvedRoot.rootDir),
  createListDirTool(resolvedRoot.rootDir),
],
```

This is correct - it uses the resolved skills root, not bundled.

---

## Task 4: Add Meta-Skills Loading Functions

**Files:**
- Modify: `packages/eval/src/skills/index.ts`

**Step 1: Add meta-skills functions**

```typescript
/**
 * List bundled meta-skills (evaluation methods).
 * These are skills used BY the evaluation framework, not skills being evaluated.
 */
export function listMetaSkills(): SkillMeta[] {
  return listSkillsFromRoot(META_SKILLS_DIR);
}

/**
 * Load a meta-skill by name.
 * Used by draft-skill-case to generate intelligent test cases.
 */
export function loadMetaSkillContent(skillName: string): string {
  return loadSkillContentFromRoot(META_SKILLS_DIR, skillName);
}
```

**Step 2: Export from index**

```typescript
export {
  META_SKILLS_DIR,
  listMetaSkills,
  loadMetaSkillContent,
} from "./skills/index.ts";
```

---

## Task 5: Refactor draftSkillCaseCommand

**Files:**
- Modify: `packages/eval/src/skill-case-scaffold.ts`
- Modify: `packages/eval/src/cli/aux-commands.ts`

**Step 1: Create new intelligent case generator**

In `packages/eval/src/skill-case-scaffold.ts`, add:

```typescript
import { loadMetaSkillContent, META_SKILLS_DIR } from "./skills/index.ts";

export type GenerateCaseInput = {
  skillName: string;
  skillContent: string;
  mode: "inject" | "discover";
  model?: string;
  skillsDir: string;
};

export type GeneratedCase = {
  id: string;
  description: string;
  input: {
    skill: string;
    model: string;
    evaluation_mode: "inject" | "discover";
    task: string;
    skills_dir?: string;
  };
  criteria: {
    assertions: AssertionConfig[];
  };
};

/**
 * Generate an intelligent skill eval case using meta-skills.
 * Uses error-analysis and write-judge-prompt to create meaningful test cases.
 */
export async function generateSkillCase(
  input: GenerateCaseInput,
  opts: { llmClient: LLMClient },  // Need to define this interface
): Promise<GeneratedCase> {
  // 1. Load relevant meta-skills
  const errorAnalysisSkill = loadMetaSkillContent("error-analysis");
  const writeJudgeSkill = loadMetaSkillContent("write-judge-prompt");
  
  // 2. Build prompt for LLM
  const systemPrompt = buildCaseGeneratorPrompt({
    metaSkills: { errorAnalysis: errorAnalysisSkill, writeJudge: writeJudgeSkill },
    targetSkill: input.skillContent,
  });
  
  // 3. Call LLM to generate case
  const response = await opts.llmClient.generate({
    systemPrompt,
    userMessage: `Generate a ${input.mode} mode eval case for skill "${input.skillName}"`,
  });
  
  // 4. Parse and validate response
  return parseGeneratedCase(response, input);
}
```

**Step 2: Update aux-commands.ts**

```typescript
import { generateSkillCase } from "../skill-case-scaffold.ts";

export async function draftSkillCaseCommand(
  options: DraftSkillCaseCommandOptions,
): Promise<number> {
  // ... validation logic ...
  
  // Load user's skill
  const skillContent = loadSkillContentFromRoot(resolvedRoot.rootDir, options.skill);
  
  // Generate intelligent case using meta-skills
  const generatedCase = await generateSkillCase({
    skillName: options.skill,
    skillContent,
    mode: options.mode,
    model: options.model,
    skillsDir: resolvedRoot.rootDir,
  }, { llmClient });  // Need to create/use LLM client
  
  // Output YAML
  const yaml = YAML.stringify(generatedCase);
  // ... write to file or stdout ...
}
```

**Step 3: Create LLM client integration**

Need to add LLM client for case generation. This could use the existing model resolution:

```typescript
import { resolveModel } from "../models/index.ts";

async function createCaseGeneratorLLM() {
  const model = resolveModel("deepseek/deepseek-chat");
  // Use existing inference infrastructure
}
```

---

## Task 6: Update Tests

**Files:**
- Modify: `packages/eval/src/tests/skills-index.test.ts`
- Add: `packages/eval/src/tests/skill-case-scaffold.test.ts`

**Step 1: Update resolveSkillsRoot tests**

Remove test for bundled fallback:

```typescript
// REMOVE this test:
// it("uses bundled root when no override roots exist", () => { ... });

// ADD this test:
it("throws when no skills root is configured", () => {
  assert.throws(
    () => resolveSkillsRoot({ env: {}, homeDir: "/nonexistent" }),
    { message: /No skills root configured/ }
  );
});
```

**Step 2: Update tests using BUNDLED_SKILLS_DIR**

Replace `BUNDLED_SKILLS_DIR` with `META_SKILLS_DIR` where appropriate, or use temp directories for testing.

**Step 3: Add tests for generateSkillCase**

```typescript
describe("generateSkillCase", () => {
  it("generates inject mode case with intelligent task", async () => {
    // Mock LLM response
    // Verify generated case structure
  });
  
  it("generates discover mode case with tool_usage assertions", async () => {
    // ...
  });
});
```

---

## Task 7: Update CLI Doctor

**Files:**
- Modify: `packages/eval/src/cli/shared.ts`

**Step 1: Update doctor check message**

```typescript
{
  key: "EVAL_SKILLS_DIR",
  requiredFor: "skill case evaluation",
  hint: "Set EVAL_SKILLS_DIR or use --skills-dir. Skills root is required for skill eval cases.",
  ok: isSet("EVAL_SKILLS_DIR") || /* check ~/.agents/skills exists */,
  optional: false,  // Was optional, now required for skill cases
}
```

---

## Task 8: Update Documentation

**Files:**
- Add: `packages/eval/src/skills/evals-skills/README.md`

**Step 1: Document meta-skills**

```markdown
# Meta-Skills (Evaluation Methods)

These skills are used BY the evaluation framework to generate test cases.

- `error-analysis`: Identify and categorize failure modes in LLM pipelines
- `write-judge-prompt`: Design LLM-as-Judge evaluators
- `validate-evaluator`: Validate evaluator alignment with human labels
- `generate-synthetic-data`: Generate synthetic test data
- `evaluate-rag`: Evaluate RAG systems
- `build-review-interface`: Build human review interfaces

## Usage

These are NOT skills to be evaluated. They are tools used by `draft-skill-case` 
to intelligently generate test cases for YOUR skills.
```

---

## Verification

After all tasks:

1. Run: `cd packages/eval && pnpm typecheck` - no errors
2. Run: `cd packages/eval && pnpm test` - all pass
3. Run: `agent-eval draft-skill-case --skill my-skill` without skills-dir - should error with helpful message
4. Run: `agent-eval draft-skill-case --skill my-skill --skills-dir ~/.agents/skills` - should generate intelligent case

---

## Commit Strategy

- Task 1-2: `refactor: separate skills_root from meta_skills`
- Task 3-4: `refactor: remove bundled fallback from skills resolution`
- Task 5: `feat: use meta-skills for intelligent case generation`
- Task 6-7: `test: update tests for skills refactor`
- Task 8: `docs: document meta-skills purpose`
