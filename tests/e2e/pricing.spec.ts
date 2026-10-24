import { expect, type Page, test } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  basePrice,
  examplePrice,
  multiplier,
  optionSwitch,
  PRICING,
  pickCombination,
  previewLine,
  pricePreview,
  quoteLine,
} from "./helpers/pricing";
import { leaveIsGuarded } from "./helpers/videos";

// J4 (01 J4.1–J4.6, J4.9, J4.10; 05 §6.9): the rate card editor on a new creator's J4.1 card. Every amount comes from
// the same computeQuote the server runs; the copy is 05 §6.9's and owner answers Q-91–Q-93.

/** Leaving with unsaved edits may ask first (the beforeunload guard): the test always leaves. */
function acceptLeaving(page: Page) {
  page.on("dialog", (dialog) => void dialog.accept());
}

async function openPricing(page: Page) {
  await page.goto(PRICING);
  await expect(basePrice(page)).toBeVisible();
}

test("J4: the default card, the live preview with the CA$2.00 floor, Save, then Reset to defaults", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  await openPricing(page);

  // J4.1: CA$150 and the presets, all on, in CAD; the example prices pair each option with the first of the others.
  await expect(
    page.getByText("Your prices are in Canadian dollars (CAD).", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(basePrice(page)).toHaveValue("150");
  await expect(
    page.getByText("CA$10 to CA$10,000. New requests only."),
  ).toBeVisible();
  await expect(multiplier(page, "Paid social ads")).toHaveValue("3.00");
  await expect(examplePrice(page, "Paid social ads")).toHaveText("CA$450.00");
  await expect(examplePrice(page, "1 year")).toHaveText("CA$300.00");
  await expect(examplePrice(page, "Worldwide")).toHaveText("CA$262.50");
  for (const label of ["Organic social repost", "Perpetual", "One region"]) {
    await expect(optionSwitch(page, label)).toBeChecked();
  }

  // J4.4: the preview, then a change of base and multiplier without a reload.
  await pickCombination(page, "Paid social ads", "1 year", "Worldwide");
  await expect(previewLine(page)).toHaveText(
    quoteLine("CA$1,575.00", "CA$1,732.50", "CA$157.50"),
  );
  await expect(
    pricePreview(page).getByText("Service fee (10%, at least CA$2.00)"),
  ).toBeVisible();
  await pickCombination(page, "TV / broadcast", "Perpetual", "Worldwide");
  await expect(previewLine(page)).toContainText("Buyer pays CA$4,331.25");
  await pickCombination(page, "Paid social ads", "1 year", "Worldwide");
  await basePrice(page).fill("200");
  await multiplier(page, "Paid social ads").fill("3.50");
  await expect(previewLine(page)).toHaveText(
    quoteLine("CA$2,450.00", "CA$2,695.00", "CA$245.00"),
  );
  await expect(examplePrice(page, "Paid social ads")).toHaveText("CA$700.00");

  // The fee floor (07 D79): a CA$10.00 license pays CA$2.00.
  await basePrice(page).fill("10");
  await pickCombination(
    page,
    "Organic social repost",
    "30 days",
    "One country",
  );
  await expect(previewLine(page)).toHaveText(
    quoteLine("CA$10.00", "CA$12.00", "CA$2.00"),
  );

  // J4.6: Save, then the card survives a reload.
  await optionSwitch(page, "Perpetual").click();
  await multiplier(page, "One region").fill("1.40");
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.getByText("Prices saved.", { exact: true })).toBeVisible();
  await openPricing(page);
  await expect(basePrice(page)).toHaveValue("10");
  await expect(multiplier(page, "Paid social ads")).toHaveValue("3.50");
  await expect(multiplier(page, "One region")).toHaveValue("1.40");
  await expect(optionSwitch(page, "Perpetual")).not.toBeChecked();

  // J4.10: Reset to defaults asks, saves at once, and the J4.1 card is back after a reload.
  await page.getByRole("button", { name: "Reset to defaults" }).click();
  const sheet = page.getByRole("alertdialog", {
    name: "Reset prices to defaults?",
  });
  await expect(
    sheet.getByText(
      "Your base price goes back to CA$150 and every option to its default, switched on. New requests only.",
    ),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Reset prices" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Prices saved.", { exact: true })).toBeVisible();
  await expect(basePrice(page)).toHaveValue("150");
  await openPricing(page);
  await expect(basePrice(page)).toHaveValue("150");
  await expect(multiplier(page, "Paid social ads")).toHaveValue("3.00");
  await expect(multiplier(page, "One region")).toHaveValue("1.30");
  await expect(optionSwitch(page, "Perpetual")).toBeChecked();
  expect(errors).toEqual([]);
});

