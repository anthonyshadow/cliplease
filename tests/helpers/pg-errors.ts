// What a failed query throws, for unit tests: pg's DatabaseError with a SQLSTATE and a constraint, bare or wrapped by
// Drizzle. Shared by the db-errors, postings ownership and redacted-error tests.
import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";

/** A pg error with SQLSTATE `code` and, for a constraint violation, the constraint's name. */
export function pgError(code: string, constraint?: string): DatabaseError {
  const error = new DatabaseError("boom", 0, "error");
  error.code = code;
  error.constraint = constraint;
  return error;
}

/** `cause` as Drizzle throws it from a failed query: `query` with its bound `params` in the message. */
export const wrapped = (
  cause: Error,
  query = "select 1",
  params: unknown[] = [],
) => new DrizzleQueryError(query, params, cause);
