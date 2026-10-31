// next/server's after() for [int] tests (02 §5.10): outside a request it throws, so a test file mocks it with runAfter,
// which starts each task at once and keeps its promise; flushAfter waits for them all, tasks they start included.
//   vi.mock("next/server", async (importOriginal) => ({
//     ...(await importOriginal<typeof import("next/server")>()),
//     after: (await import("../helpers/after")).runAfter,
//   }));
// Queue mode (P19b): after queueAfter(), runAfter only stores each task, so a test can look at the committed state
// before the after() work (a creator transfer, a sweep) runs, then run it (runQueuedAfter) or lose it as a crash would
// (dropQueuedAfter). resetAfter, in afterEach (finishScriptedTest calls it), returns to running at once and fails the
// test when stored tasks were neither run nor dropped.

type Task = Promise<unknown> | (() => unknown);

const pending: Promise<unknown>[] = [];

/** The tasks queue mode stored, in order; undefined while tasks start at once. */
let queued: Task[] | undefined;

export function runAfter(task: Task): void {
  if (queued) {
    queued.push(task);
    return;
  }
  pending.push(start(task));
}

function start(task: Task): Promise<unknown> {
  return Promise.resolve().then(() =>
    typeof task === "function" ? task() : task,
  );
}

/**
 * Waits until every task runAfter started has settled; rejects with the first failure. Tasks from src never reject:
 * afterResponse logs effects.after_failed instead, so a suite that must see one watches stderr for it (logs.ts
 * AFTER_FAILED, recordStderr).
 */
export async function flushAfter(): Promise<void> {
  while (pending.length > 0) await Promise.all(pending.splice(0));
}

/** From now on runAfter stores its tasks instead of starting them, until resetAfter. */
export function queueAfter(): void {
  queued ??= [];
}

/** The queue, or a throw when queueAfter wasn't called. */
function storedTasks(caller: string): Task[] {
  if (!queued) throw new Error(`${caller}: call queueAfter() first`);
  return queued;
}

/**
 * Starts the stored tasks together, then the ones they store, until none is left (the mode stays queue). Rejects, once
 * all have settled, with the first failure, as flushAfter does; afterResponse's tasks never reject.
 */
export async function runQueuedAfter(): Promise<void> {
  const tasks = storedTasks("runQueuedAfter");
  const failures: unknown[] = [];
  while (tasks.length > 0) {
    for (const result of await Promise.allSettled(tasks.splice(0).map(start))) {
      if (result.status === "rejected") failures.push(result.reason);
    }
  }
  if (failures.length > 0) throw failures[0];
}

/** Forgets the stored tasks, as a crash after the commit would; the mode stays queue. Returns how many there were. */
export function dropQueuedAfter(): number {
  return storedTasks("dropQueuedAfter").splice(0).length;
}

/** For afterEach: back to starting tasks at once. Throws when stored tasks were neither run nor dropped (forgotten). */
export function resetAfter(): void {
  const left = queued?.length ?? 0;
  queued = undefined;
  if (left > 0) {
    throw new Error(
      `${left} queued after() task(s) neither run nor dropped: runQueuedAfter() or dropQueuedAfter()`,
    );
  }
}
