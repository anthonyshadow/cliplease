import { type Browser, expect, type Page, test } from "@playwright/test";
import { AVAILABILITY_COPY } from "../../src/lib/licensing/availability";
import { CHECKOUT_COPY } from "../../src/lib/licensing/checkout-copy";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import {
  availabilityNotice,
  BUYER_PHONE,
  FAKE_CHECKOUT_URL,
  hydrated,
  type LicenseChoice,
  payButton,
  radio,
  requestDemoLicense,
  requestLicense,
} from "./helpers/buyer";
import {
  backToLicense,
  checkoutTimes,
  extendButton,
  hideTabFor,
  holdClock,
  holdLine,
  holdReady,
  leaveCheckout,
  resyncCheckout,
  setCheckoutTimes,
} from "./helpers/checkout-hold";
import { collectConsoleErrors } from "./helpers/console";
import { offerExclusive, publishDemoVideo } from "./helpers/flows";
import { expectNoBareDollar } from "./helpers/layout";
import {
  isRouterRefresh,
  pressAndSettle,
  pressLocator,
  requestEnded,
  waitInPage,
} from "./helpers/press";
import { cleanCreatedVideos } from "./helpers/videos";

// The unpaid hold (P19f; owner answers Q-170, Q-175, Q-176; AD-74) on chromium-desktop and webkit-iphone. The fake checkout
// shows the clock at all times; in the last minute it warns and offers Extend, and from zero Pay goes until the buyer
// extends, up to the 60-minute session. Someone else can take a lapsed video, and Extend then says so. Leaving a running
// hold lets it go, for that buyer only, and coming back takes it again; Back from /r and a reload of a lapsed page stay
// lapsed until a press. Each test moves the row's times on the database's clock and has the page read them again
// (helpers/checkout-hold.ts). Each has its own creator; no exclusive request is approved, and auto-approve stays off.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const CHOICE = {
  use: "paid_social",
  term: "y1",
  territory: "worldwide",
} as const satisfies LicenseChoice;
const EXCLUSIVE_CHOICE = { ...CHOICE, exclusive: true } as const;

/** A fresh logged-out buyer at 390 × 844, its console watched; the caller closes the context. */
async function newBuyer(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, viewport: BUYER_PHONE });
  const page = await context.newPage();
  return { context, page, errors: collectConsoleErrors(page) };
}

/**
 * Polls with a reload until `check` holds: an open page has no way to learn of another buyer's hold by itself, and this
 * doesn't wait on the refresh a reserved page runs on its own.
 */
const whenReloaded = (page: Page, check: () => Promise<void>) =>
  expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 20_000 });

/** The other visitor reloads until the video is open again. */
const expectOpen = (visitor: Page) =>
  whenReloaded(visitor, () =>
    expect(availabilityNotice(visitor)).toHaveCount(0, { timeout: 1_000 }),
  );

/** The other visitor reloads until the video is reserved again. */
const expectReserved = (visitor: Page) =>
  whenReloaded(visitor, () =>
    expect(availabilityNotice(visitor)).toBeVisible({ timeout: 1_000 }),
  );

