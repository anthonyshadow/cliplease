import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { AVAILABILITY_COPY } from "../../src/lib/licensing/availability";
import { CHECKOUT_COPY } from "../../src/lib/licensing/checkout-copy";
import { INBOX_COPY } from "../../src/lib/licensing/inbox";
import { LICENSE_PAGE_COPY } from "../../src/lib/licensing/license-page";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { videoHref } from "../../src/lib/videos/steps";
import { cad } from "../helpers/money";
import { readLatestEmail } from "../helpers/read-latest-email";
import {
  availabilityNotice,
  BUYER_PHONE,
  choose,
  chooseDemoSelection,
  E2E_LICENSEE,
  FAKE_CHECKOUT_URL,
  fillDetails,
  hydrated,
  licenseTypeGroup,
  optionTile,
  radio,
  requestButton,
} from "./helpers/buyer";
import { holdClock, holdReady } from "./helpers/checkout-hold";
import { collectConsoleErrors } from "./helpers/console";
import { buyLicense, offerExclusive, publishDemoVideo } from "./helpers/flows";
import { expectNoBareDollar } from "./helpers/layout";
import {
  isRouterRefresh,
  pressAndSettle,
  pressLocator,
  requestEnded,
} from "./helpers/press";
import {
  optionSwitch,
  PRICING,
  pricesSavedToast,
  setExclusiveSwitch,
} from "./helpers/pricing";
import { cleanCreatedVideos } from "./helpers/videos";

// Exclusive requests and what they reserve (P19f; 01 J12; 04 §9.35, §11.2, §11.5; 05 §4.1, §10; 07 D110–D113; owner answers
// Q-168, Q-169, Q-172, Q-173) on chromium-desktop and webkit-iphone. The creator offers exclusive licenses at ×3.00 with
// auto-approve off, and no test approves one: until P19g that issues an ordinary license at the premium. A buyer gets the
// License type group only once it is offered; Exclusive moves a Perpetual term to the longest it allows and says so
// politely, never moving the focus; the premium reaches the bar, the summary, the hold copy and the fake checkout. Once it
// is paid the video is reserved: another buyer's press lands on the notice with no options, the creator sees the tag and
// the line on the Inbox and the request page, and "Exclusive request waiting" on their video, and the public card reads
// Reserved. A running standard license refuses an Exclusive already on the page, whose press falls back to Standard at
// the standard price. Radios are worked by keyboard: on the iPhone a click near the bottom can land on the fixed bar.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

/** Paid social ads · 1 year · Worldwide. */
const CHOICE = {
  use: "paid_social",
  term: "y1",
  territory: "worldwide",
} as const;

const TERM_MOVED_TO_1_YEAR =
  "Term changed to 1 year. Exclusive licenses last up to 1 year.";
const TERM_MOVED_TO_6_MONTHS =
  "Term changed to 6 months. Exclusive licenses last up to 1 year.";

/** The polite line in the License type group, read after a move. */
const termMoved = (page: Page) =>
  licenseTypeGroup(page).locator('[aria-live="polite"]');

/** Ticks the terms by keyboard, as a buyer who has filled in the details. */
async function tickTerms(page: Page) {
  const terms = page.getByRole("checkbox");
  await terms.focus();
  await terms.press("Space");
}

/** "Exclusive request. If you approve, no one else can license this video until 20 Nov 2027." */
const APPROVE_LINE =
  /^Exclusive request\. If you approve, no one else can license this video until \d{1,2} [A-Z][a-z]{2} \d{4}\.$/;

