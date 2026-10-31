import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { APP_NAME } from "../../src/lib/app-name";
import { formatDeadline } from "../../src/lib/format";
import { INBOX_COPY } from "../../src/lib/licensing/inbox";
import { PAYOUT_LINE_COPY } from "../../src/lib/licensing/payout-line";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { BARE_DOLLAR } from "../helpers/money";
import { readLatestEmail } from "../helpers/read-latest-email";
import { E2E_LICENSEE } from "./helpers/buyer";
import { collectConsoleErrors } from "./helpers/console";
import { buyLicense, publishDemoVideo } from "./helpers/flows";
import {
  atEveryWidth,
  boxOf,
  expectCreatorFrame,
  expectInside,
  expectInsideColumn,
  expectReadingPage,
  expectSettingsColumn,
  TIERS,
} from "./helpers/layout";
import {
  isRouterRefresh,
  isServerAction,
  pressLocator,
  requestEnded,
} from "./helpers/press";
import { cleanCreatedVideos } from "./helpers/videos";

// G.6 for the Inbox, the request page and /r (P17, P18, P19, P19b; 05 §1.6 S03, S14, S15; 04 §9.11, §10.2; 07
// D144–D146, D149, D154) on all four projects: a creator publishes Demo post 01 and three buyers pay (buyLicense; the
// third for Northwind Brands Inc., so each row is picked by its licensee); the creator approves the second on its
// request page (the toast above the TabBar below 1024, Paid out or Payout pending under the code in its status block,
// and the buyer's license-approved email), then declines the third from its Inbox row on a running clock (01 J8.4): the
// row keeps its place with the line, the Declined pill and the focus while the counts drop, the toast repeats the line
// without a seal, and only the next focus refresh moves it to History (02 §4.4 rule 2; the buyer gets
// request-declined). The Inbox fills the max-w-app column and its row stacks below 768 (the countdown under the
// Licensed-to name, Decline and Approve half width each, Approve on the right, Details under them) and is wide from 768
// (the countdown on the name's line at the row's right edge, Details · Decline · Approve, Approve the rightmost
// control); the declined row's line wraps inside it. History keeps each decided row's pill (and the approved one's
// code) inside it, and the approved row reads Paid out inside its text column (owner answer Q-146 a; the transfer runs
// after the approval's response, so History reloads while it reads Payout pending); the request page is one 640 px
// column left-aligned with its heading, Decline before Approve; /r, opened in a fresh logged-out context at the
// project's own viewport, is one centered 640 px column (the approved one with its 40 px seal, the declined one's
// heading neutral). Each page's clock is paused after it loads (the Inbox's after the decline: a page loaded after a
// pause stays paused until a resume), so the 30 s refresh can't fire mid-sweep. A second test forces another creator's
// request overdue with the dev script and no cron call: its /r expires it before rendering and reads "No answer in
// time" (owner answer Q-142 a).
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const LICENSE_CODE = /CL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/;
const APPROVED_TOAST = INBOX_COPY.approvedToast("CA$1,575.00");
/** Paid social ads · 1 year · Worldwide. */
const CHOICE = {
  use: "paid_social",
  term: "y1",
  territory: "worldwide",
} as const;
/** The third buyer's licensee, 05 §6.3's second demo licensee. */
const NORTHWIND = "Northwind Brands Inc.";

/** The rightmost edge of the controls `row` shows at this width (the other tier's copy is hidden). */
const rightmostControl = (row: Locator) =>
  row.evaluate((el) =>
    Math.max(
      ...[...el.querySelectorAll("button, a")]
        .filter((c) => c.getClientRects().length > 0)
        .map((c) => c.getBoundingClientRect().right),
    ),
  );

/** Opens `path` on a paused clock: time stands still from load, so no 30 s refresh fires during the sweep. */
async function openPaused(page: Page, path: string) {
  await page.clock.install();
  await page.goto(path);
  await page.clock.pauseAt(new Date(Date.now() + 1_000));
}