/** Cancel and Let it expire stay, whatever the clock says (owner answer Q-176). */
async function expectWayOut(page: Page) {
  for (const name of [CHECKOUT_COPY.cancel, CHECKOUT_COPY.letItExpire]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
}

/** The hold reads a fresh ten minutes, polled: a return extends it after the page shows. */
const expectFreshHold = (requestId: string) =>
  expect
    .poll(async () => (await checkoutTimes(requestId)).holdSecondsLeft)
    .toBeGreaterThan(590);

test("Q-170, Q-176: the clock runs on the fake checkout, warns and offers Extend in its last minute, takes Pay away at zero until Extend, and stops offering Extend at the session's 60 minutes", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(240_000);
  const creatorErrors = collectConsoleErrors(page);
  const { handle, shareUrl } = await publishDemoVideo(page);
  const first = await newBuyer(browser, baseURL);
  const buyer = first.page;
  const id = await requestDemoLicense(buyer, shareUrl);

  // A fresh ten minutes, Pay under it, nothing to extend yet.
  await expect(holdClock(buyer)).toHaveText(
    /^Reserved for you · (10:00|9:\d\d)$/,
  );
  await expect(payButton(buyer)).toBeVisible();
  await expect(extendButton(buyer)).toHaveCount(0);

  // The last minute: the warning and Extend, with Pay still there.
  await setCheckoutTimes(id, { holdInSeconds: 50 });
  await resyncCheckout(buyer);
  await expect(holdLine(buyer, CHECKOUT_COPY.holdEnding)).toBeVisible();
  await expect(extendButton(buyer)).toBeVisible();
  await expect(payButton(buyer)).toBeVisible();

  // Extend adds ten minutes to what was left.
  await pressAndSettle(buyer, CHECKOUT_COPY.holdExtend);
  await expect(holdClock(buyer)).toHaveText(/^Reserved for you · 10:[2-5]\d$/);
  await expect(extendButton(buyer)).toHaveCount(0);
  await expect(payButton(buyer)).toBeVisible();
  // The pressed button is gone: the focus lands on Pay (AD-74 e).
  await expect(payButton(buyer)).toBeFocused();
  await expectNoBareDollar(buyer);
  const extended = await checkoutTimes(id);
  expect(extended.holdSecondsLeft).toBeGreaterThan(600);
  expect(extended.holdSecondsLeft).toBeLessThanOrEqual(650);

  // Past zero: no Pay until Extend, whose ten minutes count from now.
  await setCheckoutTimes(id, { holdInSeconds: -1 });
  await resyncCheckout(buyer);
  await expect(payButton(buyer)).toHaveCount(0);
  await expect(extendButton(buyer)).toBeVisible();
  await expect(holdLine(buyer, CHECKOUT_COPY.holdEnded)).toBeVisible();
  await expectWayOut(buyer);
  await expectNoBareDollar(buyer);
  await pressAndSettle(buyer, CHECKOUT_COPY.holdExtend);
  await expect(payButton(buyer)).toBeVisible();
  const fresh = await checkoutTimes(id);
  expect(fresh.holdSecondsLeft).toBeGreaterThan(590);
  expect(fresh.holdSecondsLeft).toBeLessThanOrEqual(600);

  // Switching to another app frees nothing: only leaving does.
  await hideTabFor(buyer, 1_000);
  expect((await checkoutTimes(id)).holdUntil).toBe(fresh.holdUntil);

  // The tick alone takes Pay away at zero.
  await setCheckoutTimes(id, { holdInSeconds: 3 });
  await resyncCheckout(buyer);
  await expect(payButton(buyer)).toHaveCount(0, { timeout: 10_000 });
  await expect(extendButton(buyer)).toBeVisible();

  // Extended again, it pays as usual.
  await pressAndSettle(buyer, CHECKOUT_COPY.holdExtend);
  await pressLocator(payButton(buyer));
  await expect(buyer.getByRole("heading", { level: 1 })).toHaveText(
    REQUEST_STATUS_COPY.waitingTitle(handle),
  );
  await first.context.close();
  expect(first.errors).toEqual([]);

  // The next request, on the same video.
  const next = await newBuyer(browser, baseURL);
  const second = next.page;
  const secondId = await requestDemoLicense(second, shareUrl);

  // In a window too short for the whole page, the clock stays in view from top to bottom.
  if (testInfo.project.name === "chromium-desktop") {
    await second.setViewportSize({ width: 390, height: 300 });
    await expect(holdClock(second)).toBeInViewport();
    await second.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    expect(await second.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await expect(holdClock(second)).toBeInViewport();
    await second.setViewportSize(BUYER_PHONE);
  }

  // The session's last minute: the warning, and no Extend past the cap.
  await setCheckoutTimes(secondId, { holdInSeconds: 30, sessionInSeconds: 30 });
  await resyncCheckout(second);
  await expect(holdLine(second, CHECKOUT_COPY.holdEnding)).toBeVisible();
  await expect(extendButton(second)).toHaveCount(0);

  // The session over: the way back, no Pay and no Extend.
  await setCheckoutTimes(secondId, {
    holdInSeconds: -1,
    sessionInSeconds: -1,
  });
  await resyncCheckout(second);
  await expect(holdLine(second, CHECKOUT_COPY.sessionEnded)).toBeVisible();
  await expect(backToLicense(second)).toBeVisible();
  await expect(payButton(second)).toHaveCount(0);
  await expect(extendButton(second)).toHaveCount(0);
  await expectWayOut(second);
  await expectNoBareDollar(second);
  await next.context.close();
  expect(next.errors).toEqual([]);
  expect(creatorErrors).toEqual([]);
});

test("Q-170: past zero someone else can take the video: Extend says so, nothing was charged, and the buyer's link reads reserved", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const creatorErrors = collectConsoleErrors(page);
  const { shareUrl } = await publishDemoVideo(page);
  await offerExclusive(page);

  const buyerA = await newBuyer(browser, baseURL);
  const a = buyerA.page;
  const idA = await requestLicense(a, shareUrl, EXCLUSIVE_CHOICE);
  await setCheckoutTimes(idA, { holdInSeconds: -1 });
  await resyncCheckout(a);

  // The lapsed hold holds nothing: B sees no notice and reaches the fake checkout.
  const buyerB = await newBuyer(browser, baseURL);
  const b = buyerB.page;
  await b.goto(shareUrl);
  await hydrated(b);
  await expect(availabilityNotice(b)).toHaveCount(0);
  await requestLicense(b, shareUrl, EXCLUSIVE_CHOICE);

  await pressAndSettle(a, CHECKOUT_COPY.holdExtend);
  await expect(holdLine(a, CHECKOUT_COPY.holdTaken)).toBeVisible();
  await expect(backToLicense(a)).toBeFocused();
  await expect(payButton(a)).toHaveCount(0);
  await expect(extendButton(a)).toHaveCount(0);
  await expect(holdClock(a)).toHaveCount(0);
  await expectNoBareDollar(a);

  await pressLocator(backToLicense(a));
  await a.waitForURL(/\/@/);
  await expect(availabilityNotice(a)).toBeVisible();

  await buyerB.context.close();
  await buyerA.context.close();
  expect(buyerA.errors).toEqual([]);
  expect(buyerB.errors).toEqual([]);
  expect(creatorErrors).toEqual([]);
});

