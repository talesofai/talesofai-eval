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

## `draft-skill-case`

Use `agent-eval draft-skill-case` to generate a deterministic `type: skill` eval case scaffold from one target `SKILL.md`.

Examples:

```bash
# YAML to stdout
agent-eval draft-skill-case --skill write-judge-prompt

# Write YAML to a file
agent-eval draft-skill-case \
  --skill write-judge-prompt \
  --mode inject \
  --out /tmp/write-judge-prompt.inject.eval.yaml

# JSON metadata + generated case object
agent-eval draft-skill-case --skill write-judge-prompt --format json
```

### Skills root resolution

The command resolves one skills root with the same precedence as skill execution:

1. explicit `--skills-dir`
2. `EVAL_SKILLS_DIR`
3. `~/.agents/skills`
4. bundled fixtures

If `--skills-dir` is passed, it is validated first. Invalid explicit paths fail immediately. The command does not silently fall back to env, home, or bundled roots when that override is invalid.

### Generated `input.skills_dir`

The generated case only includes `input.skills_dir` when the user explicitly passed `--skills-dir`.

This keeps generated files portable by default while still preserving an intentional explicit override.

### Task derivation

Task generation is deterministic and goal-oriented:

1. prefer the first stable example-like request found in the skill markdown
2. otherwise derive from frontmatter `description`
3. otherwise derive from the first strong heading
4. otherwise fall back to a generic text-output request

The generated task:
- does not mention the skill name
- does not tell the agent to load or use a skill
- describes the end-user goal only

### Default assertions

`discover` mode generates:

```yaml
criteria:
  assertions:
    - type: tool_usage
      tier: 1
      expected_tools: [ls, read]
    - type: skill_usage
      tier: 2
      checks: [skill_loaded, workflow_followed, skill_influenced_output]
      pass_threshold: 0.7
```

`inject` mode generates:

```yaml
criteria:
  assertions:
    - type: skill_usage
      tier: 2
      checks: [workflow_followed, skill_influenced_output]
      pass_threshold: 0.7
```

### Output behavior

Terminal mode:
- without `--out`: print YAML to `stdout`, status and resolved-root metadata to `stderr`
- with `--out`: write the file, print status to `stderr`, and do not also print YAML to `stdout`

JSON mode:
- without `--out`: print the generated case object plus `suggested_output`, `skills_source`, and `skills_root`
- with `--out`: print the generated case object plus actual `output`, `skills_source`, and `skills_root`
- validation failures use the normal structured CLI error format

### Limitations

V1 intentionally does not:
- generate negative or adversarial cases
- write custom `llm_judge` prompts
- use LLM-based generation
- add loader special-casing for generated files

It generates a starting scaffold. Review the task and assertions before treating the case as benchmark-ready.