test("J12.3, J12.4, J12.6, J12.11, J12.12: once offered, a buyer's Exclusive moves a Perpetual term, costs the premium, and once paid reserves the video: the next buyer lands on the notice, and the creator sees the tag, the line and both emails", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(240_000);
  const since = Date.now();
  const creatorErrors = collectConsoleErrors(page);
  const {
    email: creatorEmail,
    handle,
    shareUrl,
    videoId,
  } = await publishDemoVideo(page);

  // Before the offer there is no group.
  const contextA = await browser.newContext({ baseURL, viewport: BUYER_PHONE });
  const a = await contextA.newPage();
  const errorsA = collectConsoleErrors(a);
  await a.goto(shareUrl);
  await hydrated(a);
  await expect(licenseTypeGroup(a)).toHaveCount(0);

  await offerExclusive(page);

  // Buyer B opens the link now and keeps it open: an option the page still shows when A's request takes the video.
  const contextB = await browser.newContext({ baseURL, viewport: BUYER_PHONE });
  const b = await contextB.newPage();
  const errorsB = collectConsoleErrors(b);
  await b.goto(shareUrl);
  await hydrated(b);

  // First load: Organic social repost · 30 days · One country, Standard chosen, Exclusive's delta beside it.
  await a.reload();
  await hydrated(a);
  await expect(licenseTypeGroup(a)).toBeVisible();
  await expect(radio(a, "exclusive", "false")).toBeChecked();
  const exclusiveTile = optionTile(a, "exclusive", "true");
  await expect(exclusiveTile).toContainText("+ CA$300");

  // From Paid social ads · Perpetual · Worldwide, Exclusive is on offer at its own 1 year price.
  await choose(a, "use", "paid_social");
  await choose(a, "term", "perpetual");
  await choose(a, "territory", "worldwide");
  await expect(radio(a, "exclusive", "true")).toBeEnabled();
  await expect(exclusiveTile).toContainText("+ CA$2,362.50");

  // Exclusive moves the term and says so; Perpetual stays off, with why.
  const perpetual = radio(a, "term", "perpetual");
  await choose(a, "exclusive", "true");
  await expect(radio(a, "term", "y1")).toBeChecked();
  await expect(perpetual).toBeDisabled();
  await expect(optionTile(a, "term", "perpetual")).toContainText(
    LICENSE_PAGE_COPY.exclusiveTerm,
  );
  await expect(termMoved(a)).toHaveText(TERM_MOVED_TO_1_YEAR);

  // Standard leaves the term where it is: Perpetual is on again, not chosen again.
  await choose(a, "exclusive", "false");
  await expect(radio(a, "term", "y1")).toBeChecked();
  await expect(perpetual).toBeEnabled();
  await expect(termMoved(a)).toHaveText("");

  // By keyboard the focus stays on what was pressed, and the line still says what moved.
  await choose(a, "term", "perpetual");
  const standard = radio(a, "exclusive", "false");
  await standard.focus();
  await standard.press("ArrowDown");
  const exclusive = radio(a, "exclusive", "true");
  await expect(exclusive).toBeChecked();
  await expect(exclusive).toBeFocused();
  await expect(radio(a, "term", "y1")).toBeChecked();
  await expect(termMoved(a)).toHaveText(TERM_MOVED_TO_1_YEAR);

  // Paid · 1 year · Worldwide · Exclusive: the premium in the bar, the form, the tiles, the summary and the hold copy.
  const bar = a.locator("[data-pricebar]");
  await expect(bar.locator("[data-price-lines]")).toHaveText(
    "License CA$4,725.00 · Service fee CA$472.50",
  );
  await expect(bar.locator("[data-price-total]")).toContainText(
    "Total CA$5,197.50",
  );
  await expect(requestButton(a)).toHaveAccessibleName(
    "Request license · CA$5,197.50",
  );
  await expect(a.locator('input[name="expectedTotalCents"]')).toHaveValue(
    "519750",
  );
  await expect(optionTile(a, "exclusive", "false")).toContainText("− CA$3,150");
  await expect(
    a.getByText(
      `@${handle} won't license this video to anyone else, for any use or place, for 1 year from approval.`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    a.getByText(LICENSE_PAGE_COPY.holdExclusive(handle), { exact: true }),
  ).toBeVisible();
  await expectNoBareDollar(a);

  // Request, then the fake checkout: its label, the clock and the premium's total.
  const buyerEmail = `buyer+${randomUUID().slice(0, 8)}@example.com`;
  await fillDetails(a, { email: buyerEmail });
  await tickTerms(a);
  await pressLocator(requestButton(a));
  await a.waitForURL(FAKE_CHECKOUT_URL);
  const requestId = a.url().split("/").at(-1) ?? "";
  await expect(a.getByText(/^Exclusive license · /)).toBeVisible();
  await expect(holdClock(a)).toBeVisible();
  await expect(
    a.locator("main dl > div", { hasText: CHECKOUT_COPY.total }),
  ).toContainText("CA$5,197.50");
  await expectNoBareDollar(a);
  await holdReady(a);
  await pressAndSettle(a, CHECKOUT_COPY.pay("CA$5,197.50"));
  await expect(a.getByRole("heading", { level: 1 })).toHaveText(
    REQUEST_STATUS_COPY.waitingTitle(handle),
  );
  await contextA.close();
  expect(errorsA).toEqual([]);

  // Buyer B, on the page from before: a standard press lands on the notice, never the fake checkout.
  await b
    .getByLabel(LICENSE_PAGE_COPY.country.label, { exact: true })
    .selectOption("CA");
  await fillDetails(b, { licensee: "Someone Else Media Inc." });
  await tickTerms(b);
  const refreshed = requestEnded(b, isRouterRefresh);
  await pressLocator(requestButton(b));
  await refreshed;
  const notice = availabilityNotice(b);
  await expect(notice).toBeVisible();
  if (testInfo.project.name === "chromium-desktop") {
    await expect(notice).toBeFocused();
  }
  await expect(b).not.toHaveURL(FAKE_CHECKOUT_URL);
  await expect(
    notice.getByText(AVAILABILITY_COPY.notice.reservedTitle, { exact: true }),
  ).toBeVisible();
  await expect(
    notice.getByText(AVAILABILITY_COPY.notice.reservedBody, { exact: true }),
  ).toBeVisible();

  // Reloaded, the same page from the server: the notice and "What you get", no option, form or bar. A reserved page
  // refreshes itself, every 3 s at first: its fetch ends before the page is left (isRouterRefresh).
  await requestEnded(b, isRouterRefresh);
  const reloaded = await b.reload();
  expect(reloaded?.status()).toBe(200);
  // In the first HTML too, so no option flashes before hydration (AD-66). Not data-pricebar: the real page's HTML has it.
  const html = (await reloaded?.text()) ?? "";
  expect(html).not.toContain('type="radio"');
  expect(html).not.toContain('id="license-form"');
  await expect(availabilityNotice(b)).toBeVisible();
  await expect(b.locator('input[type="radio"]')).toHaveCount(0);
  await expect(b.locator("#license-form")).toHaveCount(0);
  await expect(b.getByRole("button", { name: /^Request license/ })).toHaveCount(
    0,
  );
  await expect(b.locator('input[name="timeZone"]')).toHaveCount(0);
  await expect(b.locator("[data-pricebar]")).toHaveCount(0);
  await expect(
    b.getByText(LICENSE_PAGE_COPY.whatYouGet.title, { exact: true }),
  ).toBeVisible();
  await expectNoBareDollar(b);

  // The Inbox: A's request alone, with the tag, what approving does and the prefixed scope.
  await page.goto("/dashboard");
  const row = page.locator("[data-inbox-row]");
  await expect(row).toHaveCount(1);
  await expect(row.locator("[data-licensee]")).toHaveText(E2E_LICENSEE);
  await expect(
    row.getByText(INBOX_COPY.exclusiveTag, { exact: true }),
  ).toBeVisible();
  await expect(row.getByText(APPROVE_LINE)).toBeVisible();
  await expect(
    row.getByText("Exclusive · Paid social ads · 1 year · Worldwide", {
      exact: true,
    }),
  ).toBeVisible();
  await expectNoBareDollar(page);

  // Its page: the tag, the line above the buttons and the License type fact.
  await page.goto(`/dashboard/requests/${requestId}`);
  const main = page.locator("main");
  await expect(
    main.getByText(INBOX_COPY.exclusiveTag, { exact: true }),
  ).toBeVisible();
  await expect(main.getByText(APPROVE_LINE)).toBeVisible();
  const facts = main.locator("dl");
  await expect(facts).toContainText(INBOX_COPY.facts.licenseType);
  await expect(facts).toContainText(INBOX_COPY.licenseTypeFact("×3.00"));
  await expectNoBareDollar(page);

  // The creator's video, on its card and its page; the public card says only Reserved.
  await page.goto("/dashboard/videos");
  await expect(
    main.getByText(AVAILABILITY_COPY.line.requestWaiting, { exact: true }),
  ).toBeVisible();
  await expectNoBareDollar(page);
  await page.goto(videoHref(videoId));
  await expect(
    main.getByText(AVAILABILITY_COPY.line.requestWaiting, { exact: true }),
  ).toBeVisible();
  await expectNoBareDollar(page);
  await requestEnded(b, isRouterRefresh);
  await b.goto(`/@${handle}`);
  await expect(
    b
      .locator("[data-video-card]")
      .getByText(AVAILABILITY_COPY.line.reserved, { exact: true }),
  ).toBeVisible();
  await expectNoBareDollar(b);
  await contextB.close();
  expect(errorsB).toEqual([]);

  // Both emails, each with its own line.
  const toCreator = await readLatestEmail({
    to: creatorEmail,
    template: "request-new",
    since,
  });
  expect(toCreator.text).toMatch(
    /Exclusive request\. If you approve, no one else can license this video until \d{1,2} [A-Z][a-z]{2} \d{4}\./,
  );
  const toBuyer = await readLatestEmail({
    to: buyerEmail,
    template: "request-received",
    since,
  });
  expect(toBuyer.text).toContain("Exclusive request");
  expect(creatorErrors).toEqual([]);
});

