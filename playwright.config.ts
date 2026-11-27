import { existsSync } from "node:fs";
import {
  defineConfig,
  devices,
  type ReporterDescription,
} from "@playwright/test";
import { DEMO_SLOW_MO_MS, DEMO_VIDEO } from "./tests/e2e/helpers/demo-video";
import { checkTestDatabaseFiles } from "./tests/helpers/test-database";

// e2e env: .env.test, then .env.test.local, parsed with node:util. Playwright starts the webServer with
// { ...process.env, ...webServer.env }, so these values win over the shell. .env.test lists every key env.ts reads
// (blank where unused): next build and next start still load .env.local, but only for keys the process doesn't already
// have.
if (!existsSync(".env.test")) {
  throw new Error("e2e needs .env.test (P01).");
}

// The e2e server signs users in and writes rows: the same guard as the integration tests (never the .env.local
// database).
const testEnv = checkTestDatabaseFiles(".");

// The same values for the specs (CRON_SECRET, ADMIN_EMAILS; P22): Playwright evaluates this file in the runner and in
// every worker. Never logged.
Object.assign(process.env, testEnv);

/** Every project but setup's own runs after it: run.txt and the signed-in roles (07 D54, D154). */
const AFTER_SETUP = ["setup"];

// The demo video's recording run (owner answer Q-215; `bun run demo:video`, DEMO_VIDEO=1): chromium-desktop's browser
// slowed so a person can follow, and the reporter that writes the video manifest. Without the flag neither is set.
const DEMO_REPORTERS: ReporterDescription[] = DEMO_VIDEO
  ? [["./tests/e2e/reporters/demo-video.ts"]]
  : [];
const DEMO_LAUNCH = DEMO_VIDEO
  ? { launchOptions: { slowMo: DEMO_SLOW_MO_MS } }
  : {};

export default defineConfig({
  testDir: "tests/e2e",
  // The test-run lock: an overlapping test:int run stops at once instead of emptying the database mid-run.
  globalSetup: "./tests/e2e/global-setup.ts",
  // One server; the tests run in parallel because each one signs in its own address.
  fullyParallel: true,
  // Gate runs must not hide a flake (P22).
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }], ...DEMO_REPORTERS],
  use: {
    baseURL: "http://localhost:3100",
    // On a failure, the trace (DOM snapshots and network, no screencast: the failure screenshot shows the last state)
    // and that screenshot; every passing test's trace is thrown away, so the screencast was only cost.
    trace: { mode: "retain-on-failure", screenshots: false },
    screenshot: "only-on-failure",
  },
  projects: [
    // Signs in once per role (auth.setup.ts: .auth/run.txt, admin.json, creator.json, @maya.films), its tests in order
    // in one worker; the safety teardown runs once every project that depends on it has finished.
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      teardown: "safety",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "safety",
      testMatch: /.*\.teardown\.ts/,
    },
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], ...DEMO_LAUNCH },
      dependencies: AFTER_SETUP,
    },
    {
      name: "webkit-iphone",
      use: { ...devices["iPhone 17"] },
      dependencies: AFTER_SETUP,
    },
    // The two layout-tier projects run only the responsive spec (07 D154). iPad Mini, not iPad (gen 11): that one is
    // 656 px wide, which is the Mobile tier.
    {
      name: "webkit-ipad", // Tablet, 768 × 1024, WebKit, touch
      use: { ...devices["iPad Mini"] },
      testMatch: /responsive\.spec\.ts$/,
      dependencies: AFTER_SETUP,
    },
    {
      name: "chromium-xl", // XL
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
      },
      testMatch: /responsive\.spec\.ts$/,
      dependencies: AFTER_SETUP,
    },
  ],
  webServer: {
    // next build, then next start --port 3100, with every line of both also in .data/e2e-server.log (the safety
    // teardown scans it).
    command: "node scripts/e2e-server.mjs",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 240_000,
    env: testEnv,
  },
});
