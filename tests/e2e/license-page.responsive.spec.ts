import { expect, test } from "@playwright/test";
import { LICENSE_PAGE_COPY } from "../../src/lib/licensing/license-page";
import { BADGE_COPY } from "../../src/lib/videos/ownership";
import { collectConsoleErrors } from "./helpers/console";
import { publishDemoVideo } from "./helpers/flows";
import {
  atEveryWidth,
  boxOf,
  expectAbove,
  expectLeftOf,
  expectNoHorizontalScroll,
  expectSheetForm,
  expectWithinCap,
  TIERS,
  tierAt,
} from "./helpers/layout";
import { pressLocator } from "./helpers/press";
import { cleanCreatedVideos } from "./helpers/videos";

// G.6 for the license page (P15; 05 §1.6 S01; 07 D145–D149, D153, D154) on all four projects, logged out at each
// project's own viewport (a fresh context, never buyLicense's 390 × 844 one): one 640 px column with the PriceBar fixed
// at the bottom below 1024 (its content in 640 on Tablet); from 1024 two columns in max-w-license (1056, not widened at
// XL) with the bar under the NavBar; Term 2 × 2 at every tier; "Your name" and "Email" side by side from 768; the badge
// explainer and Which countries? bottom sheets below 768 and dialogs from 768; the bar last in the DOM. On
// chromium-desktop at 1280 × 720 the sticky column fits under both bars and its last "View post" can be focused in view.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

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
  await expect(buyer.locator('input[name="timeZone"]')).not.toHaveValue("");

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
