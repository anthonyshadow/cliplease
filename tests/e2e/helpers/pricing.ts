import type { Page } from "@playwright/test";

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