test("Q-175, AD-74: leaving a running hold frees the video and coming back takes it again, by Back, Forward, a reload or a navigation; Cancel frees it too, and a lapsed page stays lapsed until a press", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const creatorErrors = collectConsoleErrors(page);
  const { shareUrl } = await publishDemoVideo(page);
  await offerExclusive(page);

  const buyerA = await newBuyer(browser, baseURL);
  const a = buyerA.page;
  const id = await requestLicense(a, shareUrl, EXCLUSIVE_CHOICE);
  await holdReady(a);

  const buyerB = await newBuyer(browser, baseURL);
  const b = buyerB.page;
  await b.goto(shareUrl);
  await expectReserved(b);

  // Back: a client traversal, which fires no pagehide.
  await a.goBack();
  await a.waitForURL(/\/@/);
  await expectOpen(b);

  // Forward: the same request, held again.
  await a.goForward();
  await a.waitForURL(FAKE_CHECKOUT_URL);
  await expect(holdClock(a)).toBeVisible();
  await expect(payButton(a)).toBeVisible();
  await expectFreshHold(id);
  await expectReserved(b);

  // A reload releases and re-holds: a new value, however close to the old.
  const before = (await checkoutTimes(id)).holdUntil;
  await a.reload();
  await holdReady(a);
  await expect
    .poll(async () => {
      const times = await checkoutTimes(id);
      return times.holdUntil !== before && times.holdSecondsLeft > 590;
    })
    .toBe(true);
  await expect(payButton(a)).toBeVisible();
  await expect(holdClock(a)).toBeVisible();
  await expectReserved(b);

  // Navigating away frees it, as closing does; Back takes it again.
  await leaveCheckout(a);
  await expectOpen(b);
  await a.goBack();
  await holdReady(a);
  await expect(payButton(a)).toBeVisible();
  await expect(holdClock(a)).toBeVisible();
  await expectFreshHold(id);
  await expectReserved(b);

  // Cancel goes through /r, which frees it.
  await pressAndSettle(a, CHECKOUT_COPY.cancel);
  await expect(
    a.getByRole("heading", {
      level: 1,
      name: REQUEST_STATUS_COPY.canceledTitle,
    }),
  ).toBeVisible();
  await expectOpen(b);

  // Back from /r: the router's cached page reads the row again, and it is lapsed.
  const refreshed = requestEnded(a, isRouterRefresh);
  await a.goBack();
  await refreshed;
  await expect(payButton(a)).toHaveCount(0);
  await expect(extendButton(a)).toBeVisible();

  // A reload of a lapsed page takes nothing back without a press (AD-74 h).
  const lapsed = (await checkoutTimes(id)).holdUntil;
  await a.reload();
  await holdReady(a);
  await waitInPage(a, 1_000);
  await expect(payButton(a)).toHaveCount(0);
  await expect(extendButton(a)).toBeVisible();
  expect((await checkoutTimes(id)).holdUntil).toBe(lapsed);

  await pressAndSettle(a, CHECKOUT_COPY.holdExtend);
  await expect(payButton(a)).toBeVisible();

  await buyerB.context.close();
  await buyerA.context.close();
  expect(buyerA.errors).toEqual([]);
  expect(buyerB.errors).toEqual([]);
  expect(creatorErrors).toEqual([]);
});

