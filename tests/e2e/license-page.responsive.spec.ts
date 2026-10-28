import { expect, type Locator, test } from "@playwright/test";
import { formatMoney } from "../../src/lib/format";
import { CHECKOUT_COPY } from "../../src/lib/licensing/checkout-copy";
import { LICENSE_PAGE_COPY } from "../../src/lib/licensing/license-page";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { BADGE_COPY } from "../../src/lib/videos/ownership";
import {
  chooseDemoSelection,
  FAKE_CHECKOUT_URL,
  fillDetails,
  holdServerActions,
  hydrated,
  openSuccessUrl,
  requestButton,
  requestDemoLicense,
  requestWithStaleTotal,
} from "./helpers/buyer";
import { collectConsoleErrors } from "./helpers/console";
import { publishDemoVideo } from "./helpers/flows";
import {
  atEveryWidth,
  boxOf,
  expectAbove,
  expectInside,
  expectLeftOf,
  expectNoHorizontalScroll,
  expectPageFrame,
  expectReadingColumn,
  expectReadingPage,
  expectSheetForm,
  expectTouchTarget,
  expectWithinCap,
  TIERS,
  tierAt,
} from "./helpers/layout";
import { pressAndSettle, pressLocator } from "./helpers/press";
import { cleanCreatedVideos } from "./helpers/videos";

// G.6 for the license page (P15; 05 §1.6 S01; 07 D145–D149, D153, D154) on all four projects, logged out at each
// project's own viewport (a fresh context, never buyLicense's 390 × 844 one): one 640 px column with the PriceBar fixed
// at the bottom below 1024 (its content in 640 on Tablet); from 1024 two columns in max-w-license (1056, not widened at
// XL) with the bar under the NavBar; Term 2 × 2 at every tier; "Your name" and "Email" side by side from 768; the badge
// explainer and Which countries? bottom sheets below 768 and dialogs from 768; the bar last in the DOM. On
// chromium-desktop at 1280 × 720 the sticky column fits under both bars and its last "View post" can be focused in view.
// P16a: a refusal's banner across the form's column, the pending button in its bar, and the fake checkout and /r as one
// centered reading column (07 D145, D148). P16b: the fake checkout's three buttons (Pay full width below 768), and /r
// finishing checkout and waiting for the creator, a handle long enough to need wrapping at 320 px.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

