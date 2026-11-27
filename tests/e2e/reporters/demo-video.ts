import { writeFileSync } from "node:fs";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import {
  DEMO_VIDEO_ATTACHMENT,
  DEMO_VIDEO_MANIFEST,
  type DemoVideoManifest,
  type DemoVideoTimes,
} from "../helpers/demo-video";

// The demo video's manifest (owner answer Q-215), in the recording run only (playwright.config.ts adds this reporter
// when DEMO_VIDEO=1): for the test that attached its windows' video times (demo.spec.ts, once it has passed), those
// times and each of its top-level test.step's title and start, which scripts/demo-video.mjs aligns and captions by.
export default class DemoVideoReporter implements Reporter {
  onTestEnd(_test: TestCase, result: TestResult) {
    const times = result.attachments.find(
      ({ name }) => name === DEMO_VIDEO_ATTACHMENT,
    )?.body;
    if (times === undefined) return;
    const manifest: DemoVideoManifest = {
      ...(JSON.parse(times.toString("utf8")) as DemoVideoTimes),
      steps: result.steps
        .filter(({ category }) => category === "test.step")
        .map(({ title, startTime, duration }) => ({
          title,
          startedAt: startTime.getTime(),
          durationMs: duration,
        })),
    };
    writeFileSync(
      DEMO_VIDEO_MANIFEST,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  }

  printsToStdio() {
    return false;
  }
}
