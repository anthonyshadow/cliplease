import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig, devices } from "@playwright/test";

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

export default defineConfig({
  testDir: "tests/e2e",
  // The tests only read pages, so they run in parallel against the one server.
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
  ],
  webServer: {
    command: "bun run build && bun run start --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 240_000,
    env: testEnv,
  },
});
