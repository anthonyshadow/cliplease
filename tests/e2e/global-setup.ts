// e2e globalSetup: startTestRun's lock for the whole run, so test:e2e and test:int never overlap. Playwright starts the
// webServer first and calls the returned function as the teardown.
import { startTestRun } from "../helpers/test-run-lock";

export default function globalSetup() {
  return startTestRun(process.cwd(), "e2e");
}
