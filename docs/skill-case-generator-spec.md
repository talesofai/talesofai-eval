# Skill Case Generator 功能规格

## 概述

全面评测 skill，生成器从被评测 skill 中识别所有用户场景/工作流，为每个工作流生成独立的测试 case。

## 核心功能

### 工作流识别
- **方式**：由 LLM 分析 skill 内容，自动推断用户场景/工作流
- **定义**：工作流 = 用户场景 = 多个命令/步骤的组合
- **示例**：
  - "查询角色 → 生成符合设定的图片"
  - "探索空间 → 发现标签 → 获取内容"
  - "创作歌曲 → 制作 MV"

### Case 数量
- LLM 自行决定，输出所有识别到的工作流
- 不设置上限/下限

### 断言设计
- 由 LLM 根据工作流自动设计断言
- 断言类型：
  - `tool_usage`（tier 1）：检查工具调用
  - `skill_usage`（tier 2）：检查 skill 加载和执行
  - `llm_judge`（tier 2）：用 LLM 评判输出质量
  - `task_success`（tier 2）：检查任务是否完成

### 输出格式
- 多个独立 YAML 文件，每个文件一个 case
- 与现有 case 格式完全兼容

---

## 命令接口

### 基本用法

```bash
# 交互模式（默认）：显示确认界面，用户选择保存
pnpm agent-eval draft-skill-case --skill neta --skills-dir ~/projects/neta-skills/skills

# 非交互模式：直接输出 JSON 结果
pnpm agent-eval draft-skill-case --skill neta --skills-dir ~/projects/neta-skills/skills --format json

# 指定模式
pnpm agent-eval draft-skill-case --skill neta --mode inject --skills-dir ~/projects/neta-skills/skills
```

### 参数说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--skill` | Skill 名称（必填） | - |
| `--skills-dir` | Skills 目录路径 | - |
| `--mode` | 评测模式：discover / inject | discover |
| `--format` | 输出格式：terminal / json | terminal |
| `--out` | 指定输出目录 | cases/skills/{skill-name}/ |

---

## 模式说明

### discover 模式（默认）
- Agent 需要自己发现并使用 skill
- 包含 `tool_usage` 断言检查 `ls/read`
- 测试 skill 发现能力

### inject 模式
- Skill 已经注入到上下文中
- 不需要 `tool_usage` 断言
- 测试 skill 执行质量

---

## 输出结构

### 文件位置

```
cases/skills/{skill-name}/
  {workflow-1}.eval.yaml
  {workflow-2}.eval.yaml
  {workflow-3}.eval.yaml
  ...
```

### 示例

```
cases/skills/neta/
  character-to-image.eval.yaml
  song-to-mv.eval.yaml
  space-exploration.eval.yaml
  hashtag-research.eval.yaml
  interactive-feed.eval.yaml
```

### 文件命名规则
- 使用工作流名称（小写、连字符分隔）
- 例如：`character-to-image.eval.yaml`

---

## 确认界面（仅 `--format terminal`）

```
Generated 5 cases for skill 'neta':

  [1] ✅ character-to-image - 查询角色后生成符合设定的图片
  [2] ✅ song-to-mv - 创作歌曲后制作 MV
  [3] ✅ space-exploration - 探索空间发现标签获取内容
  [4] ⬜ hashtag-research - 调研标签了解创作方向
  [5] ✅ interactive-feed - 获取玩法内容推荐

Actions: [a]ll | [n]one | [1-5] toggle | [q]uit | [Enter] save selected
```

### 交互操作

| 按键 | 操作 |
|------|------|
| `a` | 选择全部 |
| `n` | 取消全部选择 |
| `1-5` | 切换对应 case 的选择状态 |
| `q` | 退出，不保存 |
| `Enter` | 保存已选择的 case |

---

## 非交互模式输出（`--format json`）

