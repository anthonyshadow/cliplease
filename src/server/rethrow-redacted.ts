import "server-only";
import { unstable_rethrow } from "next/navigation";
import { env } from "./env";
import { logEvent } from "./log";

/** An error rethrowRedacted already logged and replaced: a rethrowRedacted around it lets it through as it is. */
class RedactedError extends Error {}

/**
 * For a catch whose error would otherwise reach Next, which prints it whole: Next's own redirect, notFound and
 * dynamic-rendering errors go on; anything else is logged as `event` (logEvent keeps only a query error's Postgres code
 * and constraint) and a plain Error named after the event is thrown in its place. A DrizzleQueryError's message holds
 * every bound value of its query: a buyer's email, name and IP on the checkout insert, a user id on the creator read
 * (02 §9.9, 07 D47). With APP_ENV=development the error goes on as it is: the data is the developer's own, and the
 * overlay needs the message.
 */
export function rethrowRedacted(error: unknown, event: string): never {
  unstable_rethrow(error);
  if (error instanceof RedactedError || env.APP_ENV === "development") {
    throw error;
  }
  logEvent("error", event, { error });
  throw new RedactedError(event);
}

/** `run`, its unexpected errors through rethrowRedacted as `event`: every server action's body (lint:invariants). */
export function redactErrors<T>(
  event: string,
  run: () => Promise<T>,
): Promise<T> {
  return run().catch((error: unknown) => rethrowRedacted(error, event));
}
