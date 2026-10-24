import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  expect,
  type Locator,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import type { PostingPlatform } from "../../../src/lib/domain/values";
import { resumeHintKey } from "../../../src/lib/upload/resume";
import { RIGHTS_COPY } from "../../../src/lib/videos/rights";
import {
  sourcePageHref,
  VIDEO_STEP_LABELS,
  videoStepHref,
} from "../../../src/lib/videos/steps";
import {
  boxOf,
  expectAbove,
  expectInsideColumn,
  expectLeftOf,
  expectReadingColumn,
  TIERS,
} from "./layout";
import { pressButton, pressLink, requestEnded } from "./press";

// The plain upload as a creator does it (P10b), Make licensable from a Library post (P11) and the Where posted step
// (P11c), for the upload specs and M3's later ones (P11, P11c, P13).

export const NEW_VIDEO = "/dashboard/videos/new";
export const SAMPLE_MP4 = "tests/fixtures/sample.mp4";
export const POSTER_JPG = "tests/fixtures/poster.jpg";
export const CANT_PREVIEW =
  "We can't preview this format in your browser. Your file is fine. Add a cover image for buyers.";
/** The title createDraft gives a draft unless told otherwise. */
export const DRAFT_TITLE = "Rooftop storm timelapse";
/** The File step's dropzone at rest. */
export const AT_REST = "Drop the original file here";
const FILE_STEP = /\/dashboard\/videos\/([0-9a-f-]{36})\?step=file$/;

/** The local storage driver's folder, which the e2e server shares with `bun run dev` (STORAGE_DRIVER=local). */
export const STORAGE_ROOT = path.join(process.cwd(), ".data", "storage");
const MULTIPART_ROOT = path.join(STORAGE_ROOT, ".multipart");

/** The local driver's folder for an open multipart upload; a complete or an abort removes it. */
export const multipartDir = (uploadId: string) =>
  path.join(MULTIPART_ROOT, uploadId);

// The drafts this worker's running test made (createDraft and makeLicensable add; cleanCreatedVideos removes their files).
const created = new Set<string>();

/**
 * Removes what the drafts made in this test stored: their originals, posters and still-open multipart uploads (one a
 * test left paused or retrying), found by video id. Nothing else in the shared folder is touched.
 */
