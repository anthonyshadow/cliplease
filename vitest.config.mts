import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    setupFiles: ["./tests/setup/load-env.ts"],
    // `--changed` (bun run test:changed, test:int:changed) runs only the tests whose imports reach a changed file. A
    // change to any of these runs every test: files read without being imported, and what the setup files import (no
    // test imports it, so no test would be picked). Env files other than .env.example are ignored by git and never show
    // as changed: run the full suite after editing one.
    forceRerunTriggers: [
      ...configDefaults.forceRerunTriggers,
      "**/bun.lock",
      "**/tsconfig.json",
      "**/.env.example",
      "**/drizzle/**",
      "**/src/app/globals.css",
      "**/src/db/client.ts",
      "**/tests/fixtures/**",
      "**/tests/setup/**",
      "**/tests/helpers/{db,read-latest-email,test-database,test-run-lock}.ts",
    ],
    reporters: [["default", { summary: false }]],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: [
            "src/**/*.test.ts",
            "src/**/*.test.tsx",
            "tests/unit/**/*.test.ts",
            "tests/unit/**/*.test.tsx",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          // The files share one test database, so they run one at a time. Vitest's default `isolate: true` must stay:
          // each file gets its own pool, which its setup ends after the file.
          fileParallelism: false,
          // The test-run lock, held for the whole run: test:int and test:e2e share the database and .data.
          globalSetup: ["./tests/setup/test-run-lock.ts"],
          // Joined after the root setupFiles (extends: true), so load-env.ts runs first.
          setupFiles: ["./tests/setup/integration.ts"],
          // A Neon compute waking from sleep can take several seconds.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
