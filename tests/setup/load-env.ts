// Vitest root setup file. Vitest runs with NODE_ENV=test, so @next/env loads
// .env.test.local, .env.test and .env (in that order of precedence) and never .env.local.
// Keys already set in the shell win over the files, so the integration guard (tests/helpers/db.ts)
// refuses a DATABASE_URL that isn't the .env.test database.
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

if (process.env.APP_ENV !== "test") {
  throw new Error(
    "Tests need APP_ENV=test: create .env.test (P01) and run them with `bun run test` or `bun run test:int`.",
  );
}