export async function cleanCreatedVideos() {
  const ids = [...created];
  created.clear();
  if (ids.length === 0) return;
  const listed = (dir: string) => readdir(dir).catch(() => [] as string[]);
  const [creators, uploads] = await Promise.all([
    listed(path.join(STORAGE_ROOT, "originals")),
    listed(MULTIPART_ROOT),
  ]);
  const keys = await Promise.all(
    uploads.map((upload) =>
      readFile(path.join(multipartDir(upload), "manifest.json"), "utf8")
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
      .map(multipartDir),
  ];
  await Promise.all(paths.map((p) => rm(p, { recursive: true, force: true })));
}

type UploadRouteName = "start" | "parts" | "complete" | "abort";

/** A POST to /api/uploads/<route>. */
export const uploadRoute = (request: Request, route: UploadRouteName) =>
  request.method() === "POST" &&
  request.url().endsWith(`/api/uploads/${route}`);

/** The original's start (on Chromium the cover's frame has its own). */
export const isOriginalStart = (request: Request) =>
  uploadRoute(request, "start") && request.postDataJSON()?.kind === "original";

/** The File step's original picker and the cover picker (both visually hidden inputs). */
export const originalInput = (page: Page) =>
  page.locator('input[type="file"][accept="video/mp4,video/quicktime"]');
export const coverInput = (page: Page) =>
  page.locator('input[type="file"][accept="image/jpeg,image/png,image/webp"]');

/** The cover <img> on the File step. */
export const coverImage = (page: Page): Locator =>
  page.getByRole("img", { name: /^Cover image for / });

/** The floating card that follows an upload to the other pages (owner answer Q-42). */
export const uploadCard = (page: Page) => page.locator("[data-upload-card]");

/** S18: a title, then Continue; returns the new draft's id once its File step is open. */
export async function createDraft(
  page: Page,
  title = DRAFT_TITLE,
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
 * Presses Make licensable on the post's Source page (going there first unless the page is on it); returns the new
 * draft's id once its File step is open. The draft is registered for cleanCreatedVideos, as createDraft's are.
 */
export async function makeLicensable(
  page: Page,
  postId: string,
): Promise<string> {
  const url = new URL(page.url());
  if (url.pathname !== NEW_VIDEO || url.searchParams.get("post") !== postId) {
    await page.goto(sourcePageHref(postId));
  }
  // The live check runs before the redirect; waitForURL waits as long as the test allows.
  await pressButton(page, "Make licensable");
  await page.waitForURL(FILE_STEP);
  const id = FILE_STEP.exec(page.url())?.[1];
  if (!id) throw new Error("no video id in the File step's URL");
  created.add(id);
  return id;
}

/**
 * The draft Stepper (04 §9.28; 07 D69, D149) at `width`: "Step n of 4 · {label}" over a 4-segment bar below md, the
 * <ol> File · Where posted · Rights · Review with the current step from md.
 */
export async function expectVideoStepper(
  page: Page,
  width: number,
  current: { step: number; label: string } = { step: 1, label: "File" },
) {
  const steps = VIDEO_STEP_LABELS.length;
  const caption = page.getByText(
    `Step ${current.step} of ${steps} · ${current.label}`,
    { exact: true },
  );
  const bar = caption.locator("xpath=following-sibling::div[1]");
  const list = page.locator("main ol").filter({ hasText: "Where posted" });
  if (width < TIERS.tablet) {
    await expect(caption).toBeVisible();
    await expect(bar).toBeVisible();
    await expect(bar.locator(":scope > span")).toHaveCount(steps);
    await expect(list).toBeHidden();
  } else {
    await expect(caption).toBeHidden();
    await expect(list).toBeVisible();
    await expect(list.locator(":scope > li")).toHaveText([
      ...VIDEO_STEP_LABELS,
    ]);
    await expect(list.locator('[aria-current="step"]')).toHaveText(
      current.label,
    );
  }
}

/** Where posted's header (04 §11.10), the step's h2; it also names the chip group. */
export const WHERE_POSTED = "Where was it posted?";

/** Where posted's chips (FilterChips multiple mode, 04 §9.14): a group named by the step's header. */
export const chipGroup = (page: Page) =>
  page.getByRole("group", { name: WHERE_POSTED, exact: true });

/** One chip by its label ("Instagram" … "Other", "Demo"): an aria-pressed toggle button. */
export const platformChip = (page: Page, label: string) =>
  chipGroup(page).getByRole("button", { name: label, exact: true });

/** A platform's posting card (`data-posting-card`, Demo's is "mock"). */
export const postingCard = (page: Page, platform: PostingPlatform) =>
  page.locator(`[data-posting-card="${platform}"]`);

/** The "Link to the post (optional)" fields inside `scope` (a card, or one row). */
export const linkFields = (scope: Locator) =>
  scope.getByLabel(/^Link to the post/);

/** The locked Library source row (04 §9.33). */
export const sourceRow = (page: Page) => page.locator("[data-posting-source]");

/** "Show buyers this link" inside `scope` (a row or a card). */
export const showLinkSwitch = (scope: Locator) =>
  scope.getByRole("switch", { name: "Show buyers this link", exact: true });

/** The same-video block (07 D69): the cover and each verified post's picture, the warnings and the tick. */
export const sameVideoBlock = (page: Page) => page.locator("[data-same-video]");

/** The same-video tick (07 D69). */
export const sameVideoTick = (page: Page) =>
  page.getByRole("checkbox", {
    name: "These posts show this same video",
    exact: true,
  });

/** A draft step's column in the step layout (VideoStepFrame's `data-step`): Where posted, Rights or Review. */
export const stepColumn = (
  page: Page,
  step: "postings" | "rights" | "review",
) => page.locator(`[data-step="${step}"]`);

/**
 * The chips wrap at every tier and never scroll (07 D146, D153; 04 §9.14 multiple mode): the group is a wrapping row,
 * neither it nor any box between it and the step column scrolls or clips sideways, nothing overflows it, and every chip
 * lies inside the step column.
 */
export async function expectChipsWrap(page: Page) {
  const group = chipGroup(page);
  await expect(group).toHaveCSS("flex-wrap", "wrap");
  const facts = await group.evaluate((el) => {
    const step = el.closest('[data-step="postings"]');
    if (!step) throw new Error("the chip group is outside the step column");
    const clipping: string[] = [];
    for (
      let box: Element | null = el;
      box && box !== step;
      box = box.parentElement
    ) {
      const overflowX = getComputedStyle(box).overflowX;
      if (overflowX !== "visible") clipping.push(overflowX);
    }
    const column = step.getBoundingClientRect();
    const outside = [...el.querySelectorAll("button")].filter((chip) => {
      const box = chip.getBoundingClientRect();
      return box.left < column.left - 1 || box.right > column.right + 1;
    }).length;
    return { clipping, overflow: el.scrollWidth - el.clientWidth, outside };
  });
  expect(facts).toEqual({ clipping: [], overflow: 0, outside: 0 });
}

/**
 * A draft step in the S17 layout (07 D146, D156) at `width`: below lg one centered ≤ 640 px column holding the step; the
 * video summary absent below md, above the step on md, and left of it from lg.
 */
export async function expectStepLayout(
  page: Page,
  width: number,
  step: Locator,
) {
  const summary = page.locator("[data-video-summary]");
  await expect(step).toBeVisible();
  if (width < TIERS.desktop) {
    await expectReadingColumn(page);
    await expectInsideColumn(step);
  }
  if (width < TIERS.tablet) {
    await expect(summary).toBeHidden();
  } else if (width < TIERS.desktop) {
    await expect(summary).toBeVisible();
    await expectInsideColumn(summary);
    await expectAbove(summary, step);
  } else {
    await expect(summary).toBeVisible();
    await expectLeftOf(summary, step);
  }
}

/** Where posted in the S17 layout (expectStepLayout), its chips wrapping (expectChipsWrap). */
export async function expectWherePostedLayout(page: Page, width: number) {
  await expectStepLayout(page, width, stepColumn(page, "postings"));
  await expectChipsWrap(page);
}

/** The boxes of `items` all start at the same height, within 1 px: one line (a wrapping row that didn't wrap). */
export async function expectOneLine(items: Locator) {
  const boxes = await Promise.all((await items.all()).map(boxOf));
  expect(boxes.length).toBeGreaterThan(1);
  const tops = boxes.map((box) => box.top);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
}

/** Presses the File step's Continue (a link once the original is ready) and waits for Where posted (07 D69). */
export async function continueToPostings(page: Page, videoId: string) {
  await pressLink(page, "Continue");
  await page.waitForURL(videoStepHref(videoId, "postings"));
  await expect(
    page.getByRole("heading", { level: 2, name: WHERE_POSTED, exact: true }),
  ).toBeVisible();
}

/** Waits for the draft's Rights step (P13): its address and the first attestation (the step's h1 is the title). */
export async function expectRightsStep(page: Page, videoId: string) {
  await page.waitForURL(videoStepHref(videoId, "rights"));
  await expect(
    page.getByLabel(RIGHTS_COPY.ownsRights, { exact: true }),
  ).toBeVisible();
}

/** Rights' four answers (01 J5.13, J5.14): both boxes ticked and each question answered by keyboard. */
export async function answerRights(
  page: Page,
  {
    music = "No",
    people = "No",
  }: { music?: "Yes" | "No"; people?: "Yes" | "No" } = {},
) {
  for (const box of [RIGHTS_COPY.ownsRights, RIGHTS_COPY.notReupload]) {
    const tick = page.getByLabel(box, { exact: true });
    await tick.focus();
    await tick.press("Space");
    await expect(tick).toBeChecked();
  }
  for (const [question, answer] of [
    [RIGHTS_COPY.musicQuestion, music],
    [RIGHTS_COPY.peopleQuestion, people],
  ] as const) {
    const choice = rightsAnswer(page, question, answer);
    await choice.focus();
    await choice.press("Space");
    await expect(choice).toBeChecked();
  }
}

/** One of Rights' Yes / No questions, by its question. */
export const rightsQuestion = (page: Page, question: string) =>
  page.getByRole("group", { name: question });

/** One answer's radio in a Rights question. */
export const rightsAnswer = (
  page: Page,
  question: string,
  answer: "Yes" | "No",
) =>
  rightsQuestion(page, question).getByRole("radio", {
    name: answer,
    exact: true,
  });

/** A step's Continue button (File while its original isn't ready, Where posted, Rights). */
export const continueButton = (page: Page) =>
  page.getByRole("button", { name: "Continue", exact: true });

/** Presses Where posted's Continue and waits for Rights (P13). */
export async function continueToRights(page: Page, videoId: string) {
  await pressButton(page, "Continue");
  await expectRightsStep(page, videoId);
}

/** Presses Rights' Continue and waits for the Review (P13). */
export async function continueToReview(page: Page, videoId: string) {
  await pressButton(page, "Continue");
  await page.waitForURL(videoStepHref(videoId, "review"));
  await expect(stepColumn(page, "review")).toBeVisible();
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
 * Tracks the page's reads of a video file from now on (readVideoMetadata: the hints, and a frame when asked): each read
 * opens a blob: URL of the file and revokes it when it ends, frame or not. The returned function waits until every read
 * begun so far has ended (within the read's own 15 s deadline). The page must not reload in between.
 */
export async function trackVideoReads(page: Page) {
  await page.evaluate(() => {
    const open = new Set<string>();
    Object.assign(window, { e2eVideoReads: open });
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    URL.createObjectURL = (object) => {
      const url = create.call(URL, object);
      if (object instanceof Blob && object.type.startsWith("video/")) {
        open.add(url);
      }
      return url;
    };
    URL.revokeObjectURL = (url) => {
      open.delete(url);
      revoke.call(URL, url);
    };
  });
  return () =>
    page.waitForFunction(
      () => {
        const open = (window as Window & { e2eVideoReads?: Set<string> })
          .e2eVideoReads;
        if (!open) throw new Error("the page reloaded: no reads are tracked");
        return open.size === 0;
      },
      undefined,
      { timeout: 20_000 },
    );
}

/** Chooses `file` on the open File step; returns the upload id its start answered with. */
export async function chooseOriginal(
  page: Page,
  file: string,
): Promise<string> {
  const started = page.waitForResponse(
    (r) => isOriginalStart(r.request()) && r.ok(),
  );
  await originalInput(page).setInputFiles(file);
  return ((await (await started).json()) as { uploadId: string }).uploadId;
}

/**
 * Holds every POST /api/uploads/<name> from now on until `release()`, or until `until` settles. Held part URLs keep the
 * upload in its uploading state (bar, "0% · …", Cancel) for as long as a test needs, without touching the binary part
 * PUTs. `ended` settles once the first such request has ended either way (answered, or aborted by a Cancel).
 */
export async function holdUploadRoute(
  page: Page,
  name: UploadRouteName,
  until?: Promise<unknown>,
) {
  const url = `**/api/uploads/${name}`;
  const { promise: released, resolve: release } = Promise.withResolvers<void>();
  until?.then(
    () => release(),
    () => release(),
  );
  const ended = requestEnded(page, (r) => uploadRoute(r, name));
  await page.route(url, async (route: Route) => {
    await released;
    // A Cancel may have aborted the request meanwhile.
    await route.continue().catch(() => undefined);
  });
  return {
    release: async () => {
      release();
      await page.unroute(url);
    },
    ended,
  };
}

/**
 * Waits for the next abort's answer: it names `uploadId` (owner answer Q-50) and answers 204. Call it before whatever
 * sends the abort.
 */
export async function abortAnswered(
  page: Page,
  videoId: string,
  uploadId: string,
) {
  const abort = await page.waitForResponse((r) =>
    uploadRoute(r.request(), "abort"),
  );
  expect(abort.request().postDataJSON()).toEqual({ videoId, uploadId });
  expect(abort.status()).toBe(204);
}

/**
 * Presses Cancel on the File step and checks its abort (abortAnswered). Cancel then refetches the video's page (a
 * Replace's start may have removed the old original), and a reload that cuts that refetch's body makes WebKit log
 * "Load failed": `refreshed` resolves once a new fetch of the page has ended, body included. The page's own resource
 * timing tells (pageFetchesEnded), in every engine, where Playwright's `response.finished()` never settles for the
 * streamed RSC response in Chromium.
 */
export async function cancelAndWaitForAbort(
  page: Page,
  videoId: string,
  uploadId: string,
) {
  const pagePath = `/dashboard/videos/${videoId}`;
  const fetchesBefore = await pageFetchesEnded(page, pagePath);
  const answered = abortAnswered(page, videoId, uploadId);
  await pressButton(page, "Cancel");
  await answered;
  const refreshed = expect
    .poll(() => pageFetchesEnded(page, pagePath), { timeout: 30_000 })
    .toBeGreaterThan(fetchesBefore);
  return { refreshed };
}

/** How many fetches of `pagePath` (the router's RSC requests) have ended in this document so far. */
const pageFetchesEnded = (page: Page, pagePath: string) =>
  page.evaluate(
    (path) =>
      performance
        .getEntriesByType("resource")
        .filter(
          (e) =>
            (e as PerformanceResourceTiming).initiatorType === "fetch" &&
            new URL(e.name).pathname === path,
        ).length,
    pagePath,
  );

/** Whether a beforeunload listener would stop the tab from closing right now (the upload store's guard). */
export const leaveIsGuarded = (page: Page) =>
  page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

// A 24-byte ftyp box: size 0x18, "ftyp", major brand "isom", minor version 0x200, compatible brands "isom" "iso2".
const FTYP_BOX = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypisom", "latin1"),
  Buffer.from([0, 0, 2, 0]),
  Buffer.from("isomiso2", "latin1"),
]);

/**
 * Writes `size` bytes to `file`: the ftyp box, then zeros. An MP4 by its first bytes (the server's check passes), but
 * nothing a browser can play, so no cover frame is read. Write it under Playwright's output folder, never in the repo.
 */
export async function writeTestMp4(file: string, size: number) {
  const bytes = Buffer.alloc(size);
  FTYP_BOX.copy(bytes);
  await writeFile(file, bytes);
  return file;
}

/** A part PUT to the local driver's signed URL route (07 D80): /api/dev/storage/<key>?uploadId=…&partNumber=…. */
const isPartPut = (url: URL) =>
  url.pathname.startsWith("/api/dev/storage/") &&
  url.searchParams.has("partNumber");

/** The request of a part PUT: isPartPut's URL, sent with PUT. */
export const isPartPutRequest = (request: Request) =>
  request.method() === "PUT" && isPartPut(new URL(request.url()));

export const partNumberOf = (request: Request) =>
  Number(new URL(request.url()).searchParams.get("partNumber"));

/** What a routed part PUT does: go through, or fail as a dropped connection; a promise holds it until it settles. */
export type PartAction = "continue" | "abort";
export type PartRule = (
  partNumber: number,
  sentBefore: number,
) => PartAction | Promise<PartAction>;

/**
 * Routes every part PUT through `rule` (its part number and how many times that part was sent before) and counts the
 * sends. `setRule` swaps the rule and starts the counts again, for a test's next phase.
 */
export async function routePartPuts(page: Page, rule: PartRule) {
  const sent = new Map<number, number>();
  let current = rule;
  await page.route(isPartPut, async (route) => {
    const part = partNumberOf(route.request());
    const before = sent.get(part) ?? 0;
    sent.set(part, before + 1);
    const action = await current(part, before);
    // A reload or the page's own abort may have ended the PUT meanwhile.
    await (action === "abort" ? route.abort("failed") : route.continue()).catch(
      () => undefined,
    );
  });
  return {
    sent: (part: number) => sent.get(part) ?? 0,
    setRule: (next: PartRule) => {
      current = next;
      sent.clear();
    },
  };
}

/** The part numbers whose PUT answered 2xx from now on, sorted. */
export function trackStoredParts(page: Page): () => number[] {
  const stored: number[] = [];
  page.on("response", (response) => {
    const request = response.request();
    if (isPartPutRequest(request) && response.ok()) {
      stored.push(partNumberOf(request));
    }
  });
  return () => [...stored].sort((a, b) => a - b);
}

/** The part numbers PUT from now on, in order. */
export function trackPartPuts(page: Page): number[] {
  const puts: number[] = [];
  page.on("request", (r) => {
    if (isPartPutRequest(r)) puts.push(partNumberOf(r));
  });
  return puts;
}

/** The partNumbers each POST /api/uploads/parts asks for from now on. */
export function trackPartUrlRequests(page: Page): number[][] {
  const asked: number[][] = [];
  page.on("request", (r) => {
    if (uploadRoute(r, "parts")) asked.push(r.postDataJSON().partNumbers);
  });
  return asked;
}

/** The resume hint this device keeps for `videoId` (07 D80), parsed, or null. */
export async function readResumeHint(
  page: Page,
  videoId: string,
): Promise<unknown> {
  const raw = await page.evaluate(
    (key) => localStorage.getItem(key),
    resumeHintKey(videoId),
  );
  return raw === null ? null : JSON.parse(raw);
}
