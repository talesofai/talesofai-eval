# Meta-Skills (Evaluation Methods)

These skills are used BY the evaluation framework to generate test cases and perform evaluations.

## Available Meta-Skills

- `error-analysis`: Identify and categorize failure modes in LLM pipelines
- `write-judge-prompt`: Design LLM-as-Judge evaluators
- `validate-evaluator`: Validate evaluator alignment with human labels
- `generate-synthetic-data`: Generate synthetic test data
- `evaluate-rag`: Evaluate RAG systems
- `build-review-interface`: Build human review interfaces

## Purpose

These are NOT skills to be evaluated. They are tools used by `draft-skill-case` to intelligently generate test cases for YOUR skills.

## Usage

```typescript
import { listMetaSkills, loadMetaSkillContent } from "@talesofai/agent-eval";

// List all available meta-skills
const metaSkills = listMetaSkills();

// Load a specific meta-skill
const errorAnalysisSkill = loadMetaSkillContent("error-analysis");
```

## Separation from User Skills

- **User skills** (`skills_root`): Skills in `~/.agents/skills` or configured via `--skills-dir`/`EVAL_SKILLS_DIR`. These are the skills being evaluated.
- **Meta-skills** (`META_SKILLS_DIR`): Bundled skills in this directory. These are tools used BY the evaluation framework.
