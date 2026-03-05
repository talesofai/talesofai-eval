import type { Span, SpanKind, TimingSummary } from "../types.ts";

type ActiveSpan = {
  start: number;
  kind: SpanKind;
  parent?: string;
};

export class SpanCollector {
  private spans: Span[] = [];
  private activeSpans = new Map<string, ActiveSpan>();

  start(name: string, kind: SpanKind, parent?: string): void {
    this.activeSpans.set(name, {
      start: Date.now(),
      kind,
      parent,
    });
  }

  end(name: string, attributes?: Span["attributes"]): Span | null {
    const active = this.activeSpans.get(name);
    if (!active) return null;

    const end = Date.now();
    const span: Span = {
      name,
      kind: active.kind,
      start_ms: active.start,
      end_ms: end,
      duration_ms: end - active.start,
      ...(active.parent ? { parent: active.parent } : {}),
      ...(attributes ? { attributes } : {}),
    };

    this.spans.push(span);
    this.activeSpans.delete(name);
    return span;
  }

  getSpans(): Span[] {
    return [...this.spans];
  }

  getSummary(): TimingSummary {
    let mcp_connect_ms = 0;
    let mcp_list_tools_ms = 0;
    let llm_total_ms = 0;
    let llm_first_token_ms: number | null = null;
    let tool_total_ms = 0;
    let turns_count = 0;

    for (const span of this.spans) {
      switch (span.kind) {
        case "mcp_connect":
          mcp_connect_ms += span.duration_ms;
          break;
        case "mcp_list_tools":
          mcp_list_tools_ms += span.duration_ms;
          break;
        case "llm_turn":
          llm_total_ms += span.duration_ms;
          turns_count++;
          if (
            span.attributes?.first_token_ms !== undefined &&
            llm_first_token_ms === null
          ) {
            llm_first_token_ms = span.attributes.first_token_ms;
          }
          break;
        case "tool_call":
          tool_total_ms += span.duration_ms;
          break;
      }
    }

    return {
      mcp_connect_ms,
      mcp_list_tools_ms,
      llm_total_ms,
      llm_first_token_ms,
      tool_total_ms,
      turns_count,
    };
  }
}
