# agent-eval

Evaluation toolkit for LLM completions and agent traces. Write test cases as YAML, run them against any model defined in your `models.json` registry, and score results with rule-based assertions or LLM-as-a-judge.

```
agent-eval run --file my-case.eval.yaml
agent-eval run --case all
agent-eval matrix --case my-case --variant "gpt4o=gpt-4o" --variant "mini=gpt-4o-mini"
agent-eval diff --case my-case --base '{"model":"gpt-4o"}' --candidate '{"model":"gpt-4o-mini"}'
```

---

## Table of Contents

- [How it works](#how-it-works)
- [Install](#install)
- [Configure](#configure)
  - [Minimal config](#minimal-config-plain-cases-only)
  - [Full config](#full-config-agent-cases--multi-judge)
  - [Verify your setup](#verify-your-setup)
  - [Model registry](#model-registry)
- [Quick start](#quick-start)
- [Case format](#case-format)
  - [Plain case](#plain-case)
  - [Agent case](#agent-case)
- [Assertions reference](#assertions-reference)
- [Commands](#commands)
- [Advanced](#advanced)
  - [Record & replay](#record--replay)
  - [Matrix evaluation](#matrix-evaluation)
  - [A/B diff](#ab-diff)
  - [Multi-model judging](#multi-model-judging)
  - [Import online cases](#import-online-cases)
- [Environment variables](#environment-variables)
- [Exit codes](#exit-codes)

---

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│                        agent-eval run                        │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────────────────────┐
│  Load cases     │     │  .eval.yaml file  OR             │
│  (.eval.yaml,   │────▶│  --inline JSON    OR             │
│  built-in, CLI) │     │  --case <id>      OR             │
└─────────────────┘     │  --file <glob>                   │
         │              └──────────────────────────────────┘
         ▼
┌─────────────────┐
│  Run each case  │  plain  → OpenAI-compatible chat completion
│  (runner)       │  agent  → Full agent loop with MCP tools
└─────────────────┘
         │  EvalTrace (conversation + tool calls)
         ▼
┌─────────────────┐
│  Score trace    │  tier 1: rule-based (tool_usage, final_status)
│  (scorers)      │  tier 2: LLM-as-a-judge (llm_judge, task_success)
└─────────────────┘  tier 3: human review flag
         │  EvalResult (passed/failed + per-dimension scores)
         ▼
┌─────────────────┐
│  Report         │  terminal output + optional HTML report
└─────────────────┘
```

**Two case types:**

| Type | What it does | Required config |
|------|-------------|-----------------|
| `plain` | Sends messages to a chat completion endpoint; scores the response | `models.json` with the model used in the case |
| `agent` | Runs a full agent loop with MCP tool calls; scores the full trace | Same + `EVAL_MCP_*` when your MCP server requires auth/override |

---

## Install

### Step 1: Configure npm for GitHub Packages

This package is published to GitHub Packages. Add this to your `~/.npmrc`:

```bash
echo "@talesofai:registry=https://npm.pkg.github.com" >> ~/.npmrc
```

If you're installing in a CI environment or want project-level config, create `.npmrc` in your project root:

```
@talesofai:registry=https://npm.pkg.github.com
```

### Step 2: Install the package

```bash
# Global install (recommended for CLI usage)
npm install -g @talesofai/agent-eval

# Or as a project dependency
npm install @talesofai/agent-eval
```

### Step 3: Verify installation

```bash
agent-eval --version
```

### From source

If you want to contribute or need the latest unreleased changes:

```bash
git clone https://github.com/talesofai/talesofai-eval.git
cd talesofai-eval
pnpm install
pnpm build
pnpm agent-eval --version
```

### Next steps

1. Create a `models.json` file in your project (see [Model registry](#model-registry))
2. Set up your `.env` with API keys (see [Configure](#configure))
3. Run `agent-eval doctor` to verify everything works

> ⚠️ The CLI command is `agent-eval`, not `eval`. The latter is a shell built-in that silently does nothing.

---

## Configure

Copy the example env file and fill in your credentials:

```bash
cp packages/eval/.env.example .env   # from source
# or create .env manually in your working directory
```

The tool auto-discovers `.env` and `.env.local` by walking up from the working directory. `.env.local` takes precedence over `.env` (good for personal overrides).

### Minimal config (plain cases only)

All model configuration — endpoint, credentials, and model metadata — lives in `models.json`. The runner resolves `input.model` from the case file as a model id in that registry. See [Model registry](#model-registry) below for the full format.

```bash
# Path to your model registry (auto-discovered if ./models.json exists in cwd)
EVAL_MODELS_PATH=./models.json

# Judge model id — must be defined in your models.json
EVAL_JUDGE_MODEL=gpt-4o-mini
```

### Full config (agent cases + multi-judge)

```bash
# Model registry
EVAL_MODELS_PATH=./models.json

# LLM judge — single model
EVAL_JUDGE_MODEL=gpt-4o-mini

# LLM judge — multi-model (overrides EVAL_JUDGE_MODEL when set)
# EVAL_JUDGE_MODELS=gpt-4o-mini,gpt-4o,claude-3-5-sonnet
# EVAL_JUDGE_AGGREGATION=median        # median (default) | mean | iqm

# Judge endpoint override (if different from runner model; e.g. LiteLLM gateway)
# EVAL_JUDGE_BASE_URL=https://your-litellm.com/v1
# EVAL_JUDGE_API_KEY=your-litellm-key

# Agent runner — MCP tool server
EVAL_MCP_SERVER_BASE_URL=https://mcp.talesofai.cn   # default, override if needed
EVAL_MCP_X_TOKEN=                                    # auth token for MCP server

# Agent runner — upstream API (character/asset provider)
EVAL_UPSTREAM_API_BASE_URL=https://api.talesofai.cn  # default
EVAL_UPSTREAM_X_TOKEN=                               # auth token for upstream
```

### Verify your setup

```bash
agent-eval doctor
```

This checks all required env vars and prints ✅ / ⚠️ / ❌ with hints. Pass `--mode plain` or `--mode agent` to scope the check.

---

### Model registry

All models — for the runner and for judging — must be defined in a `models.json` file that you create and maintain. **No models are bundled with the package** — this is intentional so you control exactly which models and endpoints are available.

The `input.model` field in every case file is resolved as a model id against this registry.

**Resolution order:**
1. `EVAL_MODELS_PATH` env var (explicit path)
2. `./models.json` in current working directory (auto-discovered)

**Create `./models.json`** in your project root:

```json
{
  "models": {
    "gpt-4o-mini": {
      "id": "gpt-4o-mini",
      "name": "GPT-4o Mini",
      "api": "openai-completions",
      "provider": "openai",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "${OPENAI_API_KEY}"
    },
    "qwen-plus": {
      "id": "qwen-plus",
      "name": "Qwen Plus",
      "api": "openai-completions",
      "provider": "alibaba",
      "baseUrl": "${DASHSCOPE_BASE_URL}",
      "apiKey": "${DASHSCOPE_API_KEY}"
    },
    "claude-3-5-sonnet": {
      "id": "claude-3-5-sonnet",
      "name": "Claude 3.5 Sonnet",
      "api": "anthropic-messages",
      "provider": "anthropic",
      "baseUrl": "${ANTHROPIC_BASE_URL}",
      "headers": {
        "x-api-key": "${ANTHROPIC_API_KEY}"
      }
    }
  }
}
```

**Field reference:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | ✅ | Model identifier (used in case `input.model`, `EVAL_JUDGE_MODEL`, etc.) |
| `name` | ✅ | Human-readable name |
| `api` | ✅ | `openai-completions` or `anthropic-messages` |
| `provider` | ✅ | Provider label (informational) |
| `baseUrl` | ✅ | API base URL. Supports `${ENV_VAR}` interpolation. |
| `apiKey` | — | API key for this model. Supports `${ENV_VAR}` interpolation. Preferred over putting auth in `headers`. |
| `headers` | — | Additional HTTP headers. Supports `${ENV_VAR}` interpolation. |
| `input` | — | `["text"]` or `["text", "image"]` |
| `contextWindow` | — | Context window size in tokens |
| `maxTokens` | — | Max output tokens |

`${VAR_NAME}` in any field is expanded from environment variables at load time.

---

## Quick start

```bash
# 1. Check config
agent-eval doctor

# 2. List built-in cases
agent-eval list

# 3. Run one case by id
agent-eval run --case <id>

# 4. Run all built-in cases
agent-eval run --case all

# 5. Run a local YAML file
agent-eval run --file my-case.eval.yaml

# 6. Run multiple YAML files with glob
agent-eval run --file "cases/**/*.eval.yaml"

# 7. One-liner (no YAML file)
agent-eval run \
  --model gpt-4o-mini \
  --system-prompt "You are a helpful assistant." \
  --message "user:Tell me a joke" \
  --judge-prompt "Response should be funny" \
  --judge-threshold 0.7
```

---

## Case format

Cases are YAML files ending in `.eval.yaml`. Each file defines one case.

### Plain case

Tests a chat completion response directly.

```yaml
type: plain
id: tone-check                        # unique kebab-case id
description: Response should be friendly and casual

input:
  model: gpt-4o-mini                  # model id from models.json
  system_prompt: You are a friendly assistant.
  messages:
    - role: user
      content: Tell me a story

  # Optional: limit which tools are injected (plain cases rarely use tools)
  # allowed_tool_names: [tool_a, tool_b]

criteria:
  assertions:
    - type: llm_judge
      prompt: Response should be friendly and casual
      pass_threshold: 0.7
```

**Multi-turn conversation:**

```yaml
input:
  model: gpt-4o-mini
  system_prompt: You are a math tutor.
  messages:
    - role: user
      content: What is 2+2?
    - role: assistant
      content: 4
    - role: user
      content: And 3+3?
```

**Image input:**

```yaml
input:
  model: gpt-4o
  messages:
    - role: user
      content:
        - type: image_url
          image_url:
            url: https://example.com/image.png
        - type: text
          text: Describe this image
```

---

### Agent case

Runs a full agent loop (multi-turn, tool calls). The agent communicates with an MCP tool server.

The runner resolves the agent's identity from `system_prompt` + `model`. `parameters` values are
interpolated into `system_prompt` and `messages` via `{{key}}` placeholders.

```yaml
type: agent
id: make-image
description: Agent should call make_image and confirm generation

input:
  system_prompt: |
    You are a creative assistant. {{task_context}}
  model: gpt-4o-mini

  # Parameters are interpolated into system_prompt and messages via {{key}}
  parameters:
    task_context: Help users generate high-quality images.

  messages:
    - role: user
      content: Generate a cat image

  # Tool access control
  allowed_tool_names:                 # whitelist of tools the agent may call
    - make_image_v1
    - make_video_v1
  need_approval_tool_names: []        # tools that pause for approval before running

  # Simulate follow-up turns after the agent finishes its first response
  auto_followup:
    mode: adversarial_help_choose     # only supported mode
    max_turns: 1                      # default: 1

  # Deprecated — no longer used by the runner, kept for case file identification only
  # preset_key: latitude://8|live|running_agent_new

criteria:
  assertions:
    - type: tool_usage
      expected_tools: [make_image_v1]     # agent must have called this tool
    - type: llm_judge
      prompt: Response should confirm that the image was generated
      pass_threshold: 0.7
```

> **Note on `preset_key`:** older case files may contain `preset_key`. The runner ignores it — only
> `system_prompt` + `model` determine how the agent is run. You can safely remove `preset_key` from
> new cases.

---

## Assertions reference

Assertions define how a trace is scored. All assertions live under `criteria.assertions`.

Each assertion runs as an independent dimension. A case **passes** only when all non-`human_review` assertions pass.

### Assertion tiers

Assertions have a tier (1–3) that controls when they run. Use `--tier-max` to limit evaluation depth:

| Tier | Default for | Meaning |
|------|------------|---------|
| 1 | `tool_usage`, `final_status`, `error_recovery` | Rule-based, no LLM needed. Fast CI. |
| 2 | `llm_judge`, `task_success`, `tool_parameter_accuracy` | LLM-as-a-judge. Requires judge config. **Default `--tier-max`.** |
| 3 | `human_review` | Flag for async human review. Never blocks automated scoring. |

```bash
agent-eval run --case all --tier-max 1   # fast rules-only, no LLM judge
agent-eval run --case all --tier-max 2   # default: rules + LLM judge
agent-eval run --case all --tier-max 3   # include human_review flags
```

You can override the default tier of any assertion with `tier: <1|2|3>`.

### `tool_usage` (tier 1)

Checks which tools were called during the trace.

```yaml
- type: tool_usage
  expected_tools: [make_image_v1]       # all listed tools must appear
  forbidden_tools: [dangerous_tool_v1]  # none of these may appear
```

Both fields are optional; omitting both is a no-op (always passes).

### `final_status` (tier 1)

Checks the agent's final status after the run.

```yaml
- type: final_status
  expected_status: SUCCESS   # SUCCESS | PENDING | FAILURE
```

### `error_recovery` (tier 1)

Checks whether the agent retried or recovered after a tool failure.

```yaml
- type: error_recovery
  tool_name: make_image_v1   # optional: scope to a specific tool
  pass_threshold: 0.5        # optional: default 0.5
```

### `llm_judge` (tier 2)

An LLM reads the full conversation and scores it 0–1 against your prompt. Requires `EVAL_JUDGE_MODEL`.

```yaml
- type: llm_judge
  prompt: The response should be concise and answer the user's question directly.
  pass_threshold: 0.7        # score must be >= this to pass (0–1)
```

### `task_success` (tier 2)

A holistic LLM evaluation of whether the agent completed the user's goal. Unlike `llm_judge`, the scoring criterion is inferred from context unless overridden.

```yaml
- type: task_success
  user_goal: "Generate a cat image and confirm it to the user"   # optional override
  pass_threshold: 0.7
```

### `tool_parameter_accuracy` (tier 2)

An LLM checks whether the tool was called with correct and relevant parameters.

```yaml
- type: tool_parameter_accuracy
  tool_name: make_image_v1
  expected_description: "Should include a cat in the prompt parameter"
  pass_threshold: 0.7
```

### `human_review` (tier 3)

Flags the case for async manual review. Always runs (never blocks other assertions). Never causes the case to fail in automated scoring.

```yaml
- type: human_review
  reason: "Needs visual inspection of generated image quality"
```

---

## Commands

### `run` — execute cases

```bash
# By built-in case id
agent-eval run --case <id>
agent-eval run --case all

# By YAML file (glob supported)
agent-eval run --file my-case.eval.yaml
agent-eval run --file "cases/**/*.eval.yaml"

# Inline JSON (no file needed)
agent-eval run --inline '{"type":"plain","id":"x","description":"...","input":{...},"criteria":{...}}'

# Filter by type
agent-eval run --case all --type plain
agent-eval run --case all --type agent

# Control scoring depth
agent-eval run --case all --tier-max 1   # rule-based only, fast

# Concurrency (default: min(total, 8))
agent-eval run --case all --concurrency 4

# Verbose: show full conversation in output
agent-eval run --case my-case --verbose

# Output formats
agent-eval run --case my-case --format terminal   # default, human-readable
agent-eval run --case my-case --format json       # machine-readable NDJSON

# Record traces to a directory (auto-enabled for >1 case)
agent-eval run --case all --record ./my-records

# Replay from saved traces (re-score without re-running the LLM)
agent-eval run --case all --replay ./my-records

# Disable auto-share of HTML report
agent-eval run --case all --share=false
```

**One-liner (construct case from CLI flags):**

```bash
agent-eval run \
  --model gpt-4o-mini \
  --system-prompt "You are a helpful assistant." \
  --message "user:Hello" \
  --message "assistant:Hi there!" \
  --message "user:What can you do?" \
  --judge-prompt "Should give a helpful answer" \
  --judge-threshold 0.7
```

---

### `matrix` — compare variants side-by-side

Run the same cases against multiple parameter variants. Produces a grid: cases × variants.

```bash
# Shorthand: label=model
agent-eval matrix --case all \
  --variant "gpt4o=gpt-4o" \
  --variant "mini=gpt-4o-mini"

# Full JSON variant (override any input field)
agent-eval matrix --case all \
  --variant '{"label":"v1","model":"gpt-4o","system_prompt":"Be concise."}' \
  --variant '{"label":"v2","model":"gpt-4o","system_prompt":"Be detailed."}'

# With file and concurrency
agent-eval matrix \
  --file "cases/**/*.eval.yaml" \
  --variant "a=gpt-4o" \
  --variant "b=gpt-4o-mini" \
  --concurrency 4 \
  --record ./matrix-results
```

Results are saved under `<record>/<variant-label>/<case-id>.result.json`.

---

### `diff` — A/B comparison

Run the same cases under two configurations and let an LLM judge which is better.

```bash
agent-eval diff --case all \
  --base '{"model":"gpt-4o"}' \
  --candidate '{"model":"gpt-4o-mini"}'

# Add labels for readable output
agent-eval diff --case all \
  --base '{"label":"prod","model":"gpt-4o"}' \
  --candidate '{"label":"cheap","model":"gpt-4o-mini"}'
```

Verdict per case: `base_better` | `candidate_better` | `equivalent` | `error`.

---

### `list` — list built-in cases

```bash
agent-eval list
# Outputs JSON array: [{id, type, description}, ...]
```

---

### `inspect` — show case definition

```bash
agent-eval inspect --case <id>
agent-eval inspect --file my-case.eval.yaml
```

---

### `doctor` — check configuration

```bash
agent-eval doctor               # check all
agent-eval doctor --mode plain  # only plain-case env vars
agent-eval doctor --mode agent  # only agent-case env vars
agent-eval doctor --format json # machine-readable output
```

---

### `report` — generate HTML from saved results

After a recorded run, regenerate the HTML report without re-running cases:

```bash
agent-eval report --from ./my-records
# → ./my-records/run-report.html
# → ./my-records/run-report-list.html

agent-eval report --from ./my-records --out ./output/report.html
```

---

### `matrix-report` — generate HTML from matrix results

```bash
agent-eval matrix-report --from ./matrix-results
# Reads variant subdirs: ./matrix-results/<variant>/*.result.json
# → ./matrix-results/matrix-report.html
```

---

### `pull-online` — import case from online collection

> ⚠️ This command is talesofai-internal. It requires `EVAL_UPSTREAM_X_TOKEN` and access to the talesofai API.

```bash
agent-eval pull-online \
  --collection-uuid <uuid> \
  --out cases/my-imported-case.eval.yaml

# With pagination (import page 2, 5 items)
agent-eval pull-online \
  --collection-uuid <uuid> \
  --page-index 1 \
  --page-size 5 \
  --out cases/batch.eval.yaml
```

---

## Advanced

### Record & replay

**Why replay?** Running agent cases is slow and expensive. Record once, then iterate on scoring logic or LLM judge prompts without re-running the agent.

```bash
# Step 1: record traces
agent-eval run --case all --record ./records/run-001

# Step 2: replay (re-score, skip LLM execution)
agent-eval run --case all --replay ./records/run-001

# Step 3: change your assertions in the YAML, replay again
agent-eval run --case all --replay ./records/run-001
```

Replay behavior:
- If a `<case-id>.result.json` exists → use cached result directly
- If only `<case-id>.trace.json` exists → re-score the trace
- Auto-record is enabled for runs with >1 case (saved to `.eval-records/run-<timestamp>/`)

**Backfill metrics on older results:**

```bash
agent-eval run --case all --replay ./old-records --replay-write-metrics
```

---

### Matrix evaluation

Matrix runs `N cases × M variants` in parallel and produces a comparison grid.

```bash
agent-eval matrix \
  --file "cases/**/*.eval.yaml" \
  --variant "v1=gpt-4o" \
  --variant "v2=gpt-4o-mini" \
  --variant "v3=claude-3-5-sonnet" \
  --record ./matrix-20240301

# Generate HTML report separately
agent-eval matrix-report --from ./matrix-20240301
```

Matrix automatically resumes from existing results if you re-run with the same `--record` directory.

---

### A/B diff

`diff` is useful for evaluating prompt changes or model upgrades on a shared case set.

```bash
# Compare two system prompts
agent-eval diff --file cases/my-case.eval.yaml \
  --base    '{"label":"original","system_prompt":"You are helpful."}' \
  --candidate '{"label":"new","system_prompt":"You are concise and helpful."}'
```

The diff uses a single LLM judge (`EVAL_JUDGE_MODEL`) to compare the two traces head-to-head.

---

### Multi-model judging

Use multiple LLMs to judge the same output and aggregate scores for higher reliability.

**Setup:**

```bash
# Use a LiteLLM gateway or any unified endpoint
EVAL_JUDGE_BASE_URL=https://your-litellm.com/v1
EVAL_JUDGE_API_KEY=your-key
EVAL_JUDGE_MODELS=gpt-4o-mini,gpt-4o,claude-3-5-sonnet
EVAL_JUDGE_AGGREGATION=median
```

When `EVAL_JUDGE_MODELS` is set, it takes precedence over `EVAL_JUDGE_MODEL`.

**Aggregation methods:**

| Method | Description |
|--------|-------------|
| `median` | Robust to outliers. **Default.** |
| `mean` | Simple average. |
| `iqm` | Interquartile mean — drops top/bottom 25%. |

**Output example:**

```
score: 0.85
reason: gpt-4o-mini: 0.80 - accurate | gpt-4o: 0.90 - detailed |
        claude-3-5-sonnet: 0.85 - correct | [aggregated via median: 0.85]
```

---

### Model registry (required for all cases)

See [Model registry](#model-registry) under Configure for the full format and field reference.

---

## Environment variables

### Runner (required for `run`, `diff`, `matrix`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EVAL_MODELS_PATH` | ✅* | `./models.json` in cwd | Path to your model registry JSON. Required unless `./models.json` exists in cwd. |
| `EVAL_UPSTREAM_X_TOKEN` | — | — | Optional `x-token` header added to runner requests and upstream API calls. |

`*` Any env vars referenced by `${VAR}` placeholders in your `models.json` entries must also be set (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).

### Judge (required for `llm_judge`, `task_success`, `diff`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EVAL_JUDGE_MODEL` | ✅* | — | Single judge model id (must be defined in your registry). Required unless `EVAL_JUDGE_MODELS` is set. |
| `EVAL_JUDGE_MODELS` | — | — | Comma-separated model ids for multi-model judging. Overrides `EVAL_JUDGE_MODEL`. |
| `EVAL_JUDGE_AGGREGATION` | — | `median` | Aggregation method: `median`, `mean`, or `iqm` |
| `EVAL_JUDGE_BASE_URL` | — | — | Judge endpoint override (e.g. LiteLLM gateway). Overrides the model's `baseUrl` from registry. |
| `EVAL_JUDGE_API_KEY` | — | — | Judge API key override. Overrides the model's `apiKey` from registry. |

### Agent runner

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EVAL_MCP_SERVER_BASE_URL` | — | `https://mcp.talesofai.cn` | MCP tool server base URL |
| `EVAL_MCP_X_TOKEN` | — | — | Auth token for MCP server |
| `EVAL_UPSTREAM_API_BASE_URL` | — | `https://api.talesofai.cn` | Upstream API for character/asset provider |
| `EVAL_UPSTREAM_X_TOKEN` | — | — | Auth token for upstream API |

### Misc

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EVAL_LEGACY_AGENT_PROMPT_FILE` | — | — | Override legacy agent prompt template file |
| `AGENT_EVAL_DISABLE_ENV_AUTOLOAD` | — | — | Set to `1` to disable auto `.env` discovery |

---

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | All cases passed |
| `1` | One or more cases failed (assertions failed, but no system errors) |
| `2` | System error (missing config, runner crash, IO error) |

Use exit codes in CI:

```bash
agent-eval run --case all --tier-max 1 || exit 1
```

---

## License

MIT
