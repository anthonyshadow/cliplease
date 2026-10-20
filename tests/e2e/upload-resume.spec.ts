import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { collectConsoleErrors, type ExpectedFailure } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import { pressButton, pressLink, waitInPage } from "./helpers/press";
import {
  AT_REST,
  abortAnswered,
  cancelAndWaitForAbort,
  chooseOriginal,
  cleanCreatedVideos,
  createDraft,
  DRAFT_TITLE,
  holdUploadRoute,
  isOriginalStart,
  isPartPutRequest,
  multipartDir,
  originalInput,
  type PartAction,
  type PartRule,
  partNumberOf,
  readResumeHint,
  routePartPuts,
  SAMPLE_MP4,
  trackPartPuts,
  trackPartUrlRequests,
  trackStoredParts,
  uploadCard,
  uploadRoute,
  writeTestMp4,
} from "./helpers/videos";

// P10c's resumable original upload (07 D80, 04 §9.26; owner answers Q-45 a, Q-46 a, Q-47 a, Q-49 b) on chromium-desktop
// and webkit-iphone: a failed part is retried through a re-signed URL, a reload resumes from the server's parts once the
// same file is chosen, Cancel ends the upload on the server, offline pauses and goes on by itself, the floating card
// shows the pause, a second tab on the same video waits for the first, and the File step shows the iPhone hint on the
// iPhone only. Each test signs up its own creator; the 40 MiB file (16 + 16 + 8 MiB parts) is written once per worker.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const MIB = 1024 ** 2;
const SIZE = 40 * MIB;
const FILE_NAME = "resume-40mib.mp4";
const RETRYING = "Connection lost. Retrying…";
const ATTACHED = /^Original attached/;
const PAUSED_HERE = /^Upload paused at (\d+)%\. Check your connection\.$/;
// The part PUTs, and the part URL requests, a test cuts off with route.abort('failed').
const ABORTED_PARTS: ExpectedFailure = { abortedUnder: "/api/dev/storage/" };
const ABORTED_PART_URLS: ExpectedFailure = {
  abortedUnder: "/api/uploads/parts",
};

let bigFileWritten: Promise<string> | undefined;

/** The 40 MiB file, written once per worker (no test changes it) in a folder of its own, so it keeps FILE_NAME. */
function bigFile(): Promise<string> {
  const { project, workerIndex } = test.info();
  const dir = path.join(project.outputDir, `resume-worker-${workerIndex}`);
  bigFileWritten ??= mkdir(dir, { recursive: true }).then(() =>
    writeTestMp4(path.join(dir, FILE_NAME), SIZE),
  );
  return bigFileWritten;
}

/** The File step's polite live region (04 §9.26). The floating card's own region sits outside <main>. */
const announcer = (page: Page) => page.locator('main p[aria-live="polite"]');
/** The visible line under the held bar (the live region repeats its words). */
const retryingLine = (page: Page) =>
  page.locator("main p:not([aria-live])", { hasText: RETRYING });
// Retrying shows on a part's first failed send, but Chromium hands every 16 MiB part body through Playwright's
// interception first, which under five parallel 40 MiB uploads takes more than 5 s at times.
const RETRYING_SHOWS_MS = 15_000;

/** Holds part `n`'s sends until `opened` settles; the other parts go through. */
const holdPart =
  (n: number, opened: Promise<void>): PartRule =>
  async (part): Promise<PartAction> => {
    if (part === n) await opened;
    return "continue";
  };

type Picked = { name: string; size: number; lastModified: number };

/**
 * Records every file the page's inputs receive (from the next load on), before the File step's handler clears the
 * input: the lastModified each project reports for the same path.
 */
async function recordPicks(page: Page) {
  await page.addInitScript(() => {
    const picks: Picked[] = [];
    Object.assign(window, { e2ePicks: picks });
    document.addEventListener(
      "change",
      (event) => {
        const file =
          event.target instanceof HTMLInputElement
            ? event.target.files?.[0]
            : undefined;
        if (file) {
          picks.push({
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
          });
        }
      },
      true,
    );
  });
}

const lastPick = (page: Page) =>
  page.evaluate(
    () => (window as Window & { e2ePicks?: Picked[] }).e2ePicks?.at(-1) ?? null,
  );

