import { randomUUID } from "node:crypto";
import {
  type Browser,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import { INBOX_COPY } from "../../../src/lib/licensing/inbox";
import { LICENSE_CODE_PATTERN } from "../../../src/lib/licensing/snapshot";
import { POSTINGS_COPY } from "../../../src/lib/postings/copy";
import { PUBLISHED_COPY, REVIEW_COPY } from "../../../src/lib/videos/review";
import { VIDEO_MENU_COPY } from "../../../src/lib/videos/video-page";
import {
  BUYER_PHONE,
  E2E_LICENSEE,
  type LicenseChoice,
  payButton,
  requestLicense,
} from "./buyer";
import { signUpCreator } from "./creator";
import { LIBRARY, libraryPostId, POST_01, tiles } from "./library";
import {
  isServerAction,
  pressAndSettle,
  pressAndSettleIn,
  pressButton,
  pressLocator,
  requestEnded,
} from "./press";
import {
  basePrice,
  PRICING,
  pricesSavedToast,
  setExclusiveSwitch,
} from "./pricing";
import {
  answerRights,
  attachSample,
  continueToPostings,
  continueToReview,
  continueToRights,
  createDraft,
  makeLicensable,
  sameVideoTick,
} from "./videos";

// Whole creator flows the later specs start from (P14a; P15–P22 build on this file).

/** Review's success view (05 §6.5 States "Success"), once Publish has run. */
export const publishedView = (page: Page): Locator =>
  page.locator("[data-published-view]");

/** The video page (S19, P14b): `[data-video-aside]` (poster, title, link) and `[data-video-sections]` inside. */
export const videoPage = (page: Page): Locator =>
  page.locator("[data-video-page]");

/** Opens the card's Menu ("More for {title}") with the keyboard (04 §9.1); Edit takes the focus. */
export async function openCardMenu(page: Page, title: string) {
  await pressButton(page, VIDEO_MENU_COPY.more(title));
  await expect(
    page.getByRole("menuitem", { name: REVIEW_COPY.edit }),
  ).toBeFocused();
}

/** Opens the draft card's Delete draft sheet from its Menu with the keyboard, and returns the sheet once it shows. */
export async function openDeleteSheet(
  page: Page,
  title: string,
): Promise<Locator> {
  await openCardMenu(page, title);
  await page
    .getByRole("menuitem", { name: VIDEO_MENU_COPY.deleteDraft })
    .press("Enter");
  const sheet = page.getByRole("alertdialog", {
    name: VIDEO_MENU_COPY.deleteTitle,
  });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Chooses `item` in the open Menu with Enter and waits until its Server Action's request has closed. */
export async function chooseMenuAction(page: Page, item: string) {
  const closed = requestEnded(page, isServerAction);
  await page.getByRole("menuitem", { name: item, exact: true }).press("Enter");
  await closed;
}

/** A card on /dashboard/videos or /@handle, by its title. */
export const videoCard = (page: Page, title: string | RegExp): Locator =>
  page.locator("[data-video-card]").filter({ hasText: title });

/** Presses Review's Publish and waits for "Your video is live."; returns the link the view offers and its slug. */
export async function publish(
  page: Page,
): Promise<{ shareUrl: string; slug: string }> {
  await pressButton(page, "Publish");
  await expect(
    publishedView(page).getByRole("heading", {
      level: 1,
      name: PUBLISHED_COPY.live,
    }),
  ).toBeVisible();
  const shareUrl =
    (await publishedView(page).locator("bdi").textContent()) ?? "";
  return { shareUrl, slug: new URL(shareUrl).pathname.split("/").at(-1) ?? "" };
}

/**
 * A fresh creator with fake payouts and Demo linked publishes Demo post 01 through the UI (File with sample.mp4 →
 * Where posted with the source and the same-video tick → Rights, four answers (`rights`: No to both questions unless
 * given) → Review → Publish) and stays on the success view. Returns the creator's address and handle, the video's slug,
 * the link to share and the video's id.
 */
export async function publishDemoVideo(
  page: Page,
  rights: Parameters<typeof answerRights>[1] = {},
): Promise<{
  email: string;
  handle: string;
  slug: string;
  shareUrl: string;
  videoId: string;
}> {
  const { email, handle } = await signUpCreator(page, {
    payouts: true,
    connectDemo: true,
  });
  await page.goto(LIBRARY);
  await expect(tiles(page)).toHaveCount(24);
  const videoId = await makeLicensable(
    page,
    await libraryPostId(page, POST_01),
  );
  await attachSample(page);
  await continueToPostings(page, videoId);
  const tick = sameVideoTick(page);
  await tick.focus();
  await tick.press("Space");
  await continueToRights(page, videoId);
  await answerRights(page, rights);
  await continueToReview(page, videoId);
  return { email, handle, videoId, ...(await publish(page)) };
}

/**
 * The signed-in creator offers exclusive licenses on the rate card at the default ×3.00 (P19e; 07 D109) and stays on
 * Pricing, its toast still showing.
 */
export async function offerExclusive(page: Page) {
  await page.goto(PRICING);
  await expect(basePrice(page)).toBeVisible();
  await setExclusiveSwitch(page, true);
  await pressAndSettle(page, "Save prices");
  await expect(pricesSavedToast(page)).toBeVisible();
}

/**
 * A fresh creator with no payouts and no Demo takes a plain upload to its Review (File with sample.mp4 → Where posted's
 * "not posted" → Rights, No to both questions → Review) and stays there, unpublished.
 */
export async function reviewPlainUpload(page: Page) {
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);
  await attachSample(page);
  await continueToPostings(page, videoId);
  const notPosted = page
    .locator("main")
    .getByLabel(POSTINGS_COPY.notPosted, { exact: true });
  await notPosted.focus();
  await notPosted.press("Space");
  await continueToRights(page, videoId);
  await answerRights(page);
  await continueToReview(page, videoId);
}

/**
 * A buyer licenses the video at `url` (a share link) in a fresh logged-out 390 × 844 context: requestLicense with
 * `email` run-unique unless given, then Pay on the fake checkout, ending on /r `landing` (default 'Waiting for @…'; an
 * auto-approve creator's /r reads Processing… or Approved). Returns the request's id, its buyer link as the email sends
 * it (no session id), the context (the caller closes it) and the address.
 */
export async function buyLicense(
  browser: Browser,
  url: string,
  {
    email = `buyer+${randomUUID().slice(0, 8)}@example.com`,
    landing = /^Waiting for @/,
    ...choice
  }: LicenseChoice & { landing?: RegExp },
): Promise<{
  requestId: string;
  statusUrl: string;
  context: BrowserContext;
  email: string;
}> {
  const context = await browser.newContext({ viewport: BUYER_PHONE });
  const page = await context.newPage();
  const requestId = await requestLicense(page, url, { ...choice, email });
  const paid = requestEnded(page, isServerAction);
  await pressLocator(payButton(page));
  await paid;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(landing);
  const statusUrl = page.url().replace(/&session_id=[^&]*$/, "");
  return { requestId, statusUrl, context, email };
}

/** A license code as issued (07 D101): `CL-` and two groups of four Crockford base32 symbols. */
export const LICENSE_CODE = new RegExp(
  LICENSE_CODE_PATTERN.source.slice(1, -1),
);

/** The buyer key a /r link carries (02 §9.5): the key /l opens too. */
export function buyerKey(statusUrl: string): string {
  const token = new URL(statusUrl).searchParams.get("t");
  if (!token) throw new Error("buyerKey: the link has no key");
  return token;
}

/**
 * The signed-in creator taps Approve once on the Inbox row for `licensee` (01 J8.2: no dialog), reads the code from the
 * row's "License {code} issued" and leaves the Inbox before its next refresh (WebKit cancels a refresh in flight and
 * Next's fallback interrupts the next goto). Returns the code.
 */
export async function approveInInbox(
  page: Page,
  licensee: string = E2E_LICENSEE,
): Promise<string> {
  await page.goto("/dashboard");
  const row = page
    .locator("[data-inbox-row]")
    .filter({ has: page.locator("[data-licensee]", { hasText: licensee }) });
  await expect(row).toHaveCount(1);
  await pressAndSettleIn(page, row, INBOX_COPY.approve);
  const issued = row.getByText(/^License CL-.+ issued$/);
  await expect(issued).toBeVisible();
  const code = LICENSE_CODE.exec((await issued.textContent()) ?? "")?.[0];
  if (!code) throw new Error("approveInInbox: no license code");
  await page.goto("about:blank");
  return code;
}

/**
 * A license for the video at `shareUrl` (P20): a logged-out buyer pays (buyLicense, its context closed) and the
 * signed-in creator approves it from the Inbox (approveInInbox). Returns the request's id, its buyer key, the code and
 * the buyer's address.
 */
export async function licenseVideo(
  page: Page,
  browser: Browser,
  shareUrl: string,
  choice: LicenseChoice,
): Promise<{ requestId: string; token: string; code: string; email: string }> {
  const { requestId, statusUrl, context, email } = await buyLicense(
    browser,
    shareUrl,
    choice,
  );
  await context.close();
  const code = await approveInInbox(page, choice.licensee);
  return { requestId, token: buyerKey(statusUrl), code, email };
}
