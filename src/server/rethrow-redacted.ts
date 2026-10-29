import "server-only";
import { unstable_rethrow } from "next/navigation";
import { logEvent } from "./log";

/**
 * For a catch whose error would otherwise reach Next, which prints it whole: Next's own redirect, notFound and
 * dynamic-rendering errors go on; anything else is logged as `event` (logEvent keeps only a query error's Postgres code
 * and constraint) and a plain Error named after the event is thrown in its place. A DrizzleQueryError's message holds
 * every bound value of its query: a buyer's email, name and IP on the checkout insert, a session token or a user id on
 * the session reads (02 §9.9, 07 D47).
 */
export function rethrowRedacted(error: unknown, event: string): never {
  unstable_rethrow(error);
  logEvent("error", event, { error });
  throw new Error(event);
}
