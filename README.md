# agent-eval

Evaluation toolkit for prompt cases and agent traces. Supports reproducible testing, trace recording/replay, and LLM-as-a-judge scoring.

- **Plain cases** (`type: plain`): Direct chat completion evaluation
- **Agent cases** (`type: agent`): Full agent runtime with MCP tools
- **Matrix evaluation**: Compare cases across parameter variants
- **Trace replay**: Record once, score multiple times
- **Multi-model judging**: Cross-evaluation via LiteLLM/unified endpoints

---

## Quick Start

### Install

```bash
# From npm
npm i -g agent-eval

# From source
pnpm install && pnpm build
```

### Configure

Create `.env`:

```bash
cp packages/eval/.env.example .env
```

Edit with your credentials:

```bash
# Runner (for executing cases)
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-...

# Judge - Single model mode
EVAL_JUDGE_MODEL=gpt-4o-mini

# Judge - Multi-model mode (via LiteLLM)
# EVAL_JUDGE_BASE_URL=https://your-litellm.com/v1
# EVAL_JUDGE_API_KEY=sk-...
# EVAL_JUDGE_MODELS=gemini-3.5-flash,qwen3.5-plus,doubao-2.0-mini
# EVAL_JUDGE_AGGREGATION=median
```

### Verify & Run

```bash
agent-eval doctor
agent-eval run --case all
```

---

## Multi-Model Judging

Use multiple LLMs to judge the same output and aggregate their scores for higher reliability.

### Setup

Configure via LiteLLM or any OpenAI-compatible unified endpoint:

```bash
EVAL_JUDGE_BASE_URL=https://your-litellm-endpoint.com/v1
EVAL_JUDGE_API_KEY=your-key
EVAL_JUDGE_MODELS=gemini-3.5-flash,qwen3.5-plus,doubao-2.0-mini
EVAL_JUDGE_AGGREGATION=median
```

### Aggregation Methods

| Method | Description |
|--------|-------------|
| `median` | Default. Robust to outliers. |
| `mean` | Simple average. |
| `iqm` | Interquartile mean - drops top/bottom 25%. |

### Output

```
score: 0.85
reason: gemini-3.5-flash: 0.80 - accurate | qwen3.5-plus: 0.90 - detailed |
        doubao-2.0-mini: 0.85 - correct | [aggregated via median: 0.85, confidence: 94%]
```

---

## Commands

| Command | Description |
|---------|-------------|
| `run` | Execute eval cases |
| `matrix` | Run cases across parameter variants |
| `diff` | Compare two configurations |
| `list` | List available cases |
| `inspect` | Show case definition |
| `doctor` | Check configuration |
| `report` | Generate HTML report |
| `pull-online` | Import cases from collection |

---

## Case Format (`.eval.yaml`)

### Plain Case

```yaml
type: plain
id: tone-check
description: Test friendly tone
input:
  system_prompt: You are a friendly assistant.
  model: gpt-4o-mini
  messages:
    - role: user
      content: Tell me a story
criteria:
  assertions:
    - type: llm_judge
      prompt: Response should be friendly and casual
      pass_threshold: 0.7
```

### Agent Case

```yaml
type: agent
id: make-image
description: Agent should call make_image
input:
  preset_key: my-preset
  messages:
    - role: user
      content: Generate a cat image
criteria:
  assertions:
    - type: tool_usage
      expected_tools: [make_image_v1]
    - type: llm_judge
      prompt: Should confirm the image generation
      pass_threshold: 0.7
```

---

## Environment Variables

### Runner
- `OPENAI_BASE_URL`, `OPENAI_API_KEY`

### Judge
- `EVAL_JUDGE_MODEL` - Single model
- `EVAL_JUDGE_MODELS` - Multi-model (comma-separated)
- `EVAL_JUDGE_AGGREGATION` - `median`/`mean`/`iqm`
- `EVAL_JUDGE_BASE_URL`, `EVAL_JUDGE_API_KEY`

### Agent
- `EVAL_MCP_SERVER_BASE_URL`
- `EVAL_UPSTREAM_API_BASE_URL`, `EVAL_UPSTREAM_X_TOKEN`

---

## License

MIT
