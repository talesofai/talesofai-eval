# Skill Eval

## Shipped skill source resolution

Skill evals now resolve one concrete skills root per run with this precedence order:

1. `--skills-dir`
2. `input.skills_dir`
3. `EVAL_SKILLS_DIR`
4. `~/.agents/skills`
5. bundled fixtures at `packages/eval/src/skills/evals-skills/skills`

The first existing directory wins. The runner canonicalizes it and uses that single root for:

- skill discovery
- skill content loading
- builtin `ls`
- builtin `read`

It does not merge multiple roots in one run.

## CLI override

Use `--skills-dir <path>` on `agent-eval run` and `agent-eval matrix` to force the skills root for skill cases.

Example:

```bash
agent-eval run --file cases/skills/write-judge-prompt/discover-tone-mismatch.eval.yaml --skills-dir ~/.agents/skills
```

## YAML override

Skill cases can set `input.skills_dir`:

```yaml
type: skill
id: skill-user-installed-discover
description: Discover a user-installed skill
input:
  skill: write-judge-prompt
  model: gpt-4o-mini
  evaluation_mode: discover
  skills_dir: ~/.agents/skills
  task: |
    Use the relevant skill for this request. Inspect the skill first and summarize its required workflow.
criteria:
  assertions:
    - type: tool_usage
      tier: 1
      expected_tools: ["ls", "read"]
```

## Environment override

Set `EVAL_SKILLS_DIR` to override skill lookup globally for eval runs:

```bash
export EVAL_SKILLS_DIR=~/.agents/skills
```

The doctor output now includes this as an optional hint for skill runs.

## Default user-installed compatibility

If no override is provided, skill evals try `~/.agents/skills` before bundled fixtures. This matches the default user-installed layout without requiring project-local copies.

## Trace provenance

Skill traces may include `skill_resolution`:

```json
{
  "skill_resolution": {
    "source": "home",
    "root_dir": "/home/test/.agents/skills",
    "skill_name": "write-judge-prompt",
    "skill_path": "/home/test/.agents/skills/write-judge-prompt/SKILL.md",
    "skill_content": "---\nname: write-judge-prompt\n..."
  }
}
```

`source` is one of:

- `cli`
- `case`
- `env`
- `home`
- `bundled`

This records which source won, which concrete skill file the runner resolved, and the exact skill snapshot used during the run.

## Skill usage scoring

`skill_usage` is a dedicated assertion for evaluating whether the agent actually used the target skill instead of only producing a plausible answer.

Supported checks:

- `skill_loaded`: deterministic trace inspection of a successful `read` on `<skill-name>/SKILL.md`
- `workflow_followed`: judge-based evaluation of whether the agent followed the skill workflow
- `skill_influenced_output`: judge-based evaluation of whether the final output reflects the skill content

Mode applicability:

- `discover`: all three checks apply
- `inject`: only `workflow_followed` and `skill_influenced_output` apply

Scoring rules:

- `skill_loaded` short-circuits failure when requested and not satisfied
- semantic checks use the embedded `skill_content` snapshot first
- filesystem fallback is only for backward compatibility with older traces that do not have `skill_content`

This keeps replay stable even if the external skills directory changes after the original run.
