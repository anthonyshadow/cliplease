import { Client } from "pg";
import { checkTestDatabaseFiles } from "../../helpers/test-database";

// The test database for a spec that must set up what the app has no way to (a row's times, a forced state). Plain Node,
// like read-latest-email.ts: the runner has no app environment, so it reaches the database through the guard and the
// URL playwright.config.ts uses, and .env.local can't be reached. Import it only from the spec helpers that need it, so
// the guard doesn't load into every spec.

/** Runs `run` on a connection to the test database, then closes it. */
export async function withTestDb<T>(
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: checkTestDatabaseFiles(".").DATABASE_URL_UNPOOLED,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}