/** `box` spans `column` from edge to edge, within 1 px. */
async function expectFullWidth(box: Locator, column: Locator) {
  const [a, b] = await Promise.all([boxOf(box), boxOf(column)]);
  expect(Math.abs(a.left - b.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(a.right - b.right)).toBeLessThanOrEqual(1);
}

test("G.6, 07 D148: the license page at every tier, and its sticky column at 1280 × 720", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(600_000);
  const { shareUrl } = await publishDemoVideo(page);
  const context = await browser.newContext({ baseURL });
  const buyer = await context.newPage();
  const errors = collectConsoleErrors(buyer);
  await buyer.goto(shareUrl);
  await hydrated(buyer);

  const side = buyer.locator("[data-license-side]");
  const columns = side.locator("..");
  const bar = buyer.locator("[data-pricebar]");
  const barContent = bar.locator("[data-pricebar-content]");
  const useGroup = buyer.getByRole("group", { name: /^Use\./ });
  const terms = buyer
    .locator("[data-option-tile]")
    .filter({ has: buyer.locator('input[name="term"]') });
  const name = buyer.getByLabel("Your name", { exact: true });
  const email = buyer.getByLabel("Email", { exact: true });
  const explainer = buyer.getByRole("button", {
    name: BADGE_COPY.explainerLink,
  });
  const whichCountries = buyer.getByRole("button", {
    name: LICENSE_PAGE_COPY.whichCountries,
  });

  // Last in the DOM (05 §4.1 keyboard order): nothing focusable follows the bar, and the form it submits comes before it.
  expect(
    await bar.evaluate((el) => {
      const form = document.getElementById("license-form");
      const after = [
        ...document.querySelectorAll("a, button, input, select, textarea"),
      ].filter(
        (node) =>
          !el.contains(node) &&
          el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
      return {
        formBefore: Boolean(
          form &&
            form.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
        after: after.length,
      };
    }),
  ).toEqual({ formBefore: true, after: 0 });

  await atEveryWidth(buyer, testInfo, async ({ width, theme }) => {
    await expectNoHorizontalScroll(buyer);
    const innerHeight = await buyer.evaluate(() => window.innerHeight);
    const barBox = await boxOf(bar);
    if (width < TIERS.desktop) {
      await expectWithinCap(columns, 640);
      expect(Math.abs(barBox.bottom - innerHeight)).toBeLessThanOrEqual(1);
      if (tierAt(width) === "tablet") await expectWithinCap(barContent, 640);
      await expectAbove(side, useGroup);
    } else {
      await expect(columns).toHaveCSS("max-width", "1056px");
      await expectWithinCap(columns, 1056);
      await expectWithinCap(barContent, 1056);
      const navBox = await boxOf(buyer.getByRole("banner"));
      expect(Math.abs(barBox.top - navBox.bottom)).toBeLessThanOrEqual(1);
      await expectLeftOf(side.locator("img"), useGroup);
    }

    // Term: two rows of two at every tier (07 D146).
    await expect(terms).toHaveCount(4);
    const [first, second, third, fourth] = await Promise.all(
      [0, 1, 2, 3].map((index) => boxOf(terms.nth(index))),
    );
    expect(
      Math.abs((first?.top ?? 0) - (second?.top ?? 1)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((third?.top ?? 0) - (fourth?.top ?? 1)),
    ).toBeLessThanOrEqual(1);
    expect(first?.bottom ?? 1).toBeLessThanOrEqual(third?.top ?? 0);

    // "Your name" and "Email" side by side from 768, stacked below it.
    if (width >= TIERS.tablet) {
      const [a, b] = await Promise.all([boxOf(name), boxOf(email)]);
      expect(Math.abs(a.top - b.top)).toBeLessThanOrEqual(1);
      await expectLeftOf(name, email);
    } else {
      await expectAbove(name, email);
    }

    // The explainer and Which countries?: a bottom sheet below 768, a dialog from 768; Esc closes each and focus returns
    // (light only).
    if (theme === "dark") return;
    for (const [trigger, title] of [
      [explainer, BADGE_COPY.sheetTitle],
      [whichCountries, LICENSE_PAGE_COPY.whichCountries],
    ] as const) {
      await pressLocator(trigger);
      const sheet = buyer.getByRole("dialog", { name: title });
      await expectSheetForm(sheet, width);
      await buyer.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  });

  // 1280 × 720 (07 D148): stuck 24 px under both bars (48 + 56 + 24 = 128), capped at the window's height less 48, and
  // its last "View post" scrolls into view inside the column when focused, under neither bar (SC 2.4.11).
  if (testInfo.project.name === "chromium-desktop") {
    await buyer.setViewportSize({ width: 1280, height: 720 });
    await buyer.emulateMedia({ colorScheme: "light" });
    await buyer.evaluate(() => window.scrollTo(0, 400));
    // The cap is in svh, which Chromium recomputes a moment after a resize: wait for it rather than read it once.
    await expect
      .poll(async () => (await boxOf(side)).bottom)
      .toBeLessThanOrEqual(720 - 24 + 1);
    const column = await boxOf(side);
    const contentHeight = await side.evaluate((el) => el.scrollHeight);
    expect(Math.abs(column.top - 128)).toBeLessThanOrEqual(1);
    const lastPost = side.getByRole("link", { name: /^View post on / }).last();
    await lastPost.focus();
    await expect(lastPost).toBeFocused();
    const [link, barBox] = await Promise.all([boxOf(lastPost), boxOf(bar)]);
    expect(link.top).toBeGreaterThanOrEqual(barBox.bottom);
    expect(link.bottom).toBeLessThanOrEqual(column.bottom + 1);
    const measured = `top ${column.top} px, bottom ${column.bottom} px, ${column.bottom - column.top} px tall, content ${contentHeight} px`;
    testInfo.annotations.push({
      type: "Sticky column at 1280 × 720",
      description: measured,
    });
    console.log(`P15 sticky column at 1280 × 720: ${measured}`);
  }

  await context.close();
  expect(errors).toEqual([]);
});

test("G.6, 07 D145, D148: the license page's banner and pending states, the fake checkout and /r at every tier", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(600_000);
  const { shareUrl } = await publishDemoVideo(page);
  const context = await browser.newContext({ baseURL });
  const buyer = await context.newPage();
  const errors = collectConsoleErrors(buyer);
  await buyer.goto(shareUrl);
  await hydrated(buyer);
  await chooseDemoSelection(buyer);
  await fillDetails(buyer);
  const terms = buyer.getByRole("checkbox");
  await terms.focus();
  await terms.press("Space");
  const bar = buyer.locator("[data-pricebar]");
  const button = requestButton(buyer);

  // A refusal's banner sits above "Your details" across the form's column (a total the server didn't quote).
  await requestWithStaleTotal(buyer);
  const notice = buyer.locator("[data-license-notice]");
  await expect(notice).toBeVisible();
  await atEveryWidth(buyer, testInfo, async () => {
    await expectNoHorizontalScroll(buyer);
    await expectFullWidth(notice, notice.locator(".."));
  });

  // Pending: "Starting checkout…" keeps P15's placement, at the bottom below 1024 and under the NavBar from 1024.
  const release = await holdServerActions(buyer);
  await pressLocator(button);
  await expect(button).toHaveAttribute("aria-busy", "true");
  await atEveryWidth(buyer, testInfo, async ({ width }) => {
    await expectNoHorizontalScroll(buyer);
    await expectInside(button, bar);
    const barBox = await boxOf(bar);
    if (width < TIERS.desktop) {
      const innerHeight = await buyer.evaluate(() => window.innerHeight);
      expect(Math.abs(barBox.bottom - innerHeight)).toBeLessThanOrEqual(1);
    } else {
      const navBox = await boxOf(buyer.getByRole("banner"));
      expect(Math.abs(barBox.top - navBox.bottom)).toBeLessThanOrEqual(1);
    }
  });
  await release();

  // The fake checkout: no NavBar, one centered reading column, its warning across it.
  await buyer.waitForURL(FAKE_CHECKOUT_URL);
  const column = buyer.locator("main .max-w-reading");
  const cancel = buyer.getByRole("button", { name: CHECKOUT_COPY.cancel });
  await atEveryWidth(buyer, testInfo, async ({ width }) => {
    await expectPageFrame(buyer, width, { banner: false });
    await expectReadingColumn(buyer);
    await expectFullWidth(column.locator(":scope > :first-child"), column);
    await expectTouchTarget(cancel);
  });

  // /r: the public NavBar and one centered reading column.
  await pressAndSettle(buyer, CHECKOUT_COPY.cancel);
  await expect(buyer).toHaveURL(/&checkout=canceled$/);
  await atEveryWidth(buyer, testInfo, ({ width }) =>
    expectReadingPage(buyer, width),
  );

  await context.close();
  expect(errors).toEqual([]);
});

test("G.6, 07 D145, D149: the fake checkout's three buttons, and /r finishing checkout and waiting, at every tier", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.setTimeout(600_000);
  const { shareUrl, handle } = await publishDemoVideo(page);
  const context = await browser.newContext({ baseURL });
  const buyer = await context.newPage();
  const errors = collectConsoleErrors(buyer);
  const requestId = await requestDemoLicense(buyer, shareUrl);
  const checkoutUrl = buyer.url();

  // Pay, Cancel and Let it expire in the column, one under another, each a 44 px target; Pay spans it below 768.
  const column = buyer.locator("main .max-w-reading");
  const button = (name: string) => buyer.getByRole("button", { name });
  const pay = button(CHECKOUT_COPY.pay(formatMoney(173250, "cad")));
  const cancel = button(CHECKOUT_COPY.cancel);
  const expire = button(CHECKOUT_COPY.letItExpire);
  await atEveryWidth(buyer, testInfo, async ({ width }) => {
    await expectPageFrame(buyer, width, { banner: false });
    await expectReadingColumn(buyer);
    for (const control of [pay, cancel, expire]) {
      await expectTouchTarget(control);
      await expectInside(control, column);
    }
    await expectAbove(pay, cancel);
    await expectAbove(cancel, expire);
    if (width < TIERS.tablet) {
      await expectFullWidth(pay, column);
    } else {
      const [own, outer] = await Promise.all([boxOf(pay), boxOf(column)]);
      expect(own.right - own.left).toBeLessThan(outer.right - outer.left);
    }
  });

  // Finishing checkout (Stripe's success URL before its event): the spinner's heading in the reading column.
  await openSuccessUrl(buyer, requestId);
  const heading = buyer.getByRole("heading", { level: 1 });
  await expect(heading).toHaveAccessibleName(
    REQUEST_STATUS_COPY.finishingTitle,
  );
  await atEveryWidth(buyer, testInfo, ({ width }) =>
    expectReadingPage(buyer, width),
  );
  // It stops checking 30 s after it opened, the body in the spinner's place: leaving earlier could cut a refresh off.
  await expect(
    buyer.getByText(REQUEST_STATUS_COPY.finishingBody, { exact: true }),
  ).toBeVisible({ timeout: 35_000 });
  await expect(heading.locator("svg")).toHaveCount(0);

  // Waiting for @handle, its deadline shown: the handle wraps rather than push the page sideways.
  await buyer.goto(checkoutUrl);
  await pressAndSettle(buyer, CHECKOUT_COPY.pay(formatMoney(173250, "cad")));
  await expect(heading).toHaveAccessibleName(
    REQUEST_STATUS_COPY.waitingTitle(handle),
  );
  await expect(buyer.getByText(/^Your card has a hold of /)).toContainText(
    "has until",
  );
  await atEveryWidth(buyer, testInfo, async ({ width }) => {
    await expectReadingPage(buyer, width);
    await expectInside(heading, buyer.locator("main .max-w-reading").first());
  });

  await context.close();
  expect(errors).toEqual([]);
});