/**
 * `text`'s own glyphs lie inside `box` from left to right (±1 px) and its block doesn't scroll sideways: the line wraps,
 * never clipped. A Range measures the text itself, not the block around it.
 */
async function expectTextInside(text: Locator, box: Locator) {
  const [own, outer] = await Promise.all([
    text.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      return {
        left: Math.min(...rects.map((r) => r.left)),
        right: Math.max(...rects.map((r) => r.right)),
        overflow: el.scrollWidth - el.clientWidth,
      };
    }),
    boxOf(box),
  ]);
  expect(own.left).toBeGreaterThanOrEqual(outer.left - 1);
  expect(own.right).toBeLessThanOrEqual(outer.right + 1);
  expect(own.overflow).toBeLessThanOrEqual(0);
}

/**
 * The heading is drawn in the theme's --ink: neutral, never a danger tone (01 §4.8). A fresh 2D canvas writes any CSS
 * color back in one form, so the computed rgb() and the token compare; a value it can't read leaves its #000000, which
 * neither theme's ink is.
 */
async function expectNeutralHeading(heading: Locator) {
  const [color, ink] = await heading.evaluate((el) => {
    const canonical = (value: string) => {
      const paint = document.createElement("canvas").getContext("2d");
      if (!paint) return value;
      paint.fillStyle = value;
      return String(paint.fillStyle);
    };
    const style = getComputedStyle(el);
    return [
      canonical(style.color),
      canonical(style.getPropertyValue("--ink").trim()),
    ];
  });
  expect(color).toBe(ink);
}