test("J12.5, J7.16: a standard license taking the video refuses an Exclusive already on the page: its press falls back to Standard at the standard price, the next press goes through, and a new visitor can't choose Exclusive", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const creatorErrors = collectConsoleErrors(page);
  const { shareUrl } = await publishDemoVideo(page);
  await offerExclusive(page);

  // This buyer gets as far as the press, with Exclusive chosen.
  const context = await browser.newContext({ baseURL, viewport: BUYER_PHONE });
  const buyer = await context.newPage();
  const errors = collectConsoleErrors(buyer);
  await buyer.goto(shareUrl);
  await hydrated(buyer);
  await chooseDemoSelection(buyer);
  await choose(buyer, "exclusive", "true");
  await fillDetails(buyer);
  await tickTerms(buyer);
  await expect(requestButton(buyer)).toHaveAccessibleName(
    LICENSE_PAGE_COPY.request(cad(519750)),
  );

  // Another buyer's standard license comes first.
  const other = await buyLicense(browser, shareUrl, CHOICE);
  await other.context.close();

  // Refused, the page repairs the choice and says why under the group.
  const refreshed = requestEnded(buyer, isRouterRefresh);
  await pressLocator(requestButton(buyer));
  await refreshed;
  await expect(radio(buyer, "exclusive", "false")).toBeChecked();
  // No banner: the group's line says it, and the bar is the only total.
  await expect(buyer.locator("[data-license-notice]")).toHaveCount(0);
  await expect(radio(buyer, "exclusive", "true")).toBeDisabled();
  await expect(optionTile(buyer, "exclusive", "true")).toContainText(
    LICENSE_PAGE_COPY.exclusiveUnavailable,
  );
  await expect(licenseTypeGroup(buyer)).toContainText(
    LICENSE_PAGE_COPY.optionGone,
  );
  await expect(
    buyer.locator("[data-pricebar] [data-price-total]"),
  ).toContainText(LICENSE_PAGE_COPY.total(cad(173250)));
  await expect(requestButton(buyer)).toHaveAccessibleName(
    LICENSE_PAGE_COPY.request(cad(173250)),
  );
  await expect(buyer).not.toHaveURL(FAKE_CHECKOUT_URL);
  await expectNoBareDollar(buyer);

  // The next press goes through, at the standard total.
  await pressLocator(requestButton(buyer));
  await buyer.waitForURL(FAKE_CHECKOUT_URL);
  await expect(
    buyer.locator("main dl > div", { hasText: CHECKOUT_COPY.total }),
  ).toContainText(cad(173250));
  await context.close();
  expect(errors).toEqual([]);

  // A new visitor: Exclusive off with why, Standard still theirs.
  const visitorContext = await browser.newContext({
    baseURL,
    viewport: BUYER_PHONE,
  });
  const visitor = await visitorContext.newPage();
  const visitorErrors = collectConsoleErrors(visitor);
  await visitor.goto(shareUrl);
  await hydrated(visitor);
  await expect(radio(visitor, "exclusive", "true")).toBeDisabled();
  await expect(optionTile(visitor, "exclusive", "true")).toContainText(
    LICENSE_PAGE_COPY.exclusiveUnavailable,
  );
  await expect(radio(visitor, "exclusive", "false")).toBeEnabled();
  await choose(visitor, "exclusive", "false");
  await expectNoBareDollar(visitor);
  await visitorContext.close();
  expect(visitorErrors).toEqual([]);
  expect(creatorErrors).toEqual([]);
});

