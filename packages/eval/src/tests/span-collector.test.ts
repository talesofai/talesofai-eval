import { describe, it } from "node:test";
import assert from "node:assert";
import { SpanCollector } from "../utils/span-collector.ts";

describe("SpanCollector", () => {
  it("starts and ends spans correctly", () => {
    const collector = new SpanCollector();
    collector.start("test_span", "mcp_connect");
    const span = collector.end("test_span");

    assert.ok(span);
    assert.strictEqual(span?.name, "test_span");
    assert.strictEqual(span?.kind, "mcp_connect");
    assert.strictEqual(span?.duration_ms >= 0, true);
  });

  it("returns null when ending a non-existent span", () => {
    const collector = new SpanCollector();
    const span = collector.end("non_existent");
    assert.strictEqual(span, null);
  });

  it("tracks parent spans", () => {
    const collector = new SpanCollector();
    collector.start("parent", "llm_turn");
    collector.start("child", "tool_call", "parent");

    const childSpan = collector.end("child");
    assert.strictEqual(childSpan?.parent, "parent");

    collector.end("parent");
  });

  it("records attributes on end", () => {
    const collector = new SpanCollector();
    collector.start("turn_0", "llm_turn");
    const span = collector.end("turn_0", {
      first_token_ms: 123,
      input_tokens: 100,
      output_tokens: 50,
    });

    assert.strictEqual(span?.attributes?.first_token_ms, 123);
    assert.strictEqual(span?.attributes?.input_tokens, 100);
    assert.strictEqual(span?.attributes?.output_tokens, 50);
  });

  it("getSpans returns all completed spans", () => {
    const collector = new SpanCollector();
    collector.start("span1", "mcp_connect");
    collector.end("span1");
    collector.start("span2", "mcp_list_tools");
    collector.end("span2");

    const spans = collector.getSpans();
    assert.strictEqual(spans.length, 2);
  });

  it("getSpans returns a copy (immutable)", () => {
    const collector = new SpanCollector();
    collector.start("span1", "mcp_connect");
    collector.end("span1");

    const spans1 = collector.getSpans();
    const spans2 = collector.getSpans();

    assert.notStrictEqual(spans1, spans2);
  });

  it("getSummary aggregates timing correctly", async () => {
    const collector = new SpanCollector();

    // MCP connect
    collector.start("mcp_connect", "mcp_connect");
    await new Promise((r) => setTimeout(r, 5));
    collector.end("mcp_connect");

    // MCP list tools
    collector.start("mcp_list_tools", "mcp_list_tools");
    await new Promise((r) => setTimeout(r, 5));
    collector.end("mcp_list_tools");

    // LLM turn
    collector.start("turn_0", "llm_turn");
    await new Promise((r) => setTimeout(r, 10));
    collector.end("turn_0", { first_token_ms: Date.now() });

    // Tool call
    collector.start("tool_test", "tool_call", "turn_0");
    await new Promise((r) => setTimeout(r, 5));
    collector.end("tool_test");

    const summary = collector.getSummary();

    assert.ok(summary.mcp_connect_ms >= 5);
    assert.ok(summary.mcp_list_tools_ms >= 5);
    assert.ok(summary.llm_total_ms >= 10);
    assert.ok(summary.tool_total_ms >= 5);
    assert.strictEqual(summary.turns_count, 1);
    assert.ok(summary.llm_first_token_ms !== null);
  });

  it("getSummary records first token from first llm_turn only", async () => {
    const collector = new SpanCollector();

    const firstTokenTime = Date.now();

    collector.start("turn_0", "llm_turn");
    collector.end("turn_0", { first_token_ms: firstTokenTime });

    collector.start("turn_1", "llm_turn");
    collector.end("turn_1", { first_token_ms: Date.now() });

    const summary = collector.getSummary();

    assert.strictEqual(summary.llm_first_token_ms, firstTokenTime);
    assert.strictEqual(summary.turns_count, 2);
  });

  it("getSummary returns zeros for empty collector", () => {
    const collector = new SpanCollector();
    const summary = collector.getSummary();

    assert.strictEqual(summary.mcp_connect_ms, 0);
    assert.strictEqual(summary.mcp_list_tools_ms, 0);
    assert.strictEqual(summary.llm_total_ms, 0);
    assert.strictEqual(summary.llm_first_token_ms, null);
    assert.strictEqual(summary.tool_total_ms, 0);
    assert.strictEqual(summary.turns_count, 0);
  });

  it("handles multiple tool calls", async () => {
    const collector = new SpanCollector();

    collector.start("turn_0", "llm_turn");
    await new Promise((r) => setTimeout(r, 5));
    collector.end("turn_0");

    collector.start("tool_1", "tool_call", "turn_0");
    await new Promise((r) => setTimeout(r, 3));
    collector.end("tool_1");

    collector.start("tool_2", "tool_call", "turn_0");
    await new Promise((r) => setTimeout(r, 4));
    collector.end("tool_2");

    const summary = collector.getSummary();

    assert.ok(summary.tool_total_ms >= 7);
    assert.strictEqual(summary.turns_count, 1);
  });
});
