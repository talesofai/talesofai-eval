import type { EvalMessage } from "../types.ts";

/**
 * Extract plain text from EvalMessage content.
 * role === "assistant" keeps text / output_text.
 * role === "user" keeps text / input_text.
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
