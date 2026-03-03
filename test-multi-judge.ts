#!/usr/bin/env tsx
/**
 * 多模型交叉评分配置验证脚本 (LiteLLM 版本)
 * 
 * 用法:
 *   export EVAL_JUDGE_BASE_URL=https://your-litellm.com/v1
 *   export EVAL_JUDGE_API_KEY=your-key
 *   export EVAL_JUDGE_MODELS=gemini-3-flash-preview,qwen3.5-plus,doubao-2.0-mini
 *   npx tsx test-multi-judge.ts
 */

import { resolveJudgeModels, resolveJudgeBaseURL, resolveJudgeAggregation } from "./packages/eval/src/env.ts";

console.log("=== 多模型评判配置检查 (LiteLLM) ===\n");

const models = resolveJudgeModels();
const baseURL = resolveJudgeBaseURL();
const aggregation = resolveJudgeAggregation();

if (!models || models.length === 0) {
  console.log("❌ EVAL_JUDGE_MODELS 未配置");
  console.log("\n示例配置 (通过 LiteLLM 统一端点):");
  console.log('export EVAL_JUDGE_BASE_URL=https://your-litellm-endpoint.com/v1');
  console.log('export EVAL_JUDGE_API_KEY=your-litellm-key');
  console.log('export EVAL_JUDGE_MODELS=gemini-3-flash-preview,qwen3.5-plus,doubao-2.0-mini');
  console.log('export EVAL_JUDGE_AGGREGATION=median');
  process.exit(1);
}

if (!baseURL) {
  console.log("❌ EVAL_JUDGE_BASE_URL 未配置");
  process.exit(1);
}

console.log(`✅ 已配置 ${models.length} 个评判模型:\n`);

for (const model of models) {
  console.log(`  📌 ${model}`);
}

console.log(`\n🌐 统一端点: ${baseURL}`);
console.log(`📊 聚合方法: ${aggregation}`);
console.log("   (median=中位数, mean=平均, iqm=四分位平均)\n");

// 模拟评分聚合示例
const mockScores = [
  { model: models[0] || "A", score: 0.85, reason: "回答准确" },
  { model: models[1] || "B", score: 0.90, reason: "完整且清晰" },
  { model: models[2] || "C", score: 0.75, reason: "基本正确但缺少细节" },
];

console.log("📝 示例评分聚合:");
for (const s of mockScores) {
  console.log(`   ${s.model}: ${s.score} - ${s.reason}`);
}

// 计算中位数
const scores = mockScores.map(s => s.score).sort((a, b) => a - b);
const median = scores.length % 2 === 0 
  ? (scores[scores.length / 2 - 1]! + scores[scores.length / 2]!) / 2 
  : scores[Math.floor(scores.length / 2)]!;

console.log(`\n   聚合结果: ${median} (median)`);
console.log("\n✅ 配置检查完成，可以运行多模型评判");
console.log("\n运行命令:");
console.log("  pnpm agent-eval run --case your-case-id");
