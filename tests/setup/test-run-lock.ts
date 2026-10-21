// Integration globalSetup: the test-run lock for the whole run, so test:int and test:e2e never overlap. It runs once in
// the main Vitest process, before tests/setup/load-env.ts runs in any worker, so it reads .env.test itself.
import type { TestProject } from "vitest/node";
import { acquireTestRunLock } from "../helpers/test-run-lock";

export default function setup(project: TestProject) {
  return acquireTestRunLock(project.config.root, "integration");
}
