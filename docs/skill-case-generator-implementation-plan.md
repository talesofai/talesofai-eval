# Skill Case Generator 实现计划

根据 `docs/skill-case-generator-spec.md` 规格，将实现拆分为 **3 个里程碑、12 个任务**。

---

## 里程碑 M1：工作流识别与多 Case 生成核心

核心能力：从单个 skill 识别多个工作流，生成多个 case。

### T1.1 定义工作流识别输出类型 ✅

**文件**: `packages/eval/src/skill-case-scaffold.ts`

定义类型：

```typescript
type IdentifiedWorkflow = {
  name: string;        // kebab-case，如 character-to-image
  description: string; // 简要描述
  task: string;        // 用户任务描述
  expected_tools?: string[];
};
```

**产出**: 类型定义

---

### T1.2 实现工作流识别函数 ✅

**文件**: `packages/eval/src/skill-case-scaffold.ts`

新增 `identifyWorkflows()` 函数：
- 输入：skill 名称 + skill 内容 + mode
- 调用 LLM 分析，返回 `IdentifiedWorkflow[]`
- 使用 meta-skills（error-analysis + write-judge-prompt）构建 prompt
- 解析 JSON 响应，验证字段

**依赖**: T1.1
**产出**: 可测试的工作流识别函数

---

### T1.3 实现断言自动设计 ✅

**文件**: `packages/eval/src/skill-case-scaffold.ts`

扩展 `IdentifiedWorkflow` 或在生成 case 时动态设计：
- `discover` 模式：默认包含 `tool_usage` (ls/read) + `skill_usage`
- 根据工作流特点添加 `llm_judge` 或 `task_success`
- 断言内容与工作流描述一致

**依赖**: T1.2
**产出**: 每个工作流有定制断言

---

### T1.4 重构 `generateSkillCase` → `generateSkillCases` ✅

**文件**: `packages/eval/src/skill-case-scaffold.ts`

新函数签名：

```typescript
type GenerateSkillCasesInput = {
  skillName: string;
  skillContent: string;
  mode: "inject" | "discover";
  skillsDir: string;
  explicitSkillsDir?: string;
  model?: string;
};

type GenerateSkillCasesResult = {
  workflows: IdentifiedWorkflow[];
  cases: GeneratedSkillCase[];
  skipped: Array<{ workflow: string; reason: string }>;
  retries: number;
};
```

逻辑：
1. 调用 `identifyWorkflows()` 获取工作流列表
2. 为每个工作流生成 case
3. 失败时智能重试（反馈错误 → 简化 → 跳过）

**依赖**: T1.2, T1.3
**产出**: 多 case 生成核心函数

---

## 里程碑 M2：智能重试与输出格式

### T2.1 实现智能重试策略 ✅

**文件**: `packages/eval/src/skill-case-scaffold.ts`

```typescript
async function identifyWorkflows(
  input: IdentifyWorkflowsInput,
  opts?: { modelId?: string; maxRetries?: number },
): Promise<IdentifyWorkflowsResult>
```

重试逻辑：
1. **第1次失败**: 返回错误给 LLM，让其修正
2. **第2次失败**: 再次反馈错误，继续重试
3. **第3次失败**: 抛出错误，终止流程

**依赖**: T1.4
**产出**: 健壮的工作流识别

---

### T2.2 实现 Case 文件写入

**文件**: `packages/eval/src/cli/aux-commands.ts` 或新文件

函数：

```typescript
type WriteCasesResult = {
  output_dir: string;
  written: string[];  // 文件路径列表
};

function writeSkillCases(
  cases: GeneratedSkillCase[],
  skillName: string,
  outputDir?: string,
): WriteCasesResult;
```

文件命名规则：`{workflow-name}.eval.yaml`

默认输出目录：`cases/skills/{skill-name}/`

**依赖**: T1.4
**产出**: 多文件输出能力

---

### T2.3 更新 CLI 参数解析

**文件**: `packages/eval/src/cli/options.ts`

新增参数：
- `--format json` 已存在，确保支持
- 输出目录逻辑调整

