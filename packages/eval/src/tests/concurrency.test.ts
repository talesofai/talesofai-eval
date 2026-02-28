import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runConcurrently } from "../utils/concurrency.ts";

describe("runConcurrently", () => {
  it("returns results in original order", async () => {
    const results = await runConcurrently(
      [
        async () => {
          await sleep(20);
          return "a";
        },
        async () => {
          await sleep(5);
          return "b";
        },
        async () => {
          await sleep(10);
          return "c";
        },
      ],
      3,
    );
    assert.deepEqual(results, ["a", "b", "c"]);
  });

  it("respects concurrency limit", async () => {
    const running: number[] = [];
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      running.push(i);
      maxConcurrent = Math.max(maxConcurrent, running.length);
      await sleep(10);
      running.splice(running.indexOf(i), 1);
      return i;
    });

    await runConcurrently(tasks, 2);
    assert.ok(maxConcurrent <= 2, `max concurrent was ${maxConcurrent}`);
  });

  it("handles empty task list", async () => {
    const results = await runConcurrently([], 4);
    assert.deepEqual(results, []);
  });

  it("concurrency > tasks: runs all in parallel", async () => {
    const order: number[] = [];
    await runConcurrently(
      [
        async () => {
          await sleep(20);
          order.push(0);
        },
        async () => {
          await sleep(5);
          order.push(1);
        },
      ],
      10,
    );
    // shorter task finishes first
    assert.deepEqual(order, [1, 0]);
  });

  it("concurrency 1: sequential execution", async () => {
    const order: number[] = [];
    await runConcurrently(
      [
        async () => {
          order.push(0);
          await sleep(5);
        },
        async () => {
          order.push(1);
        },
      ],
      1,
    );
    assert.deepEqual(order, [0, 1]);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
