import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import { waitForLibrary } from "./helpers/library";
import {
  pressButton,
  pressLink,
  pressLocator,
  waitInPage,
} from "./helpers/press";
import {
  AT_REST,
  attachSample,
  CANT_PREVIEW,
  cancelAndWaitForAbort,
  chooseOriginal,
  cleanCreatedVideos,
  continueToPostings,
  coverImage,
  coverInput,
  createDraft,
  DRAFT_TITLE,
  holdUploadRoute,
  isOriginalStart,
  leaveIsGuarded,
  multipartDir,
  NEW_VIDEO,
  originalInput,
  POSTER_JPG,
  SAMPLE_MP4,
  STORAGE_ROOT,
  trackPosterStored,
  trackVideoReads,
  uploadCard,
  uploadRoute,
  waitForAttached,
} from "./helpers/videos";

// J5's plain upload start (05 §6.5, §6.6; 07 D39, D69, D80) on chromium-desktop and webkit-iphone: the title page, the
// File step's multipart upload of sample.mp4 through P10a's routes and its Continue to Where posted (the upload note
// lives there now, never on the File step), the cover image (the captured frame where the browser decodes H.264, else
// poster.jpg through "Choose an image"), Cancel ending the upload on the server (P10c), the file checks, the leave guard,
// the floating card that follows an upload to other pages (owner answer Q-42), and Replace keeping a cover the creator
// chose (owner answer Q-41 a). Each test signs up its own creator.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const PART_PUT =
  /\/api\/dev\/storage\/originals\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4\?uploadId=[0-9a-f-]{36}&partNumber=1&/;
const BAD_FILE =
  "We couldn't read this file as a video. Export it again as MP4 and retry.";
const ZERO_PERCENT = /^0% · 0(\.0)? of 0\.2 MB$/;
const INTERRUPTED = "Upload didn't finish. Choose the file again.";
/** 01 J5.6's upload-only note: on Where posted since 07 D69, never on the File step. */
const UPLOAD_NOTE =
  "Is this video on Instagram, TikTok or YouTube? Connect the account to get a Verified label.";

/**
 * On the open File step: chooses sample.mp4 with its part URLs held, then goes to the Library, where the floating card
 * shows the running upload (it is hidden on the video's own page). Returns the hold.
 */
async function uploadThenLeave(page: Page) {
  const held = await holdUploadRoute(page, "parts");
  await originalInput(page).setInputFiles(SAMPLE_MP4);
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await expect(uploadCard(page)).toHaveCount(0);
  await pressLink(page, "Library");
  await waitForLibrary(page);
  await expect(
    uploadCard(page).getByText(`Uploading ${DRAFT_TITLE}`),
  ).toBeVisible();
  return held;
}

