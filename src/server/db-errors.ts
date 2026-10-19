import "server-only";
import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";

/** The pg error behind a failed query: Drizzle wraps it, so the SQLSTATE and the constraint sit on `cause`. */
function pgError(error: unknown): DatabaseError | null {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  return cause instanceof DatabaseError ? cause : null;
}

/** The unique index a write violated (SQLSTATE 23505), or null. The transaction is already rolled back when this runs. */
export function uniqueViolationConstraint(error: unknown): string | null {
  const pg = pgError(error);
  return pg?.code === "23505" ? (pg.constraint ?? null) : null;
}

/** Whether a statement gave up waiting for a row lock (SQLSTATE 55P03, `lock_timeout`). */
export function isLockTimeout(error: unknown): boolean {
  return pgError(error)?.code === "55P03";
}