```json
{
  "type": "draft-skill-case",
  "skill": "neta",
  "mode": "discover",
  "output_dir": "cases/skills/neta",
  "stats": {
    "total_workflows_detected": 5,
    "cases_generated": 5,
    "cases_skipped": 0,
    "retries": 0
  },
  "cases": [
    {
      "id": "skill-neta-discover-character-to-image",
      "file": "character-to-image.eval.yaml",
      "description": "查询角色后生成符合设定的图片"
    },
    {
      "id": "skill-neta-discover-song-to-mv",
      "file": "song-to-mv.eval.yaml",
      "description": "创作歌曲后制作 MV"
    }
  ],
  "skipped": []
}
```

---

## 失败处理

### 智能重试策略

1. **第一次失败**：将错误信息反馈给 LLM，让其修正
2. **第二次失败**：简化要求，只生成核心字段
3. **第三次失败**：跳过该 case

### 非交互模式下的跳过记录

```json
{
  "skipped": [
    {
      "workflow": "some-workflow",
      "reason": "Failed to generate valid case after 3 retries",
      "error": "Missing required field: criteria.assertions"
    }
  ]
}
```

---

## Case YAML 格式

### 完整示例

```yaml
id: skill-neta-discover-character-to-image
type: skill
description: 查询角色后生成符合设定的图片
input:
  skill: neta
  model: deepseek/deepseek-chat
  evaluation_mode: discover
  task: I want to create fan art of an anime character, but I need to make sure I get their official appearance and style right first. Can you help me find the character's details and then generate an image that matches their look?
  skills_dir: /home/ubuntu/projects/neta-skills/skills
criteria:
  assertions:
    - type: tool_usage
      tier: 1
      expected_tools:
        - search_character_or_elementum
        - make_image
    - type: skill_usage
      tier: 2
      checks:
        - skill_loaded
        - workflow_followed
        - skill_influenced_output
      pass_threshold: 0.7
    - type: llm_judge
      tier: 2
      prompt: Did the agent correctly follow the 'query first, then create' workflow by searching for the character's official details before generating an image?
      pass_threshold: 0.7
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | Case 唯一标识，格式：`skill-{skillName}-{mode}-{workflow}` |
| `type` | string | 固定为 `skill` |
| `description` | string | Case 简要描述 |
| `input.skill` | string | Skill 名称 |
| `input.model` | string | 评测使用的模型 |
| `input.evaluation_mode` | string | discover / inject |
| `input.task` | string | 用户任务描述 |
| `input.skills_dir` | string | Skills 目录路径（可选） |
| `criteria.assertions` | array | 断言列表 |

---

## 实现要点

### 1. Meta-Skills 集成

生成器使用 meta-skills 指导 case 生成：

```typescript
// 加载 meta-skills
const errorAnalysisSkill = loadMetaSkillContent("error-analysis");
const writeJudgeSkill = loadMetaSkillContent("write-judge-prompt");

// 构建系统提示词
const systemPrompt = buildCaseGeneratorSystemPrompt({
  errorAnalysisSkill,
  writeJudgeSkill,
});
```

### 2. 工作流识别提示词

```
分析 skill 内容，识别所有可能的用户场景/工作流。

要求：
1. 每个工作流代表一个完整的用户使用场景
2. 工作流可以包含多个命令/步骤
3. 工作流名称用 kebab-case 命名
4. 返回 JSON 格式
```

### 3. 解析器兼容性

- 每个文件独立存储
- 使用现有的 case 解析逻辑
- 无需修改现有解析器

---

## 决策记录

| 问题 | 决策 | 备注 |
|------|------|------|
| 路径定义 | 用户场景/工作流 | 非按命令或文档结构划分 |
| 工作流识别 | LLM 自动推断 | 灵活，能发现隐含工作流 |
| Case 数量 | LLM 自行决定 | 不设上限下限 |
| 断言设计 | LLM 自动设计 | 根据工作流特点定制 |
| 输出格式 | 多个独立 YAML 文件 | 与现有格式完全兼容 |
| 文件命名 | 工作流名称 | kebab-case |
| 模式默认值 | discover | 大多数评测场景 |
| 非交互模式 | --format json | 便于 agent 调用 |
| 确认界面 | 列表式选择 | 仅 terminal 模式 |
| 失败处理 | 智能重试 3 次 | 反馈错误 → 简化 → 跳过 |

---

## 版本

- **创建日期**：2024-03-07
- **版本**：1.0.0