test("J5: a title makes a draft, sample.mp4 uploads in parts, the cover is stored, and a reload keeps both", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });

  // S18: the title page, its refusal, then a draft.
  await page.goto(NEW_VIDEO);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "New video. From your Library or a file.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Buyers will see:")).toBeVisible();
  await expect(page.getByText("Self-attested by the creator")).toBeVisible();
  await expect(
    page.locator("main").getByRole("link", { name: "Videos", exact: true }),
  ).toHaveAttribute("href", "/dashboard/videos");
  await pressButton(page, "Continue");
  const title = page.getByLabel("Title", { exact: true });
  await expect(title).toHaveAccessibleDescription("Add a title.");
  await expect(title).toBeFocused();
  const videoId = await createDraft(page);
  const fileStep = `/dashboard/videos/${videoId}?step=file`;

  // Continue waits for the original; Where posted and Rights can't be reached before it.
  const continueButton = page.getByRole("button", {
    name: "Continue",
    exact: true,
  });
  await expect(continueButton).toBeDisabled();
  await expect(
    page.getByText("Choose the original file to continue."),
  ).toBeVisible();
  await expect(
    page.getByText("MP4 or MOV, no watermark, up to 2 GB"),
  ).toBeVisible();
  await page.goto(`/dashboard/videos/${videoId}?step=rights`);
  await expect(page).toHaveURL(fileStep);
  await page.goto(`/dashboard/videos/${videoId}?step=postings`);
  await expect(page).toHaveURL(fileStep);
  // The upload-only note moved to Where posted (07 D69).
  await expect(page.getByText(UPLOAD_NOTE, { exact: true })).toHaveCount(0);
  await expect(
    page
      .locator("main")
      .getByRole("link", { name: "Connect an account", exact: true }),
  ).toHaveCount(0);

  // The multipart flow: start says multipart, part 1 goes to the dev storage route, complete sends no ETags.
  const started = page.waitForResponse((r) => isOriginalStart(r.request()));
  const partPut = page.waitForRequest(
    (r) => r.method() === "PUT" && PART_PUT.test(r.url()),
  );
  const completed = page.waitForRequest(
    (r) => uploadRoute(r, "complete") && r.postDataJSON()?.kind === "original",
  );
  const held = await holdUploadRoute(page, "parts");
  const posterStored = trackPosterStored(page);
  await originalInput(page).setInputFiles(SAMPLE_MP4);
  // Uploading: the file row, the bar, percent and MB, Cancel, and the keep-open line.
  await expect(page.getByText("sample.mp4")).toBeVisible();
  await expect(page.getByText(ZERO_PERCENT)).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Upload progress" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Keep this tab open until the upload finishes. You can use other pages meanwhile.",
    ),
  ).toBeVisible();
  expect(await leaveIsGuarded(page)).toBe(true);
  await held.release();

  const startResponse = await started;
  expect(startResponse.request().postDataJSON()).toEqual({
    kind: "original",
    videoId,
    fileName: "sample.mp4",
    size: 166_229,
    contentType: "video/mp4",
  });
  const start = await startResponse.json();
  expect(start).toMatchObject({
    mode: "multipart",
    partCount: 1,
    doneParts: [],
  });
  const { key, uploadId } = start as { key: string; uploadId: string };
  await partPut;
  const completeBody = (await completed).postDataJSON() as Record<
    string,
    unknown
  >;
  // It names the upload start opened, so it can't finish another one.
  expect(completeBody).toMatchObject({ kind: "original", videoId, uploadId });
  expect(completeBody).not.toHaveProperty("parts");
  expect(completeBody).not.toHaveProperty("etag");
  expect(JSON.stringify(completeBody)).not.toMatch(/etag/i);

  const coverPath = await waitForAttached(page, posterStored);

  // On disk: the original at its server key (no trace of the file's name), no multipart folder left, one cover.
  expect(key).toMatch(
    new RegExp(`^originals/[0-9a-f-]{36}/${videoId}/[0-9a-f-]{36}\\.mp4$`),
  );
  expect(key).not.toContain("sample");
  expect(existsSync(path.join(STORAGE_ROOT, key))).toBe(true);
  expect(existsSync(multipartDir(uploadId))).toBe(false);
  expect(readdirSync(path.join(STORAGE_ROOT, "posters", videoId))).toEqual([
    expect.stringMatching(/^[0-9a-f-]{36}\.jpg$/),
  ]);
  test.info().annotations.push({ type: "cover path", description: coverPath });
  expect(await leaveIsGuarded(page)).toBe(false);
  const next = page.getByRole("link", { name: "Continue", exact: true });
  await expect(next).toHaveAttribute(
    "href",
    `/dashboard/videos/${videoId}?step=postings`,
  );
  await expect(page.getByText(UPLOAD_NOTE, { exact: true })).toHaveCount(0);

  // A reload shows what the server stored: the original (with the hints the browser read, when it decoded the video)
  // and the cover through the poster route.
  await page.reload();
  const attached = page.getByText(/^Original attached/).first();
  await expect(attached).toBeVisible();
  if (coverPath === "frame_capture") {
    await expect(attached).toContainText("0:14");
    await expect(attached).toContainText("720 × 1280");
  }
  await expect(coverImage(page)).toHaveAttribute(
    "src",
    new RegExp(`^/api/media/posters/${videoId}\\?v=[0-9a-f]{8}$`),
  );
  await expect
    .poll(() =>
      coverImage(page).evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  // Continue goes to Where posted (07 D69), where the upload note now sits.
  await continueToPostings(page, videoId);
  await expect(page.getByText(UPLOAD_NOTE, { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Cancel ends the upload on the server; a reload shows the dropzone at rest", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);
  const held = await holdUploadRoute(page, "parts");
  // Mid-upload: start has opened it on the server, the part URLs are asked for and held.
  const partsAsked = page.waitForRequest((r) => uploadRoute(r, "parts"));
  const uploadId = await chooseOriginal(page, SAMPLE_MP4);
  await partsAsked;
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  // Every part PUT and the original's complete from Cancel on. A frame already read for the cover is the cover's own
  // upload, which Cancel leaves to finish.
  const afterCancel: string[] = [];
  page.on("request", (r) => {
    const { pathname } = new URL(r.url());
    if (
      (r.method() === "PUT" &&
        pathname.startsWith("/api/dev/storage/originals/")) ||
      (uploadRoute(r, "complete") && r.postDataJSON()?.kind === "original")
    ) {
      afterCancel.push(`${r.method()} ${pathname}`);
    }
  });
  // Cancel aborts the upload on the server (P10c), then refetches the page; let both finish first.
  const { refreshed } = await cancelAndWaitForAbort(page, videoId, uploadId);
  await refreshed;
  // Back to rest, no message, nothing guarding the tab.
  await expect(page.getByText(AT_REST)).toBeVisible();
  await expect(page.getByText(INTERRUPTED)).toHaveCount(0);
  expect(await leaveIsGuarded(page)).toBe(false);

  // The held part URLs go through now (or were aborted): still no part and no complete is sent.
  await held.release();
  await held.ended;
  await waitInPage(page, 1_500);
  expect(afterCancel).toEqual([]);

  // The server let go of it: a reload shows the dropzone at rest.
  await page.reload();
  await expect(page).toHaveURL(`/dashboard/videos/${videoId}?step=file`);
  await expect(page.getByText(AT_REST)).toBeVisible();
  await expect(page.getByText(INTERRUPTED)).toHaveCount(0);
  await expect(page.getByText(/Upload paused at/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("the browser refuses a non-video before any request; the server refuses a renamed text file", async ({
  page,
}) => {
  test.setTimeout(90_000);
  // complete answers 422 bad_signature_bytes for the renamed text file; the page logs it.
  const errors = collectConsoleErrors(page, [
    { status: 422, pathname: "/api/uploads/complete" },
  ]);
  await signUpCreator(page, { payouts: false });
  await createDraft(page);
  const starts: string[] = [];
  page.on("request", (r) => {
    if (uploadRoute(r, "start")) starts.push(r.url());
  });

  await originalInput(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a video"),
  });
  await expect(page.getByText("Upload an MP4 or MOV video.")).toBeVisible();
  expect(starts).toEqual([]);

  // A text file renamed .mov: the type passes, the server's first-bytes check fails it (01 J5.7).
  await originalInput(page).setInputFiles({
    name: "clip.mov",
    mimeType: "video/quicktime",
    buffer: Buffer.from(
      "This is a plain text file, renamed to look like a movie.\n".repeat(8),
    ),
  });
  await expect(page.getByText(BAD_FILE)).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Your file is fine/)).toHaveCount(0);
  expect(starts).toHaveLength(1);

  // The stored failure shows the same line after a reload.
  await page.reload();
  await expect(page.getByText(BAD_FILE)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});

test("Q-42: the upload carries on across pages; the card shows it, Open goes back to it running, then Upload complete", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);
  const fileStep = `/dashboard/videos/${videoId}?step=file`;
  const card = uploadCard(page);
  const held = await uploadThenLeave(page);
  await expect(card.getByRole("progressbar")).toBeVisible();
  const open = card.getByRole("link", { name: "Open", exact: true });
  await expect(open).toHaveAttribute("href", fileStep);

  // Open while it runs is a client navigation: the File step shows the live upload, not "Upload didn't finish".
  await pressLocator(open);
  await page.waitForURL(fileStep);
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(ZERO_PERCENT)).toBeVisible();
  await expect(page.getByText(INTERRUPTED)).toHaveCount(0);
  await expect(card).toHaveCount(0);

  await pressLink(page, "Library");
  await waitForLibrary(page);
  await expect(card.getByText(`Uploading ${DRAFT_TITLE}`)).toBeVisible();
  await held.release();
  await expect(card.getByText("Upload complete")).toBeVisible({
    timeout: 30_000,
  });
  await expect(card.getByText(DRAFT_TITLE, { exact: true })).toBeVisible();

  await pressLocator(open);
  await page.waitForURL(fileStep);
  await expect(page.getByText(/^Original attached/).first()).toBeVisible();
  await expect(card).toHaveCount(0);
  // Seen on its page: the card doesn't come back elsewhere.
  await pressLink(page, "Library");
  await waitForLibrary(page);
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Q-42: the card's × dismisses an upload that ended", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  await createDraft(page);
  const card = uploadCard(page);
  const held = await uploadThenLeave(page);
  await held.release();
  await expect(card.getByText("Upload complete")).toBeVisible({
    timeout: 30_000,
  });
  await pressLocator(
    card.getByRole("button", { name: "Dismiss", exact: true }),
  );
  await expect(card).toHaveCount(0);
  // Focus goes to the page, and the card stays gone on the next one.
  await expect(page.locator("main")).toBeFocused();
  await pressLink(page, "Connections");
  await page.waitForURL("/dashboard/connections");
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Q-42: an upload that fails while away shows Upload didn't finish on the card", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // The routed complete answers 500 for the original; the page logs it.
  const errors = collectConsoleErrors(page, [
    { status: 500, pathname: "/api/uploads/complete" },
  ]);
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);
  const fileStep = `/dashboard/videos/${videoId}?step=file`;
  await page.route("**/api/uploads/complete", (route) =>
    route.request().postDataJSON()?.kind === "original"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ code: "internal" }),
        })
      : route.continue(),
  );
  const card = uploadCard(page);
  const held = await uploadThenLeave(page);
  await held.release();
  await expect(
    card.getByText("Upload didn't finish", { exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(card.getByText(DRAFT_TITLE, { exact: true })).toBeVisible();
  const open = card.getByRole("link", { name: "Open", exact: true });
  await expect(open).toHaveAttribute("href", fileStep);

  await pressLocator(open);
  await page.waitForURL(fileStep);
  await expect(
    page.getByText("Something went wrong. Try again."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Q-41: Replace keeps a cover the creator chose and reads no new frame", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  await createDraft(page);
  // The creator's own cover, poster.jpg: asked for when the browser can't read a frame, else chosen over the frame.
  const coverPath = await attachSample(page);
  test.info().annotations.push({ type: "cover path", description: coverPath });
  if (coverPath === "frame_capture") {
    const stored = trackPosterStored(page);
    await coverInput(page).setInputFiles(POSTER_JPG);
    await expect.poll(stored, { timeout: 20_000 }).toBe(true);
  }

  const posterStarts: string[] = [];
  page.on("request", (r) => {
    if (uploadRoute(r, "start") && r.postDataJSON()?.kind === "poster") {
      posterStarts.push(r.url());
    }
  });
  const replaced = page.waitForResponse(
    (r) =>
      uploadRoute(r.request(), "complete") &&
      r.request().postDataJSON()?.kind === "original" &&
      r.status() === 200,
  );
  const readsEnded = await trackVideoReads(page);
  const chooser = page.waitForEvent("filechooser");
  await pressButton(page, "Replace");
  await (await chooser).setFiles(SAMPLE_MP4);
  await replaced;
  await expect(page.getByText(/^Original attached/).first()).toBeVisible();
  // Complete waits for the hints only, so a frame read could still be running: wait until the file's reads have ended.
  await readsEnded();
  // No frame was read for the cover: no "can't preview" line, no poster upload, and the chosen cover still shows.
  await expect(page.getByText(CANT_PREVIEW, { exact: true })).toHaveCount(0);
  await expect(coverImage(page)).toBeVisible();
  expect(posterStarts).toEqual([]);
  expect(errors).toEqual([]);
});
