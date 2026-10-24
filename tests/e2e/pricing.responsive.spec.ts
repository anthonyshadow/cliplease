import { expect, test } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  atEveryWidth,
  boxOf,
  expectAbove,
  expectCreatorChrome,
  expectLeftOf,
  expectPageFrame,
  expectSheetForm,
  expectTouchTarget,
  expectWithinCap,
  TIERS,
} from "./helpers/layout";
import {
  basePrice,
  optionSwitch,
  PRICING,
  pricePreview,
  rateRow,
} from "./helpers/pricing";

// G.6 for Pricing (S21, 05 §6.9 and §1.6; 04 §9.29; 07 D146, D153, D154) on all four projects: one centered 640 px
// column below 1024 with the preview after the last row; from 1024 the rows on the left and the preview on the right,
// sticky clear of the NavBar; the Reset sheet's form per tier.
test.use({ reducedMotion: "reduce" });

test("G.6: Pricing is one centered 640 px column below 1024 and two columns from 1024, the preview clear of the NavBar", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  await page.goto(PRICING);
  await expect(basePrice(page)).toBeVisible();
  const lastRow = rateRow(page, "Worldwide");
  const preview = pricePreview(page);
  const save = page.getByRole("button", { name: "Save prices" });
  const reset = page.getByRole("button", { name: "Reset to defaults" });

  await atEveryWidth(page, testInfo, async ({ width }) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectPageFrame(page, width, { banner: true });
    await expectCreatorChrome(page, width);
    for (const control of [
      optionSwitch(page, "Paid social ads"),
      save,
      reset,
    ]) {
      await expectTouchTarget(control);
    }
    if (width < TIERS.desktop) {
      await expectWithinCap(page.locator("main form"), 640);
      await expectAbove(lastRow, preview);
      await expectAbove(preview, save);
    } else {
      await expectLeftOf(lastRow, preview);
      // Scrolled to the end, the sticky preview stays 24 px under the NavBar.
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      const [banner, card] = await Promise.all([
        boxOf(page.getByRole("banner")),
        boxOf(preview),
      ]);
      expect(card.top).toBeGreaterThanOrEqual(banner.bottom + 23);
    }

    // Reset to defaults: a bottom sheet below md, a centered dialog from md; Esc keeps the prices.
    await reset.click();
    const sheet = page.getByRole("alertdialog", {
      name: "Reset prices to defaults?",
    });
    await expectSheetForm(sheet, width);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(reset).toBeFocused();
  });
  await expect(basePrice(page)).toHaveValue("150");
  expect(errors).toEqual([]);
});
