// next/server's after() for [int] tests (02 §5.10): outside a request it throws, so a test file mocks it with runAfter,
// which starts each task at once and keeps its promise; flushAfter waits for them all, tasks they start included.
//   vi.mock("next/server", async (importOriginal) => ({
//     ...(await importOriginal<typeof import("next/server")>()),
//     after: (await import("../helpers/after")).runAfter,
//   }));

const pending: Promise<unknown>[] = [];

export function runAfter(task: Promise<unknown> | (() => unknown)): void {
  pending.push(
    Promise.resolve().then(() => (typeof task === "function" ? task() : task)),
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