test("Q-175: the buyer who goes from a running hold to the license page lands on their own reservation, and the page opens by itself, with no reload", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const creatorErrors = collectConsoleErrors(page);
  const { shareUrl } = await publishDemoVideo(page);
  await offerExclusive(page);

  const buyer = await newBuyer(browser, baseURL);
  const a = buyer.page;
  await requestLicense(a, shareUrl, EXCLUSIVE_CHOICE);
  await holdReady(a);

  // pagehide fires once the new document's response is in, so that document was read before the release.
  const arrival = await a.goto(shareUrl);
  expect(await arrival?.text()).toContain(
    AVAILABILITY_COPY.notice.reservedTitle,
  );
  await expect(availabilityNotice(a)).toHaveCount(0, { timeout: 10_000 });
  await expect(radio(a, "exclusive", "true")).toBeEnabled();

  await buyer.context.close();
  expect(buyer.errors).toEqual([]);
  expect(creatorErrors).toEqual([]);
});

test("Q-175: leaving frees that buyer's hold and nobody else's: the other buyer's clock and Pay stay, and only when both have left can Exclusive be chosen", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const creatorErrors = collectConsoleErrors(page);
  const { shareUrl } = await publishDemoVideo(page);
  await offerExclusive(page);

  const buyerA = await newBuyer(browser, baseURL);
  const idA = await requestDemoLicense(buyerA.page, shareUrl);
  const buyerC = await newBuyer(browser, baseURL);
  const c = buyerC.page;
  const idC = await requestDemoLicense(c, shareUrl);
  const before = await checkoutTimes(idC);

  await leaveCheckout(buyerA.page);
  await expect
    .poll(async () => (await checkoutTimes(idA)).holdSecondsLeft)
    .toBeLessThanOrEqual(0);
  expect((await checkoutTimes(idC)).holdUntil).toBe(before.holdUntil);
  await expect(payButton(c)).toBeVisible();
  await expect(holdClock(c)).toBeVisible();

  // C still holds a standard request, so a visitor can't choose Exclusive.
  const visitor = await newBuyer(browser, baseURL);
  const exclusive = radio(visitor.page, "exclusive", "true");
  await visitor.page.goto(shareUrl);
  await hydrated(visitor.page);
  await expect(exclusive).toBeDisabled();

  await leaveCheckout(c);
  await whenReloaded(visitor.page, () =>
    expect(exclusive).toBeEnabled({ timeout: 1_000 }),
  );

  await visitor.context.close();
  await buyerC.context.close();
  await buyerA.context.close();
  expect(buyerA.errors).toEqual([]);
  expect(buyerC.errors).toEqual([]);
  expect(visitor.errors).toEqual([]);
  expect(creatorErrors).toEqual([]);
});
