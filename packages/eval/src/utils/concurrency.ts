/**
 * Run tasks with bounded concurrency.
 *
 * - Preserves original order (`results[i]` corresponds to `tasks[i]`).
 * - `concurrency <= 0` behaves as `1`.
 * - When task count is below concurrency, all tasks run in parallel.
 *
 * **Contract:** tasks must not throw. Wrap errors internally and return a
 * result value instead. If a task throws, `Promise.all` rejects immediately
 * and partial results are discarded.
 */
export async function runConcurrently<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const limit = Math.max(1, concurrency);
  const results = new Array<T>(tasks.length);
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      const task = tasks[index];
      if (task) {
        results[index] = await task();
      }
    }
  };

  const workerCount = Math.min(limit, tasks.length);
  if (workerCount === 0) return [];

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
