import "server-only";
import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";

/**
 * The unique index a write violated (SQLSTATE 23505), or null. Drizzle wraps the pg error, so the code and the
 * constraint sit on `cause`; the transaction is already rolled back when this runs.
 */
export function uniqueViolationConstraint(error: unknown): string | null {
  const cause = error instanceof DrizzleQueryError ? error.cause : error;
  if (!(cause instanceof DatabaseError) || cause.code !== "23505") return null;
  return cause.constraint ?? null;
}
