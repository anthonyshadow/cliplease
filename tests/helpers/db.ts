import { fileURLToPath } from "node:url";
import { DrizzleQueryError, sql } from "drizzle-orm";
import { DatabaseError } from "pg";
import { assert, expect } from "vitest";
import { db, pool } from "../../src/db/client";
import { checkTestDatabaseFiles } from "./test-database";

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

/** Empties every table in schema public (Drizzle's journal lives in schema drizzle and stays). */
export async function resetDb(): Promise<void> {
  assertTestDatabase();
  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`,
  );
  if (tables.rows.length === 0) {
    throw new Error(
      "The test database has no tables: run NODE_ENV=test bun run db:migrate",
    );
  }
  const names = tables.rows.map((t) => sql.identifier(t.tablename));
  await db.execute(
    sql`truncate table ${sql.join(names, sql`, `)} restart identity cascade`,
  );
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
