import type { EvalMessage } from "../types.ts";

/**
 * 从 EvalMessage content 提取纯文本。
 * role === "assistant" 保留 text / output_text；
 * role === "user" 保留 text / input_text。
 */
export function extractMessageText(
  content: EvalMessage["content"],
  role: "user" | "assistant",
): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  const allowed =
    role === "assistant"
      ? new Set(["text", "output_text"])
      : new Set(["text", "input_text"]);
  let text = "";
  for (const item of content) {
    if (allowed.has(item.type) && "text" in item) {
      const itemText = (item as { text: string }).text;
      if (typeof itemText === "string") {
        text += (text ? "\n" : "") + itemText;
      }
    }
  }
  return text;
}