/**
 * Chooses the 40 MiB file with its part URL requests cut off, and reloads once the first one has failed (so none is in
 * flight then): start has opened the upload on the server and written the hint, and no part is sent, so the paused box
 * says 0 %. The cut-off lasts until the reload is done, so a retry can't get through. Returns the paused upload's id.
 */
async function pausedAfterReload(page: Page, big: string): Promise<string> {
  await page.route("**/api/uploads/parts", (route) => route.abort("failed"));
  const cutOff = page.waitForEvent("requestfailed", (r) =>
    uploadRoute(r, "parts"),
  );
  const uploadId = await chooseOriginal(page, big);
  await cutOff;
  await page.reload();
  await page.unroute("**/api/uploads/parts");
  await expect(
    page.getByText("Upload paused at 0%. Choose the same file to continue."),
  ).toBeVisible();
  return uploadId;
}

test("a failed part is retried through a re-signed URL; after a reload the same file resumes and sends only the missing part", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page, [ABORTED_PARTS]);
  page.on("dialog", (dialog) => dialog.accept());
  const big = await bigFile();
  const other = await writeTestMp4(testInfo.outputPath("other.mp4"), MIB);
  await recordPicks(page);
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);

  // Phase 1: part 2's first send and every part 3 fail as dropped connections.
  const sendTimes: number[] = [];
  const parts = await routePartPuts(page, (part, before) => {
    if (part === 2) sendTimes.push(Date.now());
    return (part === 2 && before === 0) || part === 3 ? "abort" : "continue";
  });
  const stored = trackStoredParts(page);
  const asked = trackPartUrlRequests(page);
  const uploadId = await chooseOriginal(page, big);
  await expect(retryingLine(page)).toBeVisible({ timeout: RETRYING_SHOWS_MS });
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();

  // Parts 1 and 2 are stored; part 2 went twice, the second time through a URL signed for it alone after the first wait.
  await expect.poll(stored, { timeout: 30_000 }).toEqual([1, 2]);
  expect(parts.sent(2)).toBe(2);
  expect(asked[0]).toEqual([1, 2, 3]);
  expect(asked).toContainEqual([2]);
  const [first = 0, second = 0] = sendTimes;
  expect(second - first).toBeGreaterThanOrEqual(1000);
  await expect(retryingLine(page)).toBeVisible();

  // The hint holds exactly the four keys.
  const firstPick = await lastPick(page);
  expect(await readResumeHint(page, videoId)).toEqual({
    uploadId,
    name: FILE_NAME,
    size: SIZE,
    lastModified: firstPick?.lastModified,
  });

  // A reload: the server's two stored parts are 80 %, and the file has to be chosen again.
  await page.reload();
  await expect(
    page.getByText("Upload paused at 80%. Choose the same file to continue."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose file", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();

  // Another file asks first and sends nothing.
  const starts: string[] = [];
  page.on("request", (r) => {
    if (isOriginalStart(r)) starts.push(r.url());
  });
  await originalInput(page).setInputFiles(other);
  await expect(
    // The box itself (the live region below says the same words for screen readers).
    page
      .getByText("This doesn't look like the same file. Start again?", {
        exact: true,
      })
      .and(page.locator(":not(.sr-only)")),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start again", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose another file", exact: true }),
  ).toBeVisible();
  expect(starts).toEqual([]);

  // Phase 2: every part goes through. The same file resumes and sends only part 3.
  parts.setRule(() => "continue");
  const puts = trackPartPuts(page);
  const resumed = page.waitForRequest(isOriginalStart);
  await originalInput(page).setInputFiles(big);
  const secondPick = await lastPick(page);
  expect((await resumed).postDataJSON()).toEqual({
    kind: "original",
    videoId,
    fileName: FILE_NAME,
    size: SIZE,
    contentType: "video/mp4",
    resume: true,
  });
  await expect(page.getByText(ATTACHED).first()).toBeVisible({
    timeout: 30_000,
  });
  expect(puts).toEqual([3]);
  expect(await readResumeHint(page, videoId)).toBeNull();
  expect(existsSync(multipartDir(uploadId))).toBe(false);

  const { mtimeMs } = await stat(big);
  testInfo.annotations.push({
    type: "lastModified",
    description: `${testInfo.project.name}: first pick ${firstPick?.lastModified}, second pick ${secondPick?.lastModified}, file mtime ${Math.floor(mtimeMs)}`,
  });
  expect(secondPick?.lastModified).toBe(firstPick?.lastModified);
  expect(errors).toEqual([]);
});

