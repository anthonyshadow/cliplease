import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  TestInfo,
  Video,
  ViewportSize,
} from "@playwright/test";

// The demo video's recording mode (owner answer Q-215): off unless DEMO_VIDEO=1 (`bun run demo:video`), and then on
// chromium-desktop only. The config slows that project's browser (DEMO_SLOW_MO_MS after every action and navigation)
// and adds the manifest reporter (tests/e2e/reporters/demo-video.ts); demo.spec.ts opens its three windows through
// DemoRecording.newContext, each recording its pages at its own viewport size. When the test has passed, each page's
// video is saved under DEMO_VIDEO_DIR with its window's name and the timing half of the manifest is attached for the
// reporter, which adds the steps; scripts/demo-video.mjs stitches the files into one MP4. A normal run never gets here:
// no video, no slowMo, the same timeouts.

/** The flag. */
export const DEMO_VIDEO = process.env.DEMO_VIDEO === "1";
/** The one project that records. */
export const DEMO_VIDEO_PROJECT = "chromium-desktop";
/** The run's output (git-ignored with .data/): the per-window videos, the manifest, then the MP4 and its frames. */
export const DEMO_VIDEO_DIR = path.join(".data", "demo-video");
export const DEMO_VIDEO_MANIFEST = path.join(DEMO_VIDEO_DIR, "manifest.json");
/** The attachment the spec hands the reporter: the windows' videos and times. */
export const DEMO_VIDEO_ATTACHMENT = "demo-video";
/**
 * The pause after each action and navigation, so a person can follow. Well under 2 s: step 15 reads "Copied", which
 * the publish view shows for 2 s after the press. The stitch also holds each step's start (scripts/demo-video.mjs),
 * which brings the video to 3–4 minutes.
 */
export const DEMO_SLOW_MO_MS = 1_400;
/** The test's timeout while recording (900 s otherwise). */
export const DEMO_TIMEOUT_MS = 1_800_000;

/** The demo's three windows. */
export type DemoRole = "creator" | "buyer" | "admin";

/** One page's video: its window, its place among the window's pages (1 first) and its times (epoch ms). */
export type DemoVideo = {
  role: DemoRole;
  page: number;
  /** The file in DEMO_VIDEO_DIR. */
  file: string;
  /** When the page opened. */
  startedAt: number;
  /**
   * When it showed the app: from each navigation off about:blank to the next one onto it (the spec parks a window on
   * about:blank between pages) or its close (null until then).
   */
  shown: { from: number; to: number | null }[];
  /** When it closed (null: never). */
  closedAt: number | null;
};

/** The attachment's body; the reporter adds the steps. */
export type DemoVideoTimes = { videos: DemoVideo[] };

/** One test.step of the run, as the manifest lists them. */
export type DemoStep = { title: string; startedAt: number; durationMs: number };

/** The manifest scripts/demo-video.mjs reads. */
export type DemoVideoManifest = DemoVideoTimes & { steps: DemoStep[] };

/** The recording of one demo run: its windows' pages and their videos. */
export class DemoRecording {
  private readonly pages: { entry: DemoVideo; video: Video | null }[] = [];

  private constructor(private readonly desktop: ViewportSize) {}

  /** A recording for this test when the flag is on and it runs on DEMO_VIDEO_PROJECT; null otherwise. */
  static start(testInfo: TestInfo): DemoRecording | null {
    if (!DEMO_VIDEO || testInfo.project.name !== DEMO_VIDEO_PROJECT) {
      return null;
    }
    const desktop = testInfo.project.use.viewport;
    if (!desktop) throw new Error(`${DEMO_VIDEO_PROJECT} has no viewport`);
    rmSync(DEMO_VIDEO_DIR, { recursive: true, force: true });
    mkdirSync(DEMO_VIDEO_DIR, { recursive: true });
    return new DemoRecording(desktop);
  }

  /** `options`' context, recording each page at the context's viewport (the project's own when it sets none). */
  async newContext(
    browser: Browser,
    role: DemoRole,
    options: BrowserContextOptions,
  ): Promise<BrowserContext> {
    const size = options.viewport ?? this.desktop;
    const context = await browser.newContext({
      ...options,
      recordVideo: { dir: DEMO_VIDEO_DIR, size },
    });
    context.on("page", (page) => {
      const number =
        this.pages.filter(({ entry }) => entry.role === role).length + 1;
      const entry: DemoVideo = {
        role,
        page: number,
        file: number === 1 ? `${role}.webm` : `${role}-page${number}.webm`,
        startedAt: Date.now(),
        shown: [],
        closedAt: null,
      };
      this.pages.push({ entry, video: page.video() });
      page.on("framenavigated", (frame) => {
        if (frame !== page.mainFrame()) return;
        const last = entry.shown.at(-1);
        const showing = last !== undefined && last.to === null;
        const blank = frame.url() === "about:blank";
        if (blank && last && showing) last.to = Date.now();
        if (!blank && !showing)
          entry.shown.push({ from: Date.now(), to: null });
      });
      page.on("close", () => {
        entry.closedAt = Date.now();
        const last = entry.shown.at(-1);
        if (last && last.to === null) last.to = entry.closedAt;
      });
    });
    return context;
  }

  /** Once every window has closed: each video under its name, and the times attached for the reporter. */
  async finish(testInfo: TestInfo): Promise<void> {
    await Promise.all(
      this.pages.map(async ({ entry, video }) => {
        if (!video)
          throw new Error(`${entry.file}: the page recorded no video`);
        await video.saveAs(path.join(DEMO_VIDEO_DIR, entry.file));
        await video.delete();
      }),
    );
    const times: DemoVideoTimes = {
      videos: this.pages.map(({ entry }) => entry),
    };
    await testInfo.attach(DEMO_VIDEO_ATTACHMENT, {
      contentType: "application/json",
      body: JSON.stringify(times),
    });
  }
}
