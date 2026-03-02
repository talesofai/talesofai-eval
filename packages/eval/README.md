# agent-eval

Evaluation toolkit for prompt cases and agent traces. Supports reproducible testing, trace recording/replay, and LLM-as-a-judge scoring.

- **Plain cases** (`type: plain`): Test chat completions directly
- **Agent cases** (`type: agent`): Test agents with MCP tool calling
- **Matrix evaluation**: Compare cases across parameter variants
- **Trace replay**: Record once, score multiple times

---

## 5-Minute Quickstart

### 1. Install

```bash
# From npm (recommended for users)
npm i -g agent-eval

# From source (contributors)
pnpm install && pnpm build
```

### 2. Configure Environment

Create `.env` in your working directory:

```bash
# If running from repo root
cp packages/eval/.env.example .env

# If running from packages/eval
cp .env.example .env
```

Edit `.env` with your credentials:

```bash
# Required: Model for running cases
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...

# Required: Model for judging (no default)
EVAL_JUDGE_MODEL=gpt-4o-mini
EVAL_JUDGE_BASE_URL=https://api.openai.com/v1
EVAL_JUDGE_API_KEY=sk-...
```

> **Note**: Environment files are loaded from current directory upward. Place `.env` where you run commands from.

### 3. Verify Setup

```bash
agent-eval doctor
```

Expected output:
```
✅ cli-name [all]
✅ OPENAI_BASE_URL [run,diff]
✅ OPENAI_API_KEY [run,diff]
✅ EVAL_JUDGE_MODEL [llm_judge,diff]
✅ EVAL_MCP_SERVER_BASE_URL [run,diff]
```

### 4. Run First Evaluation

```bash
# List built-in cases
agent-eval list

# Run all built-in cases
agent-eval run --case all

# Run specific case
agent-eval run --case system-prompt-tone
```

Success output shows a table with pass/fail status.

---

## Installation Methods

### npm (Recommended)

```bash
npm i -g agent-eval
agent-eval --help
```

### npx (No Install)

```bash
npx agent-eval --help
```

### Monorepo (Contributors)

```bash
# From repo root
pnpm agent-eval --help

# Direct path
node packages/eval/dist/cli.js --help
```

---

## Case Format (`.eval.yaml`)

### Plain Case

```yaml
type: plain
id: plain-tone-example
description: Test friendly tone

input:
  system_prompt: You are a friendly creative assistant.
  model: gpt-4o-mini
  openai_base_url: https://api.openai.com/v1
  messages:
    - role: user
      content: Tell me a story opening

criteria:
  llm_judge:
    prompt: Response should be friendly and casual, not formal
    pass_threshold: 0.7
```

### Agent Case

```yaml
type: agent
id: agent-make-image-example
description: Agent should call make_image tool

input:
  preset_key: my-preset-key
  messages:
    - role: user
      content: Generate a cat image
  allowed_tool_names:
    - make_image_v1

criteria:
  expected_tools:
    - make_image_v1
  llm_judge:
    prompt: Should call the tool and provide confirmation
    pass_threshold: 0.7
```

> `criteria` supports legacy fields (`expected_tools`, `llm_judge`). These normalize to `criteria.assertions[]` at load time.

---

## Commands

### `run` - Execute Cases

```bash
# Run built-in cases
agent-eval run --case all

# Run from files (glob supported)
agent-eval run --file "./cases/*.eval.yaml"

# Inline case
agent-eval run \
  --system-prompt "You are helpful" \
  --model gpt-4o-mini \
  --message "user:Hello"
```

### `record` / `replay` - Trace Management

```bash
# Record traces
agent-eval run --file "./cases/*.eval.yaml" --record .eval-records/run-1

# Replay from traces (uses cache when available)
agent-eval run --file "./cases/*.eval.yaml" --replay .eval-records/run-1
```

- `--record`: Saves `<caseId>.trace.json` and `<caseId>.result.json`
- `--replay`: Loads traces, re-scores without re-running LLM calls
- `--replay-write-metrics`: Backfills missing metrics to result files

### `matrix` - Parameter Variants

```bash
agent-eval matrix \
  --file "./cases/*.eval.yaml" \
  --variant 'baseline=qwen3.5-plus' \
  --variant 'new-model=doubao-2.0-lite'

# JSON form still works when you need multi-field overrides:
# --variant '{"label":"temp-08","model":"qwen3.5-plus","temperature":0.8}'
```

### `doctor` - Configuration Check

```bash
agent-eval doctor          # Check all
agent-eval doctor --mode run   # Check run requirements
```

### Other Commands

```bash
agent-eval list            # List built-in cases
agent-eval inspect --case <id>   # Show case definition
agent-eval report          # Generate HTML from results
agent-eval pull-online     # Import from online collection
```

---

## Environment Variables

### Runner (Required)

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_BASE_URL` | OpenAI-compatible API base URL | Yes |
| `OPENAI_API_KEY` | API key for runner | Yes |
| `OPENAI_X_TOKEN` | Optional forwarded token | No |

### Judge (Required for `llm_judge` and `diff`)

| Variable | Description | Default |
|----------|-------------|---------|
| `EVAL_JUDGE_MODEL` | Model for judging | **None** (required) |
| `EVAL_JUDGE_BASE_URL` | Judge API base | `OPENAI_BASE_URL` |
| `EVAL_JUDGE_API_KEY` | Judge API key | `OPENAI_API_KEY` |

### Agent (For `type: agent`)

| Variable | Description | Default |
|----------|-------------|---------|
| `EVAL_MCP_SERVER_BASE_URL` | MCP server URL | `https://mcp.talesofai.cn` |
| `EVAL_UPSTREAM_X_TOKEN` | Upstream auth token | - |
| `EVAL_UPSTREAM_API_BASE_URL` | Upstream API | `https://api.talesofai.cn` |
| `EVAL_MCP_X_TOKEN` | MCP auth token | - |
| `EVAL_LEGACY_AGENT_PROMPT_FILE` | Override legacy agent system prompt template file path | Built-in default template |

### Diff

| Variable | Description |
|----------|-------------|
| `EVAL_DIFF_SYSTEM_PROMPT` | Override diff judge system prompt |

---

## JSON Schema (VSCode Autocomplete)

Generate schema for IDE support:

```bash
node packages/eval/scripts/generate-schema.ts
```

The repo includes `.vscode/settings.json` binding `eval-case.schema.json` to `**/*.eval.yaml`.

---

## Troubleshooting

### "Missing required configuration: EVAL_JUDGE_MODEL"

Set a judge model in your `.env`:
```bash
EVAL_JUDGE_MODEL=gpt-4o-mini
```

Run `agent-eval doctor` to verify.

### "Cannot find module" or command not found

- If using npm global: ensure npm global bin is in `$PATH`
- If using monorepo: use `pnpm agent-eval` from repo root
- Direct path: `node packages/eval/dist/cli.js`

### Environment variables not loading

- Files are loaded from current directory upward
- Supported names: `.env.local`, `.env`
- `.env.local` takes precedence over `.env`
- Set `AGENT_EVAL_DISABLE_ENV_AUTOLOAD=1` to disable

---

## License

MIT
