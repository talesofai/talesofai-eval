# agent-eval

`agent-eval` 是 TalesOfAI 的本地评测 CLI：
- 支持 **plain**（纯对话）与 **agent**（带 MCP 工具调用）两类用例
- 支持 `--record/--replay` 记录与回放 trace
- 支持 `matrix`：case × variants 批量对比
- 支持 `llm_judge`：LLM-as-a-judge 打分维度

> 目标：让评测可复现、可 diff、可批量跑，并且对新人友好。

## 安装与运行

### 在 monorepo 内使用

```bash
pnpm install
./agent-eval --help
./agent-eval run --help
```

也可在 package 内：

```bash
pnpm -C packages/eval agent-eval --help
```

### npm 安装后直接使用（推荐给外部用户）

```bash
npm i -g agent-eval
agent-eval --help
```

或无需全局安装：

```bash
npx agent-eval --help
```

### 自动加载环境变量

CLI 启动时会自动从当前目录向上查找并加载 `.env.local`、`.env`（不覆盖已存在环境变量）。
建议先复制模板：

```bash
cp packages/eval/.env.example packages/eval/.env
```

### 路径兼容说明

即使在 `pnpm -C packages/eval ...` 下，`--file` 也兼容以下两种写法：

```bash
--file "./cases/xxx.eval.yaml"
--file "./packages/eval/cases/xxx.eval.yaml"
```

## Case 格式（.eval.yaml）

### plain case

```yaml
type: plain
id: plain-tone-example
description: 语气风格测试

input:
  system_prompt: 你是一个友好的创作助手，用轻松活泼的语气回复。
  model: qwen-plus
  openai_base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
  messages:
    - role: user
      content: 帮我想个故事开头

criteria:
  llm_judge:
    prompt: 回复语气应轻松活泼，不应正式死板
    pass_threshold: 0.7
```

### agent case

```yaml
type: agent
id: agent-make-image-example
description: 用户请求生成图片，agent 应调用 make_image

input:
  preset_key: latitude://8|live|running_agent_new
  parameters:
    preset_description: ""
    reference_planning: ""
    reference_content: ""
    reference_content_schema: ""
  messages:
    - role: user
      content: 帮我生成一张猫咪的图片
  allowed_tool_names:
    - make_image_v1

criteria:
  expected_tools:
    - make_image_v1
  llm_judge:
    prompt: 应调用工具并给出确认
    pass_threshold: 0.7
```

> `criteria` 支持 legacy 字段（如 `expected_tools/llm_judge`），加载阶段会自动归一为 `criteria.assertions[]`。

## 运行与回放

### run

```bash
agent-eval run --case all
agent-eval run --file packages/eval/cases/*.eval.yaml
```

### record / replay

```bash
agent-eval run --file packages/eval/cases/*.eval.yaml --record .eval-records/run-1
agent-eval run --file packages/eval/cases/*.eval.yaml --replay .eval-records/run-1
```

- `--record`：保存 `<caseId>.trace.json` 与 `<caseId>.result.json`
- `--replay`：优先使用 `<caseId>.result.json` 缓存；未命中则加载 trace 重新打分
- replay 模式的 run report 默认写入独立目录（`.eval-records/replay-*/run-report.md`），避免覆盖 replay 目录内历史结果
- `--replay-write-metrics`：仅在 replay 缓存缺失 metrics 时回填 `<caseId>.result.json`（best-effort）

## matrix（case × variants）

```bash
agent-eval matrix \
  --file packages/eval/cases/*.eval.yaml \
  --variant '{"label":"baseline","overrides":{}}' \
  --variant '{"label":"new","overrides":{"model":"qwen-plus"}}'
```

## 环境变量

### runner（plain + agent 共用）
- `OPENAI_BASE_URL`（必填）
- `OPENAI_API_KEY`（必填）
- `OPENAI_X_TOKEN`（可选）

### agent（需要 MCP / proxy）
- `EVAL_MCP_SERVER_BASE_URL`：可选，默认 `https://mcp.talesofai.cn`
- `EVAL_UPSTREAM_X_TOKEN`：上游 API 鉴权 token（可在 https://www.neta.art/open/ 申请）
- `EVAL_UPSTREAM_API_BASE_URL`：默认 `https://api.talesofai.cn`，一般无需手动设置

### judge（llm_judge/diff）
- `EVAL_JUDGE_MODEL`（必填，无默认值）
- `EVAL_JUDGE_BASE_URL`（可选，未设置时回退到 `OPENAI_BASE_URL`）
- `EVAL_JUDGE_API_KEY`（可选，未设置时回退到 `OPENAI_API_KEY`）

### diff
- `EVAL_DIFF_SYSTEM_PROMPT`：覆盖 diff judge 的 system prompt

## JSON Schema（VSCode 自动补全）

生成 `eval-case.schema.json`：

```bash
node packages/eval/scripts/generate-schema.ts
```

仓库已在 `.vscode/settings.json` 中将该 schema 绑定到 `**/*.eval.yaml`。
