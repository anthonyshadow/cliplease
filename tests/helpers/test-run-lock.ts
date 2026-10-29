import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { pruneOldEmails } from "./read-latest-email";
import { checkTestDatabaseFiles, emptyPublicTables } from "./test-database";

// One test run at a time: both suites empty every table of the .env.test database the e2e server uses and share .data
// (PROGRESS P03). Both runners take this session advisory lock for their whole run, on a direct connection (Neon's
// PgBouncer pools by transaction, so a pooled session can't hold it). It frees itself if the process dies.
const LOCK_KEY = "cliplease.test_run";

export type TestSuite = "integration" | "e2e";

/**
 * Starts a test run: takes the test-run lock on the database that `root`'s .env.test names, after the same guard the
 * tests use; then, on the lock's own connection, applies any migration in drizzle/ it doesn't have yet and empties it, so
 * the run starts on the current schema and clean whatever an interrupted run left, and deletes the test emails sent
 * more than a day ago. Resolves to the function that releases the lock;
 * throws a clear error when another run holds it or the database can't be reached.
 */
export async function startTestRun(
  root: string,
  suite: TestSuite,
): Promise<() => Promise<void>> {
  const fileEnv = checkTestDatabaseFiles(root);
  if (!fileEnv.DATABASE_URL_UNPOOLED) {
    throw new Error(
      "The test-run lock needs DATABASE_URL_UNPOOLED (a direct connection) in .env.test.",
    );
  }
  const client = new Client({
    connectionString: fileEnv.DATABASE_URL_UNPOOLED,
    connectionTimeoutMillis: 30_000,
  });
  // Without a listener a dropped connection would crash the runner; it only frees the lock early.
  client.on("error", (error) => {
    process.stderr.write(
      `The test-run lock's connection dropped (${error.message}): another run can start now.\n`,
    );
  });
  let locked: boolean;
  try {
    await client.connect();
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      [LOCK_KEY],
    );
    locked = result.rows[0]?.locked === true;
  } catch (error) {
    client.end().catch(() => undefined);
    throw new Error(
      `The ${suite} run can't take the test-run lock: the .env.test database can't be reached.`,
      { cause: error },
    );
  }
  if (!locked) {
    await client.end();
    throw new Error(
      `The ${suite} run can't start: another test run (bun run test:int or bun run test:e2e) is using the test database and .data. Run them one after the other.`,
    );
  }
  try {
    await migrate(drizzle({ client }), {
      migrationsFolder: path.join(root, "drizzle"),
    });
    await emptyPublicTables(client);
    await pruneOldEmails();
  } catch (error) {
    await client.end();
    throw new Error(
      `The ${suite} run can't migrate and empty the test database and old test emails.`,
      { cause: error },
    );
  }
  // Ending the session releases the lock.
  return () => client.end();
}
