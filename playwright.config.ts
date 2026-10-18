import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";
import { checkTestDatabase } from "./tests/helpers/test-database";

// e2e env: .env.test, then .env.test.local, parsed with node:util. Playwright starts the
// webServer with { ...process.env, ...webServer.env }, so these values win over the shell.
// .env.test lists every key env.ts reads (blank where unused): next build and next start
// still load .env.local, but only for keys the process doesn't already have.
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    parseEnv(readFileSync(path, "utf8")),
  )) {
    // Keep blank values: a blank key still stops .env.local from filling it.
    if (value !== undefined) values[key] = value;
  }
  return values;
}

if (!existsSync(".env.test")) {
  throw new Error("e2e needs .env.test (P01).");
}

const testEnv = {
  ...readEnvFile(".env.test"),
  ...readEnvFile(".env.test.local"),
};

// The e2e server signs users in and writes rows: the same guard as the integration tests (never the .env.local
// database).
checkTestDatabase(
  testEnv,
  existsSync(".env.local") ? readFileSync(".env.local", "utf8") : undefined,
);

export default defineConfig({
  testDir: "tests/e2e",
  // One server; the tests run in parallel because each one signs in its own address.
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:3100",
  },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit-iphone",
      use: { ...devices["iPhone 17"] },
    },
    // The two layout-tier projects run only the responsive spec (07 D154). iPad Mini, not iPad (gen 11): that one is
    // 656 px wide, which is the Mobile tier.
    {
      name: "webkit-ipad", // Tablet, 768 × 1024, WebKit, touch
      use: { ...devices["iPad Mini"] },
      testMatch: /responsive\.spec\.ts$/,
    },
    {
      name: "chromium-xl", // XL
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
      testMatch: /responsive\.spec\.ts$/,
    },
  ],
  webServer: {
    command: "bun run build && bun run start --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 240_000,
    env: testEnv,
  },
});
