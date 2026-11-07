import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { CHECKOUT_COPY } from "../../src/lib/licensing/checkout-copy";
import { INBOX_COPY } from "../../src/lib/licensing/inbox";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { videoHref } from "../../src/lib/videos/steps";
import { readLatestEmail } from "../helpers/read-latest-email";
import {
  availabilityNotice,
  BUYER_PHONE,
  choose,
  E2E_LICENSEE,
  FAKE_CHECKOUT_URL,
  fillDetails,
  hydrated,
  requestButton,
} from "./helpers/buyer";
import { holdReady } from "./helpers/checkout-hold";
import { collectConsoleErrors } from "./helpers/console";
import { buyLicense, offerExclusive, publishDemoVideo } from "./helpers/flows";
import { expectNoBareDollar } from "./helpers/layout";
import { forceLicenseExclusive } from "./helpers/licenses";
import {
  pressAndSettle,
  pressAndSettleIn,
  pressLocator,
} from "./helpers/press";
import { cleanCreatedVideos } from "./helpers/videos";

// Approving an exclusive license (P19g; 01 J8.2, J12.7, J12.9–J12.12, J12.15; 04 §9.11, §11.3, §11.5; 05 §8; 07 D111,
// D113, D127; owner answer Q-178) on chromium-desktop and webkit-iphone, auto-approve off. Buyer A pays the 1-year
// exclusive at ×3.00 (CA$5,197.50) and waits on /r with the exclusive line; the creator approves with one tap, no
// dialog, and the toast pays the premium (CA$4,725.00); the row stays with Approved, the tag and the code, History
// keeps the tag; the creator's lines name the licensee, the public card and the license page don't; the buyer's email
// says until when, in UTC. A second test forces a standard license exclusive in the test database, the state the
// re-check under the video lock exists for: the next standard request's Approve declines it without a charge, says so
// in the row, the toast, /r and request-declined. Radios are worked by keyboard (choose).
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

/** Paid social ads · 1 year · Worldwide. */
const CHOICE = {
  use: "paid_social",
  term: "y1",
  territory: "worldwide",
} as const;

const DATE = String.raw`\d{1,2} [A-Z][a-z]{2} \d{4}`;
const LICENSE_CODE = /CL-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/;
const NORTHWIND = "Northwind Brands Inc.";

/** The polite toast saying `text`. */
const toast = (page: Page, text: string) =>
  page.locator("ol > li", { hasText: text });

