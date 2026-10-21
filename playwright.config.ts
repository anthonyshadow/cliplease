import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { checkTestDatabaseFiles } from "./tests/helpers/test-database";

// e2e env: .env.test, then .env.test.local, parsed with node:util. Playwright starts the
// webServer with { ...process.env, ...webServer.env }, so these values win over the shell.
// .env.test lists every key env.ts reads (blank where unused): next build and next start
// still load .env.local, but only for keys the process doesn't already have.
if (!existsSync(".env.test")) {
  throw new Error("e2e needs .env.test (P01).");
}

// The e2e server signs users in and writes rows: the same guard as the integration tests (never the .env.local
// database).
const testEnv = checkTestDatabaseFiles(".");

export default defineConfig({
  testDir: "tests/e2e",
  // The test-run lock: an overlapping test:int run stops at once instead of emptying the database mid-run.
  globalSetup: "./tests/e2e/global-setup.ts",
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
