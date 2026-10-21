import { expect, type Locator, type Page } from "@playwright/test";
import { pressButton, pressLink } from "./press";

// The Demo connect as a creator does it, for the Connections and onboarding specs. (P10b's signUpCreator option
// connects the same way; this one starts from the page a test is on.)

export const CONNECTIONS = "/dashboard/connections";
const CONNECTED_TOAST = "Demo connected. Showing your latest videos.";
/** The callback's first sync (07 D13); a slow run can read "1 min ago". */
export const SYNC_LINE = /^Synced (just now|\d+ min ago) · 24 videos$/;

/**
 * Checks the Connect Demo link comes back to `returnTo`, follows it, waits for the round trip to land back on that page
 * with ?connected= (the start, the callback's first sync, the redirect: as long as the test allows, not the 5 s of an
 * expect), then for the toast, and checks the param is gone from the address afterwards (05 §6.2: it renders once).
 */
export async function linkDemoAccount(page: Page, returnTo: string) {
  await expect(
    page.getByRole("link", { name: "Connect Demo" }),
  ).toHaveAttribute(
    "href",
    `/api/connect/mock/start?returnTo=${encodeURIComponent(returnTo)}`,
  );
  // The page is already on returnTo, so the wait matches only the return (it carries ?connected=). It starts before the
  // press, so a fast return whose param is already stripped again isn't missed.
  const back = new URL(returnTo, "http://localhost");
  const returned = page.waitForURL(
    (url) =>
      url.pathname === back.pathname &&
      url.searchParams.has("connected") &&
      [...back.searchParams].every(([k, v]) => url.searchParams.get(k) === v),
  );
  await pressLink(page, "Connect Demo");
  await returned;
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