test("Cancel while retrying ends the upload on the server; a reload shows the dropzone at rest; the iPhone hint shows on the iPhone only", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page, [ABORTED_PARTS]);
  page.on("dialog", (dialog) => dialog.accept());
  // One part: Retrying shows on its first failed send.
  const small = await writeTestMp4(testInfo.outputPath("small.mp4"), MIB);
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);

  // The dropzone at rest carries the iPhone hint on the iPhone only (a device check, 07 D152).
  await expect(page.getByText(AT_REST)).toBeVisible();
  const hint = page.getByText(
    "On iPhone, choose the video from Files for full quality.",
  );
  if (testInfo.project.name === "webkit-iphone") {
    await expect(hint).toBeVisible();
  } else {
    await expect(hint).toHaveCount(0);
  }

  await routePartPuts(page, () => "abort");
  const uploadId = await chooseOriginal(page, small);
  await expect(retryingLine(page)).toBeVisible();
  // Nothing is stored, so no 25 % follows: the live region still says it.
  await expect(announcer(page)).toHaveText(RETRYING);
  expect(await readResumeHint(page, videoId)).not.toBeNull();

  // Cancel aborts the upload on the server, then refetches the page; no part is PUT once the abort has answered.
  const { refreshed } = await cancelAndWaitForAbort(page, videoId, uploadId);
  const late = trackPartPuts(page);
  await refreshed;
  await expect(page.getByText(AT_REST)).toBeVisible();
  await expect(retryingLine(page)).toHaveCount(0);
  expect(await readResumeHint(page, videoId)).toBeNull();
  expect(existsSync(multipartDir(uploadId))).toBe(false);
  expect(late).toEqual([]);

  await page.reload();
  await expect(page.getByText(AT_REST)).toBeVisible();
  await expect(page.getByText(/Upload paused at/)).toHaveCount(0);
  await expect(page.getByText(/Upload didn't finish/)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("after a reload, Cancel and Start again name the paused upload; a Start again abort landing after the new start leaves the new upload alone (owner answer Q-50)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page, [ABORTED_PART_URLS]);
  page.on("dialog", (dialog) => dialog.accept());
  const big = await bigFile();
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);

  // Cancel on the paused box names that upload; it ends on the server and the step rests after a reload.
  const first = await pausedAfterReload(page, big);
  const { refreshed } = await cancelAndWaitForAbort(page, videoId, first);
  await refreshed;
  expect(existsSync(multipartDir(first))).toBe(false);
  expect(await readResumeHint(page, videoId)).toBeNull();
  await page.reload();
  await expect(page.getByText(AT_REST)).toBeVisible();

  // Start again with another file: the abort names the paused upload, and is held until the new start has answered,
  // so the server sees it last. It ends nothing then: the new file uploads to the end.
  const second = await pausedAfterReload(page, big);
  const fresh = page.waitForResponse(
    (r) =>
      isOriginalStart(r.request()) &&
      r.request().postDataJSON()?.resume === undefined &&
      r.ok(),
  );
  await holdUploadRoute(page, "abort", fresh);
  const aborted = abortAnswered(page, videoId, second);
  await originalInput(page).setInputFiles(SAMPLE_MP4);
  await pressButton(page, "Start again");
  const started = await fresh;
  expect(((await started.json()) as { uploadId: string }).uploadId).not.toBe(
    second,
  );
  await aborted;
  await expect(page.getByText(ATTACHED).first()).toBeVisible({
    timeout: 30_000,
  });
  expect(existsSync(multipartDir(second))).toBe(false);
  expect(errors).toEqual([]);
});

