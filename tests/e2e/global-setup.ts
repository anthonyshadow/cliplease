// e2e globalSetup: the test-run lock for the whole run, so test:e2e and test:int never overlap. Playwright starts the
// webServer first and calls the returned function as the teardown.
import { acquireTestRunLock } from "../helpers/test-run-lock";

export default function globalSetup() {
  return acquireTestRunLock(process.cwd(), "e2e");
}
