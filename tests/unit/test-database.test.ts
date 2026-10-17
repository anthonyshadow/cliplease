import { describe, expect, it } from "vitest";
import { checkTestDatabase, type DatabaseEnv } from "../helpers/test-database";

// Fake URLs only: the guard is pure, so these cases never reach a database.
const DEV_POOLED =
  "postgresql://owner:dev-secret@ep-dev-123-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const DEV_DIRECT =
  "postgresql://owner:dev-secret@ep-dev-123.us-east-1.aws.neon.tech/neondb?sslmode=require";
const TEST_POOLED =
  "postgresql://owner:test-secret@ep-test-456-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const TEST_DIRECT =
  "postgresql://owner:test-secret@ep-test-456.us-east-1.aws.neon.tech/neondb?sslmode=require";
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

function refusal(env: DatabaseEnv, local: string | undefined = LOCAL_ENV) {
  try {
    checkTestDatabase(env, local);
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