**依赖**: 无
**产出**: 参数定义就绪

---

## 里程碑 M3：交互界面与 CLI 命令

### T3.1 实现终端确认界面

**文件**: `packages/eval/src/cli/skill-case-ui.ts`（新文件）

```typescript
type CasePreview = {
  index: number;
  selected: boolean;
  workflow: string;
  description: string;
};

async function showConfirmUI(
  cases: GeneratedSkillCase[],
): Promise<GeneratedSkillCase[]>;
```

交互操作：
- `a` 全选 / `n` 取消全选
- `1-5` 切换选择
- `q` 退出不保存
- `Enter` 保存已选择

界面示例：

```
Generated 5 cases for skill 'neta':

  [1] ✅ character-to-image - 查询角色后生成符合设定的图片
  [2] ✅ song-to-mv - 创作歌曲后制作 MV
  [3] ✅ space-exploration - 探索空间发现标签获取内容
  [4] ⬜ hashtag-research - 调研标签了解创作方向
  [5] ✅ interactive-feed - 获取玩法内容推荐

Actions: [a]ll | [n]one | [1-5] toggle | [q]uit | [Enter] save selected
```

**依赖**: T1.4
**产出**: 交互式选择界面

---

### T3.2 实现非交互模式 JSON 输出

**文件**: `packages/eval/src/cli/aux-commands.ts`

当 `--format json` 时输出：

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
    }
  ],
  "skipped": []
}
```

**依赖**: T2.2
**产出**: agent 可调用的 JSON 输出

---

### T3.3 重构 `draftSkillCaseCommand`

**文件**: `packages/eval/src/cli/aux-commands.ts`

整合：
1. 解析参数
2. 调用 `generateSkillCases()`
3. 根据 `--format` 选择输出方式
4. 调用 `showConfirmUI()`（terminal 模式）或直接输出（json 模式）
5. 写入文件

**依赖**: T1.4, T2.1, T2.2, T3.1, T3.2
**产出**: 完整 CLI 命令

---

### T3.4 编写单元测试 ✅

**文件**: `packages/eval/src/tests/skill-case-generator.test.ts`（新文件）

测试用例：
- 工作流识别输出解析
- 多 case 生成
- 重试逻辑
- 文件命名规则

**依赖**: T1.4
**产出**: 测试覆盖

---

## 任务依赖图

```
M1: 核心生成
  T1.1 ─→ T1.2 ─→ T1.3 ─→ T1.4
                          │
                          ▼
M2: 重试与输出          ┌──────────────┐
  T2.1 ←─────────────── │ T1.4 (核心) │
  T2.2 ←─────────────── └──────────────┘
  T2.3 (独立)

M3: 交互与CLI
  T3.1 ←──────────────── T1.4
  T3.2 ←──────────────── T2.2
  T3.3 ←──────────────── T1.4 + T2.1 + T2.2 + T3.1 + T3.2
  T3.4 ←──────────────── T1.4
```

---

## 建议执行顺序

1. **M1** (T1.1 → T1.2 → T1.3 → T1.4) — 核心能力
2. **T3.4** — 尽早验证核心逻辑
3. **T2.1** — 重试策略
4. **T2.2 + T2.3** — 输出能力
5. **T3.1** — 交互界面
6. **T3.2 + T3.3** — CLI 命令完成

---

## 文件变更清单

| 操作 | 文件路径 | 任务 |
|------|----------|------|
| 修改 | `packages/eval/src/skill-case-scaffold.ts` | T1.1, T1.2, T1.3, T1.4, T2.1 |
| 修改 | `packages/eval/src/cli/aux-commands.ts` | T2.2, T3.2, T3.3 |
| 修改 | `packages/eval/src/cli/options.ts` | T2.3 |
| 新增 | `packages/eval/src/cli/skill-case-ui.ts` | T3.1 |
| 新增 | `packages/eval/src/tests/skill-case-generator.test.ts` | T3.4 |

---

## 版本

- **创建日期**: 2026-03-07
- **关联规格**: `docs/skill-case-generator-spec.md`