test("J12.7, J12.9–J12.12, J12.15: an exclusive license approved with one tap pays the premium, blocks the video with the date, names the licensee only to the creator, and emails the end in UTC", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const since = Date.now();
  const creatorErrors = collectConsoleErrors(page);
  const { handle, shareUrl, videoId } = await publishDemoVideo(page);
  await offerExclusive(page);

  // Buyer A: the 1-year exclusive at the premium, then the fake checkout's label and Pay.
  const contextA = await browser.newContext({ baseURL, viewport: BUYER_PHONE });
  const a = await contextA.newPage();
  const errorsA = collectConsoleErrors(a);
  await a.goto(shareUrl);
  await hydrated(a);
  await choose(a, "use", CHOICE.use);
  await choose(a, "term", CHOICE.term);
  await choose(a, "exclusive", "true");
  await choose(a, "territory", CHOICE.territory);
  await expect(a.locator("[data-pricebar] [data-price-total]")).toContainText(
    "Total CA$5,197.50",
  );
  await expect(requestButton(a)).toHaveAccessibleName(
    "Request license · CA$5,197.50",
  );
  const buyerEmail = `buyer+${randomUUID().slice(0, 8)}@example.com`;
  await fillDetails(a, { email: buyerEmail });
  const terms = a.getByRole("checkbox");
  await terms.focus();
  await terms.press("Space");
  await pressLocator(requestButton(a));
  await a.waitForURL(FAKE_CHECKOUT_URL);
  await expect(a.getByText(/^Exclusive license · /)).toBeVisible();
  await holdReady(a);
  await pressAndSettle(a, CHECKOUT_COPY.pay("CA$5,197.50"));
  const headingA = a.getByRole("heading", { level: 1 });
  await expect(headingA).toHaveText(REQUEST_STATUS_COPY.waitingTitle(handle));
  await expect(
    a.getByText(REQUEST_STATUS_COPY.exclusiveWaiting(handle, false), {
      exact: true,
    }),
  ).toBeVisible();
  const statusUrl = a.url().replace(/&session_id=[^&]*$/, "");
  // Off /r before its first 30 s refresh: WebKit cancels a refresh in flight and Next's fallback interrupts a goto.
  await a.goto("about:blank");

  // The creator: the tag and what approving does, then one tap and no dialog.
  await page.goto("/dashboard");
  const row = page.locator("[data-inbox-row]");
  await expect(row).toHaveCount(1);
  await expect(
    row.getByText(INBOX_COPY.exclusiveTag, { exact: true }),
  ).toBeVisible();
  await expect(
    row.getByText(/^Exclusive request\. If you approve, no one else/),
  ).toBeVisible();
  await pressAndSettleIn(page, row, INBOX_COPY.approve);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    toast(page, INBOX_COPY.approvedToast("CA$4,725.00")),
  ).toBeVisible();

  // The row stays in Waiting: Approved, the tag beside it, the code issued; the focus on its status.
  const status = row.locator("[data-row-status]");
  await expect(status.getByText("Approved", { exact: true })).toBeVisible();
  await expect(
    status.getByText(INBOX_COPY.exclusiveTag, { exact: true }),
  ).toBeVisible();
  await expect(row.getByText(/^License CL-.+ issued$/)).toBeVisible();
  await expect(status).toBeFocused();
  await expectNoBareDollar(page);

  // History keeps the tag beside Approved.
  await page.goto("/dashboard?view=history");
  const historyStatus = page
    .locator("[data-inbox-row]")
    .locator("[data-row-status]");
  await expect(historyStatus).toHaveCount(1);
  await expect(
    historyStatus.getByText("Approved", { exact: true }),
  ).toBeVisible();
  await expect(
    historyStatus.getByText(INBOX_COPY.exclusiveTag, { exact: true }),
  ).toBeVisible();

  // The creator's lines name the licensee and the date.
  const licensedTo = new RegExp(
    `^Licensed exclusively to ${E2E_LICENSEE} until ${DATE}$`,
  );
  const main = page.locator("main");
  await page.goto("/dashboard/videos");
  await expect(main.getByText(licensedTo)).toBeVisible();
  await page.goto(videoHref(videoId));
  await expect(main.getByText(licensedTo)).toBeVisible();
  await expectNoBareDollar(page);

  // A's /r reads Approved, and the email says until when, in UTC, with the license link.
  await a.goto(statusUrl);
  await expect(headingA).toHaveText(REQUEST_STATUS_COPY.approvedTitle);
  const approved = await readLatestEmail({
    to: buyerEmail,
    template: "license-approved",
    since,
  });
  expect(approved.text).toMatch(
    new RegExp(
      `This license is exclusive: no one else can license this video until ${DATE}, \\d{2}:\\d{2} UTC\\.`,
    ),
  );
  expect(approved.text).toContain("CA$5,197.50");
  expect(approved.text).toContain("/l/");
  expect(approved.text).toMatch(LICENSE_CODE);
  await contextA.close();
  expect(errorsA).toEqual([]);

  // Buyer B: the license page reads licensed exclusively, with no option, form or button.
  const contextB = await browser.newContext({ baseURL, viewport: BUYER_PHONE });
  const b = await contextB.newPage();
  const errorsB = collectConsoleErrors(b);
  const response = await b.goto(shareUrl);
  expect(response?.status()).toBe(200);
  await expect(availabilityNotice(b)).toContainText(
    new RegExp(`This video is licensed exclusively until ${DATE}\\.`),
  );
  await expect(b.locator('input[type="radio"]')).toHaveCount(0);
  await expect(b.locator("#license-form")).toHaveCount(0);
  await expect(b.getByRole("button", { name: /^Request license/ })).toHaveCount(
    0,
  );
  expect(await b.locator("body").innerText()).not.toContain(E2E_LICENSEE);
  await expectNoBareDollar(b);

  // The public card gives the date and never a name.
  await b.goto(`/@${handle}`);
  await expect(
    b
      .locator("[data-video-card]")
      .getByText(new RegExp(`^Licensed exclusively until ${DATE}$`)),
  ).toBeVisible();
  expect(await b.locator("body").innerText()).not.toContain(E2E_LICENSEE);
  await contextB.close();
  expect(errorsB).toEqual([]);
  expect(creatorErrors).toEqual([]);
});

