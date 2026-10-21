import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireTestRunLock } from "../helpers/test-run-lock";

// Fake URLs only: every case refuses before connecting, so none reaches a database.
const DEV =
  "postgresql://owner:dev-secret@ep-dev-123.us-east-1.aws.neon.tech/neondb";
const TEST =
  "postgresql://owner:test-secret@ep-test-456.us-east-1.aws.neon.tech/neondb";

const roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true });
});

/** A repo root holding these env files. */
function root(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "cliplease-lock-"));
  roots.push(dir);
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe("the test-run lock (tests/helpers/test-run-lock.ts)", () => {
  it("runs the test-database guard on .env.test before connecting", async () => {
    await expect(
      acquireTestRunLock(
        root({ ".env.test": `APP_ENV=development\nDATABASE_URL=${TEST}\n` }),
        "integration",
      ),
    ).rejects.toThrow(/APP_ENV is not test/);
    await expect(
      acquireTestRunLock(
        root({
          ".env.test": `APP_ENV=test\nDATABASE_URL=${DEV}\nDATABASE_URL_UNPOOLED=${DEV}\n`,
          ".env.local": `DATABASE_URL=${DEV}\n`,
        }),
        "e2e",
      ),
    ).rejects.toThrow(/\.env\.local database/);
  });

  it("needs a direct connection, named in a clear error without the password", async () => {
    const error = await acquireTestRunLock(
      root({ ".env.test": `APP_ENV=test\nDATABASE_URL=${TEST}\n` }),
      "integration",
    ).catch((e: unknown) => e);
    expect(String(error)).toMatch(/needs DATABASE_URL_UNPOOLED/);
    expect(String(error)).not.toMatch(/secret/);
  });
});