test("J4.2, J4.3, J4.5: field errors on Save, a group kept on, a switched-off use, and the payment cap", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  acceptLeaving(page);
  await signUpCreator(page, { payouts: false });
  await openPricing(page);
  const save = page.getByRole("button", { name: "Save prices" });

  // J4.2, J4.3: Save names every field out of bounds and moves the focus to the first one.
  await basePrice(page).fill("9");
  await multiplier(page, "6 months").fill("1.234");
  await multiplier(page, "1 year").fill("10.05");
  await save.click();
  await expect(page.getByText("Minimum is CA$10.")).toBeVisible();
  await expect(page.getByText("Use steps of 0.05.")).toBeVisible();
  await expect(page.getByText("Maximum is ×10.00.")).toBeVisible();
  await expect(basePrice(page)).toBeFocused();
  await basePrice(page).fill("90");
  await expect(page.getByText("Minimum is CA$10.")).toBeHidden();

  // Nothing was saved: the unsaved edits make leaving ask first, and the card is unchanged after it.
  expect(await leaveIsGuarded(page)).toBe(true);
  await openPricing(page);
  await expect(basePrice(page)).toHaveValue("150");
  await expect(multiplier(page, "1 year")).toHaveValue("2.00");

  // J4.3: one option per group stays on.
  for (const term of ["30 days", "6 months", "1 year", "Perpetual"]) {
    await optionSwitch(page, term).click();
  }
  await save.click();
  await expect(page.getByText("Keep at least one term.")).toBeVisible();
  await expect(optionSwitch(page, "30 days")).toBeFocused();
  await optionSwitch(page, "1 year").click();
  await expect(page.getByText("Keep at least one term.")).toBeHidden();

  // A use switched off is saved and leaves the preview's choices.
  await optionSwitch(page, "TV / broadcast").click();
  await save.click();
  await expect(page.getByText("Prices saved.", { exact: true })).toBeVisible();
  expect(await leaveIsGuarded(page)).toBe(false);
  await openPricing(page);
  await expect(optionSwitch(page, "TV / broadcast")).not.toBeChecked();
  await expect(optionSwitch(page, "30 days")).not.toBeChecked();
  // The example pairs an option with the first option on in each other group: 1 year (×2.00), not 30 days.
  await expect(examplePrice(page, "Paid social ads")).toHaveText("CA$900.00");
  await expect(
    pricePreview(page).getByRole("combobox", { name: "Use" }).locator("option"),
  ).toHaveText(["Organic social repost", "Paid social ads"]);

  // J4.5: over CA$999,999.99 the preview says so.
  await optionSwitch(page, "TV / broadcast").click();
  await optionSwitch(page, "Perpetual").click();
  await basePrice(page).fill("10000");
  await multiplier(page, "TV / broadcast").fill("10.00");
  await multiplier(page, "Perpetual").fill("10.00");
  await pickCombination(page, "TV / broadcast", "Perpetual", "Worldwide");
  await expect(previewLine(page)).toHaveText("Too high for one payment.");
  expect(errors).toEqual([]);
});