test("G.6, 07 D146, 01 J8.4: the Inbox row stacks below 768 and is wide from 768, a declined row keeps its place until the next refresh; the request page and /r keep their columns, at every tier", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(900_000);
  const { shareUrl, handle } = await publishDemoVideo(page);
  const { requestId, statusUrl, context } = await buyLicense(
    browser,
    shareUrl,
    CHOICE,
  );
  await context.close();
  const approved = await buyLicense(browser, shareUrl, CHOICE);
  await approved.context.close();
  const declined = await buyLicense(browser, shareUrl, {
    ...CHOICE,
    licensee: NORTHWIND,
  });
  await declined.context.close();

  // Approve the second on its request page, before any clock is installed: the toast, the line, the email; then
  // neither Decline nor Approve is left.
  const errors = collectConsoleErrors(page);
  const since = Date.now();
  await page.goto(`/dashboard/requests/${approved.requestId}`);
  const pageDecline = page.getByRole("button", { name: INBOX_COPY.decline });
  const pageApprove = page.getByRole("button", { name: INBOX_COPY.approve });
  await expect(pageDecline).toBeVisible();
  await pressLocator(pageApprove);
  const toast = page.locator("li", { hasText: APPROVED_TOAST });
  await expect(toast).toBeVisible();
  await expect(toast.locator("svg")).toHaveAttribute("width", "16");
  const tabBar = page.locator("[data-tabbar]");
  if (await tabBar.isVisible()) {
    const [toastBox, barBox] = await Promise.all([boxOf(toast), boxOf(tabBar)]);
    expect(toastBox.bottom).toBeLessThanOrEqual(barBox.top + 1);
  }
  await expect(page.getByText(/^License CL-.* issued$/)).toHaveText(
    new RegExp(`^License ${LICENSE_CODE.source} issued$`),
  );
  // The payout line under the code in the status block (P19b): the transfer runs after the response, so either word.
  await expect(
    page
      .locator("#request-status")
      .getByText(
        new RegExp(
          `^(${PAYOUT_LINE_COPY.paidOut}|${PAYOUT_LINE_COPY.pending})$`,
        ),
      ),
  ).toBeVisible();
  await expect(pageApprove).toHaveCount(0);
  await expect(pageDecline).toHaveCount(0);
  const email = await readLatestEmail({
    to: approved.email,
    template: "license-approved",
    since,
  });
  expect(email.subject).toMatch(
    new RegExp(`^Approved: your license ${LICENSE_CODE.source} is ready$`),
  );
  expect(email.text).toMatch(/\/l\/[A-Za-z0-9_-]{43}/);
  expect(email.text).toMatch(new RegExp(`/verify/${LICENSE_CODE.source}`));
  expect(email.text).toContain("Amounts in Canadian dollars (CAD).");
  expect(email.text).toContain("CA$1,732.50");
  expect(email.text).not.toMatch(BARE_DOLLAR);

  // The Inbox, two waiting (soonest deadline first), on a running clock: this context's first clock call, so the page
  // loads running; a decline after a pause would run on a paused clock (a new document replays the pause).
  await page.clock.install();
  await page.goto("/dashboard");
  const h1 = page.getByRole("heading", { level: 1 });
  await expect(h1).toHaveText(
    `${INBOX_COPY.title} ${INBOX_COPY.waitingForYou(2)}`,
  );
  await expect(
    page.getByRole("link", {
      name: INBOX_COPY.waitingSegment(2),
      exact: true,
    }),
  ).toBeVisible();
  const rows = page.locator("[data-inbox-row]");
  const licensees = rows.locator("[data-licensee]");
  await expect(licensees).toHaveText([E2E_LICENSEE, NORTHWIND]);
  const row = rows.filter({ hasText: E2E_LICENSEE });
  const declinedRow = rows.filter({ hasText: NORTHWIND });

  // Decline the third from its row (01 J8.4): one tap, no confirm. While the clock still runs (the action's value comes
  // first, its refreshed page after it): the line, the toast with the same words and no seal, the Declined pill, the
  // focus on the row's status described by the line, and the counts already down by one.
  const declineSince = Date.now();
  const closed = requestEnded(page, isServerAction);
  await pressLocator(
    declinedRow.getByRole("button", { name: INBOX_COPY.decline }),
  );
  const line = declinedRow.getByText(INBOX_COPY.declinedLine, { exact: true });
  await expect(line).toBeVisible();
  const declineToast = page.locator("ol > li", {
    hasText: INBOX_COPY.declinedLine,
  });
  await expect(declineToast).toBeVisible();
  await expect(declineToast.locator("svg")).toHaveCount(0);
  if (await tabBar.isVisible()) {
    const [toastBox, barBox] = await Promise.all([
      boxOf(declineToast),
      boxOf(tabBar),
    ]);
    expect(toastBox.bottom).toBeLessThanOrEqual(barBox.top + 1);
  }
  const declinedPill = declinedRow.getByText("Declined", { exact: true });
  await expect(declinedPill).toBeVisible();
  const declinedStatus = declinedRow.locator("[data-row-status]");
  await expect(declinedStatus).toBeFocused();
  await expect(declinedStatus).toHaveAccessibleDescription(
    INBOX_COPY.declinedLine,
  );
  await expect(h1).toHaveText(
    `${INBOX_COPY.title} ${INBOX_COPY.waitingForYou(1)}`,
  );
  await expect(
    page.getByRole("link", {
      name: INBOX_COPY.waitingSegment(1),
      exact: true,
    }),
  ).toBeVisible();
  await closed;
  await page.clock.pauseAt(new Date(Date.now() + 1_000));

  // Held until the next refresh: the declined row at its index with no buttons, the first still counting down.
  await expect(licensees).toHaveText([E2E_LICENSEE, NORTHWIND]);
  await expect(declinedRow.getByRole("button")).toHaveCount(0);
  await expect(row.locator("time")).toHaveText(/^Expires in /);
  const name = row.locator("[data-licensee]");
  const chip = row.locator("time").locator("..");
  const decline = row.getByRole("button", { name: INBOX_COPY.decline });
  const approve = row.getByRole("button", { name: INBOX_COPY.approve });
  // getByRole skips the Details copy the other tier hides (display: none).
  const details = row.getByRole("button", {
    name: INBOX_COPY.details,
    exact: true,
  });
  const declinedName = declinedRow.locator("[data-licensee]");
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    const [
      nameBox,
      chipBox,
      rowBox,
      declineBox,
      approveBox,
      detailsBox,
      declinedBox,
      declinedNameBox,
      pillBox,
    ] = await Promise.all([
      boxOf(name),
      boxOf(chip),
      boxOf(row),
      boxOf(decline),
      boxOf(approve),
      boxOf(details),
      boxOf(declinedRow),
      boxOf(declinedName),
      boxOf(declinedPill),
    ]);
    if (width < TIERS.tablet) {
      expect(chipBox.top).toBeGreaterThanOrEqual(nameBox.bottom - 1);
      expect(pillBox.top).toBeGreaterThanOrEqual(declinedNameBox.bottom - 1);
      // Decline in the row's left half, Approve in its right half, the visible Details under them.
      const middle = (rowBox.left + rowBox.right) / 2;
      expect(declineBox.left).toBeGreaterThanOrEqual(rowBox.left - 1);
      expect(declineBox.right).toBeLessThanOrEqual(middle + 1);
      expect(approveBox.left).toBeGreaterThanOrEqual(middle - 1);
      expect(detailsBox.top).toBeGreaterThanOrEqual(approveBox.bottom - 1);
    } else {
      expect(chipBox.top).toBeLessThan(nameBox.bottom);
      expect(chipBox.bottom).toBeGreaterThan(nameBox.top);
      expect(Math.abs(chipBox.right - rowBox.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(pillBox.right - declinedBox.right)).toBeLessThanOrEqual(
        1,
      );
      // Details · Decline · Approve, Decline directly left of Approve, Approve the rightmost control.
      expect(detailsBox.right).toBeLessThanOrEqual(declineBox.left + 1);
      expect(declineBox.right).toBeLessThanOrEqual(approveBox.left + 1);
      expect(approveBox.left - declineBox.right).toBeLessThanOrEqual(13);
      expect(approveBox.right).toBeGreaterThanOrEqual(
        (await rightmostControl(row)) - 1,
      );
    }
    expect(Math.abs(declineBox.top - approveBox.top)).toBeLessThanOrEqual(1);
    expect(approveBox.right).toBeLessThanOrEqual(rowBox.right + 1);
    await expectTextInside(line, declinedRow);
  });

  // The next refresh (a focus) lets the declined row go; the focus it held moves to the title (WCAG 2.4.3). Its fetch
  // ends before the page is left (isRouterRefresh).
  await page.clock.resume();
  const refreshed = requestEnded(page, isRouterRefresh);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(rows).toHaveCount(1);
  await expect(licensees).toHaveText([E2E_LICENSEE]);
  await expect(h1).toBeFocused();
  await refreshed;

  // The buyer's request-declined email (05 §8): /r's Not approved body and the buyer's own /r link, no amount.
  const declinedEmail = await readLatestEmail({
    to: declined.email,
    template: "request-declined",
    since: declineSince,
  });
  expect(declinedEmail.subject).toBe("Not approved: you weren't charged");
  expect(declinedEmail.text).toContain(
    REQUEST_STATUS_COPY.declinedBody(handle),
  );
  expect(declinedEmail.text).toContain(`Or open: ${declined.statusUrl}`);
  expect(declinedEmail.text).not.toMatch(BARE_DOLLAR);

  // History: the approved row keeps its pill and code inside it and reads Paid out inside its text column (P19b; owner
  // answer Q-146 a), the declined row its pill. The transfer runs in after(), so a page still reading Payout pending is
  // reloaded until it lands.
  await openPaused(page, "/dashboard?view=history");
  const done = page.locator("[data-inbox-row]");
  await expect(done).toHaveCount(2);
  const approvedDone = done.filter({ hasText: LICENSE_CODE });
  const declinedDone = done.filter({ hasText: NORTHWIND });
  const pill = approvedDone.getByText("Approved", { exact: true });
  const code = approvedDone.getByText(LICENSE_CODE);
  const paidOut = approvedDone.getByText(PAYOUT_LINE_COPY.paidOut, {
    exact: true,
  });
  const payoutPending = approvedDone.getByText(PAYOUT_LINE_COPY.pending, {
    exact: true,
  });
  await expect(async () => {
    if (await payoutPending.isVisible()) await page.reload();
    await expect(paidOut).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  const textColumn = approvedDone.locator("[data-licensee]").locator("..");
  const declinedDonePill = declinedDone.getByText("Declined", { exact: true });
  await expect(declinedDonePill).toBeVisible();
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectInside(pill, approvedDone);
    await expectInside(code, approvedDone);
    await expectTextInside(paidOut, textColumn);
    await expectInside(declinedDonePill, declinedDone);
  });

  // The request page: Decline before Approve, each lg button at its own width in the left-aligned column (07 D149); on
  // one line from 375, while at 320 Approve may wrap under Decline.
  await openPaused(page, `/dashboard/requests/${requestId}`);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(/ wants to license /);
  const detailDecline = page.getByRole("button", { name: INBOX_COPY.decline });
  const detailApprove = page.getByRole("button", { name: INBOX_COPY.approve });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectSettingsColumn(page, width);
    await expectInsideColumn(detailDecline);
    await expectInsideColumn(detailApprove);
    const [declineBox, approveBox] = await Promise.all([
      boxOf(detailDecline),
      boxOf(detailApprove),
    ]);
    if (width >= 375) {
      expect(declineBox.right).toBeLessThanOrEqual(approveBox.left);
      expect(Math.abs(declineBox.top - approveBox.top)).toBeLessThanOrEqual(1);
    } else {
      expect(
        declineBox.right <= approveBox.left ||
          declineBox.bottom <= approveBox.top,
        "Decline left of Approve or above it",
      ).toBe(true);
    }
  });
  expect(errors).toEqual([]);

  // /r, logged out, at the project's own viewport.
  const buyerContext = await browser.newContext({ baseURL });
  const buyer = await buyerContext.newPage();
  const buyerErrors = collectConsoleErrors(buyer);
  const buyerHeading = buyer.getByRole("heading", { level: 1 });
  await openPaused(buyer, statusUrl);
  await expect(buyerHeading).toHaveText(
    REQUEST_STATUS_COPY.waitingTitle(handle),
  );
  const summary = buyer.locator("main section");
  await atEveryWidth(buyer, testInfo, async ({ width }) => {
    await expectReadingPage(buyer, width);
    await expectInsideColumn(summary);
  });

  // The approved request's /r: its ending and the 40 px seal, in the same column.
  await openPaused(buyer, approved.statusUrl);
  await expect(buyerHeading).toHaveText(REQUEST_STATUS_COPY.approvedTitle);
  const seal = buyer.locator("main svg[aria-hidden='true'][width='40']");
  await expect(seal).toHaveCount(1);
  await atEveryWidth(buyer, testInfo, async ({ width }) => {
    await expectReadingPage(buyer, width);
    await expectInsideColumn(summary);
    await expectInsideColumn(seal);
  });

  // The declined request's /r (01 §4.8): Not approved with the creator's body, neutral, no way back, in the same column.
  await openPaused(buyer, declined.statusUrl);
  await expect(buyerHeading).toHaveText(REQUEST_STATUS_COPY.declinedTitle);
  await expect(
    buyer.getByText(REQUEST_STATUS_COPY.declinedBody(handle), { exact: true }),
  ).toBeVisible();
  await expect(
    buyer.getByRole("link", { name: REQUEST_STATUS_COPY.backToLicense }),
  ).toHaveCount(0);
  await atEveryWidth(buyer, testInfo, async ({ width }) => {
    await expectReadingPage(buyer, width);
    await expectInsideColumn(summary);
    await expectNeutralHeading(buyerHeading);
  });
  await buyerContext.close();
  expect(buyerErrors).toEqual([]);

  // Approve the first from its Inbox row (01 J8.2; 02 §4.4 rule 2): the row stays in Waiting with its outcome while the
  // counts drop at once, the focus on its status; the next focus refresh moves it to History.
  await page.clock.resume();
  await page.goto("/dashboard");
  await pressLocator(approve);
  await expect(page.locator("li", { hasText: APPROVED_TOAST })).toBeVisible();
  await expect(row.getByText(/^License CL-.* issued$/)).toBeVisible();
  await expect(row.getByText("Approved", { exact: true })).toBeVisible();
  await expect(row.locator("[data-row-status]")).toBeFocused();
  await expect(h1).toHaveText(`${INBOX_COPY.title} ${INBOX_COPY.caughtUp}`);
  const refreshedAgain = requestEnded(page, isRouterRefresh);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(rows).toHaveCount(0);
  await refreshedAgain;
  expect(errors).toEqual([]);
});

