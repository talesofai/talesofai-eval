import type { Span, SpanKind, TimingSummary } from "../types.ts";

type ActiveSpan = {
  start: number;
  kind: SpanKind;
  parent?: string;
};

/**
 * Compute timing summary from a list of spans.
 * Shared utility to avoid code duplication across reporters.
 */
export function computeTimingSummary(spans: Span[] | undefined): TimingSummary | null {
  if (!spans || spans.length === 0) return null;

  const summary: TimingSummary = {
    mcp_connect_ms: 0,
    mcp_list_tools_ms: 0,
    llm_total_ms: 0,
    llm_first_token_ms: null,
    tool_total_ms: 0,
    turns_count: 0,
  };

  for (const span of spans) {
    switch (span.kind) {
      case "mcp_connect":
        summary.mcp_connect_ms += span.duration_ms;
        break;
      case "mcp_list_tools":
        summary.mcp_list_tools_ms += span.duration_ms;
        break;
      case "llm_turn":
        summary.llm_total_ms += span.duration_ms;
        summary.turns_count++;
        if (
          span.attributes?.first_token_ms !== undefined &&
          summary.llm_first_token_ms === null
        ) {
          summary.llm_first_token_ms = span.attributes.first_token_ms;
        }
        break;
      case "tool_call":
        summary.tool_total_ms += span.duration_ms;
        break;
    }
  }

  return summary;
}

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
    const summary = computeTimingSummary(this.spans);
    return summary ?? {
      mcp_connect_ms: 0,
      mcp_list_tools_ms: 0,
      llm_total_ms: 0,
      llm_first_token_ms: null,
      tool_total_ms: 0,
      turns_count: 0,
    };
  }
}