test("J8.2, J12.9: a license the checks missed blocks the video: Approve declines the waiting request without a charge, in the row, the toast, /r and request-declined", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const since = Date.now();
  const creatorErrors = collectConsoleErrors(page);
  const { shareUrl } = await publishDemoVideo(page);

  // Buyer C's standard license, approved.
  const c = await buyLicense(browser, shareUrl, CHOICE);
  await c.context.close();
  await page.goto("/dashboard");
  const row = page.locator("[data-inbox-row]");
  await expect(row).toHaveCount(1);
  await pressAndSettleIn(page, row, INBOX_COPY.approve);
  await expect(
    toast(page, INBOX_COPY.approvedToast("CA$1,575.00")),
  ).toBeVisible();
  // Off the Inbox before its next refresh, as A leaves /r in the first test.
  await page.goto("about:blank");

  // Buyer D waits on a standard request; then C's license becomes exclusive behind the checks' back.
  const d = await buyLicense(browser, shareUrl, {
    ...CHOICE,
    licensee: NORTHWIND,
  });
  await forceLicenseExclusive(c.requestId);

  await page.goto("/dashboard");
  await expect(row).toHaveCount(1);
  await expect(row.locator("[data-licensee]")).toHaveText(NORTHWIND);
  await pressAndSettleIn(page, row, INBOX_COPY.approve);
  const line = INBOX_COPY.exclusiveConflictLine;
  const conflictToast = toast(page, line);
  await expect(conflictToast).toBeVisible();
  await expect(conflictToast.locator("svg")).toHaveCount(0);
  const status = row.locator("[data-row-status]");
  await expect(status.getByText("Declined", { exact: true })).toBeVisible();
  await expect(status).toBeFocused();
  await expect(status).toHaveAccessibleDescription(line);
  await expect(row.getByText(line, { exact: true })).toHaveCount(1);
  await expect(row.locator("time")).toHaveCount(0);
  await expect(row.getByRole("button")).toHaveCount(0);
  // No seal: the price line keeps no icon and says no "You get".
  const price = row.getByText(/ · CA\$1,575\.00$/);
  await expect(price).toBeVisible();
  await expect(price.locator("svg")).toHaveCount(0);
  await expectNoBareDollar(page);

  // D's /r and email: not approved, and why, with the hold released.
  const buyer = await d.context.newPage();
  const errorsD = collectConsoleErrors(buyer);
  await buyer.goto(d.statusUrl);
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
    REQUEST_STATUS_COPY.declinedTitle,
  );
  await expect(
    buyer.getByText(REQUEST_STATUS_COPY.exclusiveConflictBody, {
      exact: true,
    }),
  ).toBeVisible();
  const declined = await readLatestEmail({
    to: d.email,
    template: "request-declined",
    since,
  });
  expect(declined.text).toContain(REQUEST_STATUS_COPY.exclusiveConflictBody);
  await d.context.close();
  expect(errorsD).toEqual([]);
  expect(creatorErrors).toEqual([]);
});
