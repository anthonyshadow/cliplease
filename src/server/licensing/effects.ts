import "server-only";
import { after } from "next/server";
import { sendQueuedEmails } from "../email/send";
import { errorName, logEvent } from "../log";
import type { Effect } from "./state-machine";

// A transition's work after its commit (02 §5.7, §5.10; 07 D34). The function that commits the transaction calls
// runEffects; nothing here throws to it.

/** Sends the emails a committed transition queued, after the response. */
export function runEffects(effects: readonly Effect[]): void {
  const ids = effects.map((effect) => effect.emailLogId);
  if (ids.length > 0) afterResponse(() => sendQueuedEmails(ids));
}

/**
 * Runs `task` after the response (Next's after()). A task that fails is logged by its error's name only: Next would
 * print the whole error, and a query error's message holds its values. Outside a request (a script) after() throws: the
 * task is dropped with a log line, and the outbox retry or the cron does what it would have.
 */
export function afterResponse(task: () => Promise<unknown>): void {
  try {
    after(() =>
      task().catch((error: unknown) => {
        logEvent("error", "effects.after_failed", { error: errorName(error) });
      }),
    );
  } catch (error) {
    logEvent("warn", "effects.after_unavailable", {
      error: errorName(error),
    });
  }
}
