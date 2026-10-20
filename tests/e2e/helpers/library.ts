import { expect, type Locator, type Page } from "@playwright/test";
import {
  accountCard,
  CONNECTIONS,
  linkDemoAccount,
  SYNC_LINE,
} from "./connections";
import { pressLink } from "./press";

// The Library (S12, 05 §6.1) as the P09 specs read it.

export const LIBRARY = "/dashboard/library";

/** The grid's tiles (04 §9.12). The loading skeleton's grid has no data-library-grid, so it never counts. */
export const tiles = (page: Page) =>
  page.locator("[data-library-grid] > [data-post-tile]");

/**
 * A tile's media + caption link: the one described by the meta line. The tile action ("Make licensable") is a sibling
 * link to the same place.
 */
export const tileLink = (tile: Locator) =>
  tile.locator(":scope > a[aria-describedby]");

/** A tile's caption: the <p> in its link. CSS clamps it to two lines; the DOM holds it whole. */
export const tileCaption = (tile: Locator) => tile.locator(":scope > a > p");

/** The current address's `name` param, or null. */
export const searchParam = (page: Page, name: string) =>
  new URL(page.url()).searchParams.get(name);

/**
 * Links Demo from Connections (going there first unless the page is on it), and a second Demo account with
 * "Connect another Demo account" when `accounts` is 2; waits for each card's first sync line.
 */
export async function connectDemo(
  page: Page,
  { accounts = 1 }: { accounts?: 1 | 2 } = {},
) {
  if (new URL(page.url()).pathname !== CONNECTIONS) {
    await page.goto(CONNECTIONS);
  }
  await linkDemoAccount(page, CONNECTIONS);
  await expect(
    accountCard(page, "@demo.creator").getByText(SYNC_LINE),
  ).toBeVisible();
  if (accounts === 2) {
    await pressLink(page, "Connect another Demo account");
    await expect(
      accountCard(page, "@demo.creator.2").getByText(SYNC_LINE),
    ).toBeVisible();
  }
}

/** Waits for the grid island's hydration: before it, Show more is a plain link to the next page (?cursor=). */
export async function waitForGridHydrated(page: Page) {
  await expect(
    page.locator("[data-hydrated]:has(> [data-library-grid])"),
  ).toHaveCount(1);
}

/**
 * Every tile has an <img> that loaded (naturalWidth > 0). They are lazy, so each one is scrolled into view first and
 * polled.
 */
export async function expectThumbnailsLoaded(page: Page) {
  const count = await tiles(page).count();
  const images = tiles(page).locator("img");
  await expect(images).toHaveCount(count);
  for (let i = 0; i < count; i += 1) {
    const image = images.nth(i);
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
  }
}
