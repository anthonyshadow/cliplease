import { fileURLToPath } from "node:url";
import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";
import { assert, expect } from "vitest";
import { pool } from "../../src/db/client";
import { checkTestDatabaseFiles, emptyPublicTables } from "./test-database";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The integration guard: APP_ENV=test and the database .env.test names, never the development one in .env.local. It
 * checks the connection string the pool actually uses, not only the environment.
 */
export function assertTestDatabase(): void {
  const { APP_ENV, DATABASE_URL_UNPOOLED } = process.env;
  checkTestDatabaseFiles(REPO_ROOT, {
    APP_ENV,
    DATABASE_URL: pool.options.connectionString,
    DATABASE_URL_UNPOOLED,
  });
}

/** Empties every table in schema public, after the guard. */
export async function resetDb(): Promise<void> {
  assertTestDatabase();
  await emptyPublicTables(pool);
}

/** The SQLSTATE codes the integration tests assert. */
export const PG_ERROR = {
  check: "23514",
  unique: "23505",
  foreignKey: "23503",
  // Postgres 18 reports an ON DELETE RESTRICT violation as restrict_violation; NO ACTION (and Postgres 14) say 23503.
  restrict: "23001",
  notNull: "23502",
  invalidInput: "22P02",
} as const;

/**
 * Asserts that `promise` fails with a Postgres error with `code`, and the constraint or column when given. Drizzle
 * wraps the pg error in `.cause`.
 */
export async function expectDbError(
  promise: Promise<unknown>,
  want: {
    code: (typeof PG_ERROR)[keyof typeof PG_ERROR];
    constraint?: string;
    column?: string;
  },
): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  assert.instanceOf(error, DrizzleQueryError);
  assert.instanceOf(error.cause, DatabaseError);
  expect(error.cause).toMatchObject(want);
}