test("J12.4, OQ-57, owner answer Q-168: with 1 year off on the rate card, Exclusive from Perpetual moves the term to 6 months and says so", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const creatorErrors = collectConsoleErrors(page);
  const { shareUrl } = await publishDemoVideo(page);
  await page.goto(PRICING);
  await setExclusiveSwitch(page, true);
  const oneYear = optionSwitch(page, "1 year");
  await oneYear.focus();
  await oneYear.press("Space");
  await expect(oneYear).toHaveAttribute("aria-checked", "false");
  await pressAndSettle(page, "Save prices");
  await expect(pricesSavedToast(page)).toBeVisible();

  const context = await browser.newContext({ baseURL, viewport: BUYER_PHONE });
  const buyer = await context.newPage();
  const errors = collectConsoleErrors(buyer);
  await buyer.goto(shareUrl);
  await hydrated(buyer);
  await choose(buyer, "term", "perpetual");
  await choose(buyer, "exclusive", "true");
  await expect(radio(buyer, "term", "m6")).toBeChecked();
  await expect(termMoved(buyer)).toHaveText(TERM_MOVED_TO_6_MONTHS);
  await expectNoBareDollar(buyer);
  await context.close();
  expect(errors).toEqual([]);
  expect(creatorErrors).toEqual([]);
});
