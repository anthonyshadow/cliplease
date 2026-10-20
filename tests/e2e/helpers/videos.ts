import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  type Locator,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import { pressButton, requestEnded } from "./press";

// The plain upload as a creator does it (P10b), for the upload specs and M3's later ones (P11, P11c, P13).

export const NEW_VIDEO = "/dashboard/videos/new";
export const SAMPLE_MP4 = "tests/fixtures/sample.mp4";
export const POSTER_JPG = "tests/fixtures/poster.jpg";
export const CANT_PREVIEW =
  "We can't preview this format in your browser. Your file is fine. Add a cover image for buyers.";
const FILE_STEP = /\/dashboard\/videos\/([0-9a-f-]{36})\?step=file$/;

/** The local storage driver's folder, which the e2e server shares with `bun run dev` (STORAGE_DRIVER=local). */
export const STORAGE_ROOT = path.join(process.cwd(), ".data", "storage");

// The drafts this worker's running test made (createDraft adds; cleanCreatedVideos removes their files).
const created = new Set<string>();

/**
 * Removes what the drafts made in this test stored: their originals, posters and still-open multipart uploads (a
 * Cancel leaves one until P10c's abort), found by video id. Nothing else in the shared folder is touched.
 */
export async function cleanCreatedVideos() {
  const ids = [...created];
  created.clear();
  if (ids.length === 0) return;
  const multipart = path.join(STORAGE_ROOT, ".multipart");
  const listed = (dir: string) => readdir(dir).catch(() => [] as string[]);
  const [creators, uploads] = await Promise.all([
    listed(path.join(STORAGE_ROOT, "originals")),
    listed(multipart),
  ]);
  const keys = await Promise.all(
    uploads.map((upload) =>
      readFile(path.join(multipart, upload, "manifest.json"), "utf8")
        .then((text) => String((JSON.parse(text) as { key?: unknown }).key))
        .catch(() => ""),
    ),
  );
  const paths = [
    ...ids.flatMap((id) => [
      path.join(STORAGE_ROOT, "posters", id),
      ...creators.map((c) => path.join(STORAGE_ROOT, "originals", c, id)),
    ]),
    ...uploads
      .filter((_, n) => ids.some((id) => keys[n]?.includes(`/${id}/`)))
      .map((upload) => path.join(multipart, upload)),
  ];
  await Promise.all(paths.map((p) => rm(p, { recursive: true, force: true })));
}

/** A POST to /api/uploads/<route>. */
export const uploadRoute = (
  request: Request,
  route: "start" | "parts" | "complete" | "abort",
) =>
  request.method() === "POST" &&
  request.url().endsWith(`/api/uploads/${route}`);

/** The File step's original picker and the cover picker (both visually hidden inputs). */
export const originalInput = (page: Page) =>
  page.locator('input[type="file"][accept="video/mp4,video/quicktime"]');
export const coverInput = (page: Page) =>
  page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]');

/** The cover <img> on the File step. */
export const coverImage = (page: Page): Locator =>
  page.getByRole("img", { name: /^Cover image for / });

/** S18: a title, then Continue; returns the new draft's id once its File step is open. */
export async function createDraft(
  page: Page,
  title = "Rooftop storm timelapse",
): Promise<string> {
  await page.goto(NEW_VIDEO);
  await page.getByLabel("Title", { exact: true }).fill(title);
  await pressButton(page, "Continue");
  await page.waitForURL(FILE_STEP);
  const id = FILE_STEP.exec(page.url())?.[1];
  if (!id) throw new Error("no video id in the File step's URL");
  created.add(id);
  return id;
}

/**
 * Watches for a poster complete answering 200 from now on. Start it before the original is chosen: the frame's cover
 * can be stored before the original finishes.
 */
export function trackPosterStored(page: Page): () => boolean {
  let stored = false;
  page.on("response", (response) => {
    const request = response.request();
    if (
      uploadRoute(request, "complete") &&
      response.status() === 200 &&
      request.postDataJSON()?.kind === "poster"
    ) {
      stored = true;
    }
  });
  return () => stored;
}

/**
 * Waits for "Original attached" and a stored cover: the captured frame where the browser decodes H.264, else
 * tests/fixtures/poster.jpg through "Choose an image" (here Playwright's Chromium reads a frame and its WebKit doesn't).
 * Returns the cover's path.
 */
export async function waitForAttached(
  page: Page,
  posterStored: () => boolean,
): Promise<"frame_capture" | "creator_image"> {
  await expect(page.getByText(/^Original attached/).first()).toBeVisible({
    timeout: 30_000,
  });
  const cantPreview = page.getByText(CANT_PREVIEW, { exact: true });
  await expect(coverImage(page).or(cantPreview)).toBeVisible({
    timeout: 20_000,
  });
  let origin: "frame_capture" | "creator_image" = "frame_capture";
  if (await cantPreview.isVisible()) {
    await coverInput(page).setInputFiles(POSTER_JPG);
    origin = "creator_image";
  }
  await expect(coverImage(page)).toBeVisible();
  await expect.poll(posterStored, { timeout: 20_000 }).toBe(true);
  return origin;
}

/** Attaches tests/fixtures/sample.mp4 on the open File step and waits for it and its cover (waitForAttached). */
export async function attachSample(page: Page) {
  const stored = trackPosterStored(page);
  await originalInput(page).setInputFiles(SAMPLE_MP4);
  return waitForAttached(page, stored);
}

/**
 * Holds every POST /api/uploads/parts until `release()`: the upload shows its uploading state (bar, "0% · …", Cancel)
 * for as long as a test needs, without touching the binary part PUTs. `ended` settles once the first parts request has
 * ended either way (answered, or aborted by a Cancel).
 */
export async function holdPartUrls(page: Page) {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ended = requestEnded(page, (r) => uploadRoute(r, "parts"));
  await page.route("**/api/uploads/parts", async (route: Route) => {
    await released;
    // A Cancel may have aborted the request meanwhile.
    await route.continue().catch(() => undefined);
  });
  return {
    release: async () => {
      release();
      await page.unroute("**/api/uploads/parts");
    },
    ended,
  };
}

/** Whether a beforeunload listener would stop the tab from closing right now (the upload store's guard). */
export const leaveIsGuarded = (page: Page) =>
  page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
