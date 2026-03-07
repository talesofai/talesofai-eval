/**
 * Strip markdown code block markers from a string.
 * Handles ```json, ```, and similar patterns.
 */
function stripMarkdownCodeBlock(value: string): string {
  // Match```json ... ``` or ``` ... ```
  const codeBlockMatch = value.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (codeBlockMatch) {
    return (codeBlockMatch[1] ?? "").trim();
  }
  return value.trim();
}

export function safeParseJson<T>(json: string): T | null {
  try {
    const stripped = stripMarkdownCodeBlock(json);
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}