test("01 §4.8, owner answer Q-142 a: an overdue request's /r expires it before rendering and reads No answer in time, in one centered column at every tier", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(300_000);
  const { shareUrl, handle } = await publishDemoVideo(page);
  const { requestId, statusUrl, context } = await buyLicense(
    browser,
    shareUrl,
    CHOICE,
  );
  await context.close();

  // The dev clock without its cron call (README "Force a request overdue"): the deadline moves to 1 ms after the
  // authorization and nothing has expired the request yet. This creator's pages are never opened again (their lazy
  // expiry would race), so only /r's own read can expire it.
  const printed = execFileSync(
    "bunx",
    ["tsx", "scripts/dev-expire-request.ts", requestId, "--no-cron"],
    { env: { ...process.env, NODE_ENV: "test" }, encoding: "utf8" },
  );
  expect(printed.trim().split("\n")).toHaveLength(1);
  const forced = JSON.parse(printed) as {
    requestId: string;
    expiresAt: string;
    cron: null;
  };
  expect(forced).toEqual({
    requestId,
    expiresAt: expect.any(String),
    cron: null,
  });
  expect(Date.parse(forced.expiresAt)).toBeLessThan(Date.now());

  // /r in a fresh logged-out context at the project's own viewport, in a fixed zone for the deadline's words (07 D84).
  const timezoneId = "America/Toronto";
  const buyerContext = await browser.newContext({ baseURL, timezoneId });
  const buyer = await buyerContext.newPage();
  const errors = collectConsoleErrors(buyer);
  await openPaused(buyer, statusUrl);
  const heading = buyer.getByRole("heading", { level: 1 });
  await expect(heading).toHaveText(REQUEST_STATUS_COPY.expiredTitle);
  // The tab title too: the page and its metadata share one read, which waited for the expiry.
  await expect(buyer).toHaveTitle(
    `${REQUEST_STATUS_COPY.expiredTitle} · ${APP_NAME}`,
  );
  // After mount, with the sentence naming the deadline in the viewer's zone; no countdown and no way back.
  await expect(
    buyer.getByText(
      REQUEST_STATUS_COPY.expiredBody(
        handle,
        formatDeadline(new Date(forced.expiresAt), timezoneId),
      ),
      { exact: true },
    ),
  ).toBeVisible();
  await expect(buyer.locator("main time")).toHaveCount(0);
  await expect(
    buyer.getByRole("link", { name: REQUEST_STATUS_COPY.backToLicense }),
  ).toHaveCount(0);
  const summary = buyer.locator("main section");
  await atEveryWidth(buyer, testInfo, async ({ width }) => {
    await expectReadingPage(buyer, width);
    await expectInsideColumn(summary);
    await expectNeutralHeading(heading);
  });
  await buyerContext.close();
  expect(errors).toEqual([]);
});
