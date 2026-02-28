# TODOS

## 1) External override for legacy prompt template
- **What:** Support env-based override (e.g. `EVAL_LEGACY_AGENT_PROMPT_FILE`) for legacy prompt template.
- **Why:** Some migration scenarios need domain-specific compatibility prompt behavior.
- **Context:** Current plan uses fixed default template file for stable MVP behavior.
- **Depends on / blocked by:** After OSS minimal runtime baseline is merged and stable.

## 2) Run-level MCP tool schema cache
- **What:** Cache `listTools()` result per run (keyed by MCP base URL + tool filter).
- **Why:** Reduce repeated MCP schema fetch overhead in batch/matrix runs.
- **Context:** Current loop can repeatedly fetch tools for each case/cell.
- **Depends on / blocked by:** After shared openai+mcp loop extraction.
