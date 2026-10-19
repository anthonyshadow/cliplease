import { expect, type Locator, type Page } from "@playwright/test";
import { pressButton, pressLink } from "./press";

// The Demo connect as a creator does it, for the Connections and onboarding specs. (P10b's signUpCreator option
// connects the same way; this one starts from the page a test is on.)

export const CONNECTIONS = "/dashboard/connections";
const CONNECTED_TOAST = "Demo connected. Showing your latest videos.";
/** The callback's first sync (07 D13); a slow run can read "1 min ago". */
export const SYNC_LINE = /^Synced (just now|\d+ min ago) · 24 videos$/;

/**
 * Checks the Connect Demo link comes back to `returnTo`, follows it, waits for the toast back on that page, and checks
 * the ?connected= param is gone from the address afterwards (05 §6.2: it renders once).
 */
export async function linkDemoAccount(page: Page, returnTo: string) {
  await expect(
    page.getByRole("link", { name: "Connect Demo" }),
  ).toHaveAttribute(
    "href",
    `/api/connect/mock/start?returnTo=${encodeURIComponent(returnTo)}`,
  );
  await pressLink(page, "Connect Demo");
  const back = new URL(returnTo, "http://localhost");
  await page.waitForURL(
    (url) =>
      url.pathname === back.pathname &&
      [...back.searchParams].every(([k, v]) => url.searchParams.get(k) === v),
  );
  await expect(page.getByText(CONNECTED_TOAST, { exact: true })).toBeVisible();
  await expect
    .poll(() => new URL(page.url()).searchParams.has("connected"))
    .toBe(false);
}

/** The card of the account named `name` ("@demo.creator"). */
export const accountCard = (page: Page, name: string) =>
  page
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });

/** Opens the account's Disconnect sheet from its menu with the keyboard (04 §9.1: Enter, arrows), and returns it. */
export async function openDisconnectSheet(
  page: Page,
  name: string,
): Promise<Locator> {
  await pressButton(page, `More for ${name}`);
  await expect(
    page.getByRole("menuitem", { name: "Open in Library" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("menuitem", { name: "Disconnect…" }).press("Enter");
  const sheet = page.getByRole("alertdialog", { name: `Disconnect ${name}?` });
  await expect(sheet).toBeVisible();
  return sheet;
}
