import { expect, type Page } from "@playwright/test";
import { EXCLUSIVE_COPY } from "../../../src/lib/pricing/exclusive-copy";

// The rate card editor (S21, 05 §6.9): its controls by their accessible names (owner answer Q-93).
export const PRICING = "/dashboard/pricing";

export const basePrice = (page: Page) =>
  page.getByRole("textbox", { name: "Base price", exact: true });

/** One option's row: a group named by the option's label, holding its switch, multiplier and example price. */
export const rateRow = (page: Page, label: string) =>
  page.getByRole("group", { name: label, exact: true });

export const optionSwitch = (page: Page, label: string) =>
  page.getByRole("switch", { name: label, exact: true });

export const multiplier = (page: Page, label: string) =>
  page.getByRole("textbox", { name: `${label} multiplier`, exact: true });

/** The row's example price ("CA$450.00"). */
export const examplePrice = (page: Page, label: string) =>
  rateRow(page, label).locator("p").last();

export const pricePreview = (page: Page) =>
  page.locator("[data-price-preview]");

/** The preview's quote line ("License … · You get …"), or "Too high for one payment.". */
export const previewLine = (page: Page) =>
  pricePreview(page).locator("p").first();

/** Picks a combination in the preview. */
export async function pickCombination(
  page: Page,
  use: string,
  term: string,
  territory: string,
) {
  const preview = pricePreview(page);
  await preview
    .getByRole("combobox", { name: "Use" })
    .selectOption({ label: use });
  await preview
    .getByRole("combobox", { name: "Term" })
    .selectOption({ label: term });
  await preview
    .getByRole("combobox", { name: "Territory" })
    .selectOption({ label: territory });
}

/** "License {price} · Buyer pays {total} (incl. {fee} service fee) · You get {price}" (07 D98). */
export const quoteLine = (price: string, total: string, fee: string) =>
  `License ${price} · Buyer pays ${total} (incl. ${fee} service fee) · You get ${price}`;

/** A save's toast; a second save inside its 4 s shows another, so the newest is the one read. */
export const latestToast = (page: Page, text: string) =>
  page.getByText(text, { exact: true }).last();

export const pricesSavedToast = (page: Page) =>
  latestToast(page, "Prices saved.");

/** The Exclusive licenses section (P19e; 04 §9.29, 07 D109): a group named by its legend. */
export const exclusiveSection = (page: Page) =>
  page.getByRole("group", { name: EXCLUSIVE_COPY.title, exact: true });

export const exclusiveSwitch = (page: Page) =>
  page.getByRole("switch", { name: EXCLUSIVE_COPY.offerSwitch, exact: true });

/** The premium's field, shown while the Switch is on. */
export const exclusivePremium = (page: Page) =>
  page.getByRole("textbox", { name: EXCLUSIVE_COPY.premiumLabel, exact: true });

/** The premium row's example price ("CA$450.00"). */
export const exclusiveExamplePrice = (page: Page) =>
  page.locator("[data-example-price]");

/** The preview's "Exclusive: …" line, while the offer is on. */
export const exclusiveLine = (page: Page) =>
  pricePreview(page).locator("[data-exclusive-line]");

/**
 * Sets the Switch by keyboard. Until the page has hydrated the Switch is a plain button and a Space is lost, so it is
 * pressed again, only while the Switch doesn't read `on` yet.
 */
export async function setExclusiveSwitch(page: Page, on: boolean) {
  const control = exclusiveSwitch(page);
  await expect(async () => {
    if ((await control.getAttribute("aria-checked")) !== String(on)) {
      await control.focus();
      await control.press("Space");
    }
    await expect(control).toHaveAttribute("aria-checked", String(on), {
      timeout: 1_000,
    });
  }).toPass({ timeout: 30_000 });
}
