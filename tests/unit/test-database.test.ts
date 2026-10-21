import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkTestDatabase,
  type DatabaseEnv,
  readEnvFiles,
} from "../helpers/test-database";

// Fake URLs only: the guard is pure, so these cases never reach a database.
const DEV_POOLED =
  "postgresql://owner:dev-secret@ep-dev-123-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const DEV_DIRECT =
  "postgresql://owner:dev-secret@ep-dev-123.us-east-1.aws.neon.tech/neondb?sslmode=require";
const TEST_POOLED =
  "postgresql://owner:test-secret@ep-test-456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const TEST_DIRECT =
  "postgresql://owner:test-secret@ep-test-456.us-east-1.aws.neon.tech/neondb?sslmode=require";
// A third database, as from a DATABASE_URL exported in the shell (it wins over the env files).
const OTHER_POOLED =
  "postgresql://owner:other-secret@ep-other-789-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const LOCAL_ENV = `APP_ENV=development\nDATABASE_URL=${DEV_POOLED}\nDATABASE_URL_UNPOOLED=${DEV_DIRECT}\n`;

const testEnv: DatabaseEnv = {
  APP_ENV: "test",
  DATABASE_URL: TEST_POOLED,
  DATABASE_URL_UNPOOLED: TEST_DIRECT,
};
const pooledOnly = (url: string): DatabaseEnv => ({
  APP_ENV: "test",
  DATABASE_URL: url,
});

// `fileEnv` (what .env.test names) defaults to `env` itself: the run uses the files' values, as e2e always does.
function refusal(
  env: DatabaseEnv,
  local: string | undefined = LOCAL_ENV,
  fileEnv: DatabaseEnv = env,
) {
  try {
    checkTestDatabase(env, local, fileEnv);
  } catch (error) {
    return String(error);
  }
  return null;
}

describe("the test-database guard (tests/helpers/test-database.ts)", () => {
  it("passes for a test database that isn't the development one, and without a .env.local", () => {
    expect(refusal(testEnv)).toBeNull();
    expect(refusal(testEnv, undefined)).toBeNull();
  });

  it("passes for the .env.test database written differently (direct host, rotated password)", () => {
    expect(
      refusal(
        pooledOnly(TEST_DIRECT.replace("test-secret", "rotated")),
        LOCAL_ENV,
        testEnv,
      ),
    ).toBeNull();
  });

  it("refuses a database that is neither .env.local's nor .env.test's, without printing a password", () => {
    const why = refusal(pooledOnly(OTHER_POOLED), LOCAL_ENV, testEnv);
    expect(why).toMatch(/not the \.env\.test database/);
    expect(why).not.toMatch(/secret/);
    expect(refusal(pooledOnly(OTHER_POOLED), undefined, testEnv)).toMatch(
      /not the \.env\.test database/,
    );
  });

  it("refuses when .env.test names no database", () => {
    expect(refusal(testEnv, LOCAL_ENV, { APP_ENV: "test" })).toMatch(
      /\.env\.test has no DATABASE_URL/,
    );
  });

  it("compares against .env.local's direct URL too", () => {
    const local =
      "DATABASE_URL=postgresql://u:dev-secret@localhost:6432/cliplease_dev\nDATABASE_URL_UNPOOLED=postgresql://u:dev-secret@localhost:5432/cliplease_dev\n";
    expect(
      refusal(
        pooledOnly("postgresql://u:x@localhost:5432/cliplease_dev"),
        local,
      ),
    ).toMatch(/\.env\.local database \(DATABASE_URL_UNPOOLED\)/);
  });

  it.each([
    [
      "APP_ENV is development",
      { ...testEnv, APP_ENV: "development" },
      /APP_ENV is not test/,
    ],
    [
      "APP_ENV is unset",
      { ...testEnv, APP_ENV: undefined },
      /APP_ENV is not test/,
    ],
    [
      "DATABASE_URL is unset",
      { ...testEnv, DATABASE_URL: undefined },
      /DATABASE_URL is not set/,
    ],
    [
      "it is the dev database",
      {
        APP_ENV: "test",
        DATABASE_URL: DEV_POOLED,
        DATABASE_URL_UNPOOLED: DEV_DIRECT,
      },
      /\.env\.local database/,
    ],
    [
      "DATABASE_URL is the dev direct URL",
      pooledOnly(DEV_DIRECT),
      /\.env\.local database/,
    ],
    [
      "DATABASE_URL is the dev database written differently",
      pooledOnly(
        `${DEV_POOLED.replace("dev-secret", "rotated")}&channel_binding=require`,
      ),
      /\.env\.local database/,
    ],
    [
      "a query parameter points pg at the dev host",
      pooledOnly(`${TEST_POOLED}&host=ep-dev-123.us-east-1.aws.neon.tech`),
      /\.env\.local database/,
    ],
    [
      "the test pair points at two databases",
      { ...testEnv, DATABASE_URL_UNPOOLED: DEV_DIRECT },
      /different databases/,
    ],
    [
      "DATABASE_URL can't be parsed",
      pooledOnly("postgresql://owner:test-secret@[bad/neondb"),
      /not a valid URL/,
    ],
  ])("refuses when %s, without printing a password", (_case, env, message) => {
    const why = refusal(env);
    expect(why).toMatch(message);
    expect(why).not.toMatch(/secret|rotated/);
  });
});

describe("readEnvFiles", () => {
  it("lets later files win, keeps blank values and skips a missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "cliplease-env-"));
    writeFileSync(
      join(dir, ".env.test"),
      "APP_ENV=test\nDATABASE_URL=a\nEMAIL_FROM=\n",
    );
    writeFileSync(join(dir, ".env.test.local"), "DATABASE_URL=b\n");
    expect(
      readEnvFiles([
        join(dir, ".env.test"),
        join(dir, ".env.test.local"),
        join(dir, ".env.missing"),
      ]),
    ).toEqual({ APP_ENV: "test", DATABASE_URL: "b", EMAIL_FROM: "" });
    rmSync(dir, { recursive: true });
  });
});