test("offline pauses the upload with Cancel only and sends nothing; back online it goes on by itself", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page, [ABORTED_PARTS]);
  const big = await bigFile();
  await signUpCreator(page, { payouts: false });
  await createDraft(page);
  // Part 2's first send is held until the browser is offline, then fails there.
  const held = Promise.withResolvers<void>();
  const parts = await routePartPuts(page, async (part, before) => {
    if (part !== 2 || before > 0) return "continue";
    await held.promise;
    return "abort";
  });
  const stored = trackStoredParts(page);
  const asked = trackPartUrlRequests(page);
  await originalInput(page).setInputFiles(big);
  await expect.poll(stored, { timeout: 30_000 }).toEqual([1, 3]);

  await context.setOffline(true);
  const banner = page.getByText(PAUSED_HERE);
  await expect(banner).toBeVisible();
  const percent = Number(PAUSED_HERE.exec(await banner.innerText())?.[1]);
  expect(percent).toBeGreaterThanOrEqual(60);
  await expect(announcer(page)).toHaveText(`Upload paused at ${percent}%.`);
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toHaveCount(0);
  await expect(retryingLine(page)).toHaveCount(0);

  // Part 2 fails while offline: no retry is spent, no URL is signed again, and no PUT goes out.
  const puts = trackPartPuts(page);
  const failed = page.waitForEvent(
    "requestfailed",
    (r) => isPartPutRequest(r) && partNumberOf(r) === 2,
  );
  held.resolve();
  await failed;
  await waitInPage(page, 2_500);
  expect(puts).toEqual([]);
  expect(asked).toHaveLength(1);
  await expect(banner).toBeVisible();

  // Back online: part 2 goes again on its own URL, then complete.
  await context.setOffline(false);
  await expect(page.getByText(ATTACHED).first()).toBeVisible({
    timeout: 30_000,
  });
  expect(puts).toEqual([2]);
  expect(parts.sent(2)).toBe(2);
  expect(asked).toHaveLength(1);
  expect(stored()).toEqual([1, 2, 3]);
  expect(errors).toEqual([]);
});

test("Q-47: offline on another page, the card says Upload paused with the title and Open; back online it is Uploading again, then complete", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  const big = await bigFile();
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);
  // Part 2 is held until the browser is back online.
  const held = Promise.withResolvers<void>();
  await routePartPuts(page, holdPart(2, held.promise));
  const stored = trackStoredParts(page);
  await originalInput(page).setInputFiles(big);
  await expect.poll(stored, { timeout: 30_000 }).toEqual([1, 3]);

  // Next's navigation needs the network: go to the Library first, then offline.
  await pressLink(page, "Library");
  await page.waitForURL("/dashboard/library");
  const card = uploadCard(page);
  await expect(card.getByText(`Uploading ${DRAFT_TITLE}`)).toBeVisible();

  await context.setOffline(true);
  await expect(card.getByText(/^Upload paused at \d+%$/)).toBeVisible();
  await expect(
    page.locator('p[aria-live="polite"]', { hasText: DRAFT_TITLE }),
  ).toHaveText(new RegExp(`^Upload paused at \\d+%: ${DRAFT_TITLE}$`));
  await expect(card.getByText(DRAFT_TITLE, { exact: true })).toBeVisible();
  await expect(
    card.getByRole("link", { name: "Open", exact: true }),
  ).toHaveAttribute("href", `/dashboard/videos/${videoId}?step=file`);
  await expect(
    card.getByRole("button", { name: "Dismiss", exact: true }),
  ).toBeVisible();

  await context.setOffline(false);
  await expect(card.getByText(`Uploading ${DRAFT_TITLE}`)).toBeVisible();
  await expect(card.getByText(/^Upload paused at/)).toHaveCount(0);
  held.resolve();
  await expect(card.getByText("Upload complete")).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
});

test("Q-49: a second tab on the same video says it is uploading in another tab, then shows it attached once that upload ends", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  page.on("dialog", (dialog) => dialog.accept());
  const big = await bigFile();
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);
  const fileStep = `/dashboard/videos/${videoId}?step=file`;
  const held = Promise.withResolvers<void>();
  await routePartPuts(page, holdPart(2, held.promise));
  const stored = trackStoredParts(page);
  await originalInput(page).setInputFiles(big);
  await expect.poll(stored, { timeout: 30_000 }).toEqual([1, 3]);

  const second = await context.newPage();
  const secondErrors = collectConsoleErrors(second);
  await second.goto(fileStep);
  await expect(
    second.getByText("This video is uploading in another tab."),
  ).toBeVisible();
  await expect(second.getByText(AT_REST)).toHaveCount(0);
  await expect(second.getByText(/Upload paused at/)).toHaveCount(0);
  await expect(second.locator('input[type="file"]')).toHaveCount(0);

  held.resolve();
  await expect(page.getByText(ATTACHED).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(second.getByText(ATTACHED).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    second.getByText("This video is uploading in another tab."),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(secondErrors).toEqual([]);
});
