#!/bin/bash
# Prompt Diff 验证脚本
# 比较 baseline prompt 和改进后的 prompt

set -e

echo "=== Agent Prompt Diff 验证 ==="
echo ""

CASE_FILE="packages/eval/src/cases/agent-no-wait-example.eval.yaml"
IMPROVED_PROMPT_FILE="packages/eval/src/cases/improved-agent-prompt.txt"
RECORD_DIR=".eval-records/prompt-diff-$(date +%Y%m%d-%H%M%S)"

# 读取改进后的 prompt（转义为 JSON 字符串）
IMPROVED_PROMPT=$(cat "$IMPROVED_PROMPT_FILE" | jq -Rs .)

echo "📋 Case: $CASE_FILE"
echo "📝 Improved prompt: $IMPROVED_PROMPT_FILE"
echo ""

echo "运行 matrix 对比测试..."
echo "  - baseline=qwen3.5-plus (使用默认 legacy prompt)"
echo "  - improved=qwen3.5-plus (使用改进后的 prompt)"
echo ""

# 使用 variant 简写形式指定模型: label=model
# baseline: 使用默认 legacy prompt
# improved: 提供完整的 system_prompt
pnpm agent-eval matrix \
  --file "$CASE_FILE" \
  --variant "baseline=qwen3.5-plus" \
  --variant "{\"label\":\"improved\",\"model\":\"qwen3.5-plus\",\"system_prompt\":$IMPROVED_PROMPT}" \
  --concurrency 1 \
  --record "$RECORD_DIR"

echo ""
echo "✅ 验证完成"
echo "📁 结果保存在: $RECORD_DIR"
