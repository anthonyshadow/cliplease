import { expect, type Page, test } from "@playwright/test";
import { REQUESTS_SETTINGS_COPY } from "../../src/lib/payouts";
import { accountCard, linkDemoAccount, SYNC_LINE } from "./helpers/connections";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator, uniqueLongHandle } from "./helpers/creator";
import {
  atEveryWidth,
  boxOf,
  expectCreatorChrome,
  expectInside,
  expectPageFrame,
  expectReadingPage,
  expectSettingsColumn,
  expectTouchTarget,
  TIERS,
} from "./helpers/layout";
import { pressAndSettleIn, pressLocator } from "./helpers/press";

// G.6 for P05's and P06's pages (07 D154), on all four projects: each test signs up its own creator with signUpCreator.
// The profile step stays in responsive.spec.ts (its /onboarding route lands on ?step=profile); Connections has its own
// connections.responsive.spec.ts (P08).
test.use({ reducedMotion: "reduce" });

// 43 characters, no break opportunity.
const LONG_NAME = "Dailylaughsproductionsandfriendsofthestudio";

/**
 * Below lg, the TabBar tells assistive tech where the page is, not only with color and the 2 px bar: the current tab's
 * link is aria-current="page", or, for a page in the More sheet, the More tab is aria-current="true" and the sheet's
 * row for the page is aria-current="page".
 */
async function expectTabBarCurrent(
  page: Page,
  current: string,
  { inMoreSheet }: { inMoreSheet: boolean },
) {
  const tabBar = page.locator("[data-tabbar]");
  await expect(tabBar.locator("[aria-current]")).toHaveCount(1);
  if (!inMoreSheet) {
    await expect(
      tabBar.getByRole("link", { name: current, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    return;
  }
  const more = tabBar.getByRole("button", { name: "More", exact: true });
  await expect(more).toHaveAttribute("aria-current", "true");
  await pressLocator(more);
  const sheet = page.getByRole("dialog", { name: "More" });
  await expect(
    sheet.getByRole("link", { name: current, exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(sheet.locator("[aria-current]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
}

test("G.6: the connect and payouts steps keep one centered 640 px column at every tier", async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  for (const step of ["connect", "payouts"]) {
    await page.goto(`/onboarding?step=${step}`);
    await atEveryWidth(page, testInfo, ({ width }) =>
      expectReadingPage(page, width),
    );
  }
  expect(errors).toEqual([]);
});

test("G.6: a Demo connect from onboarding comes back to the connect step with a compact card, in its centered column", async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  await page.goto("/onboarding?step=connect");
  await linkDemoAccount(page, "/onboarding?step=connect");
  // 05 §5.2: rows 1–2 of the card only; Continue stays the step's one action (P08 Task 3).
  const card = accountCard(page, "@demo.creator");
  await expect(card.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);
  await expect(page.getByText(/Connect another/)).toHaveCount(0);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectReadingPage(page, width);
    await expect(card).toBeVisible();
    await expect(card.getByText(SYNC_LINE)).toBeVisible();
    await expect(card.getByText("Demo account", { exact: true })).toBeVisible();
  });
  expect(errors).toEqual([]);
});

test("G.6: Settings keeps a left-aligned 640 px column and the creator chrome at every tier", async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  // The longest handle shows read-only in Profile.
  await signUpCreator(page, { handle: uniqueLongHandle(testInfo) });
  await page.goto("/dashboard/settings");
  const group = page.getByRole("group", {
    name: REQUESTS_SETTINGS_COPY.approvalWindow,
  });
  const tiles = group.locator("[data-option-tile]");
  const save = page
    .getByRole("region", { name: "Requests" })
    .getByRole("button", { name: "Save", exact: true });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectPageFrame(page, width, { banner: true });
    await expectSettingsColumn(page, width);
    await expectCreatorChrome(page, width);
    // The approval window's tiles: 2 × 2 below md, one row of four from md, inside the column (07 D146).
    await expect(tiles).toHaveCount(4);
    const [a, b, c, d] = await Promise.all(
      (await tiles.all()).map(async (tile) => (await boxOf(tile)).top),
    );
    if (width < TIERS.tablet) {
      expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
      expect(Math.abs(c - d)).toBeLessThanOrEqual(1);
      expect(c - a).toBeGreaterThan(1);
    } else {
      expect(Math.max(a, b, c, d) - Math.min(a, b, c, d)).toBeLessThanOrEqual(
        1,
      );
    }
    await expectInside(group, page.locator("main .max-w-reading").first());
    for (const tile of await tiles.all()) await expectTouchTarget(tile);
    await expectTouchTarget(save);
    if (width < TIERS.desktop) {
      await expectTabBarCurrent(page, "Settings", { inMoreSheet: true });
    }
  });
  expect(errors).toEqual([]);
});

test("G.6: the Inbox and the Library show the payouts banner and the creator chrome per tier", async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  for (const [path, tab] of [
    ["/dashboard", "Inbox"],
    ["/dashboard/library", "Library"],
  ] as const) {
    await page.goto(path);
    const banner = page.getByText(
      "Set up payouts so you can approve requests (about 2 min)",
    );
    await atEveryWidth(page, testInfo, async ({ width }) => {
      await expectPageFrame(page, width, { banner: true });
      await expectCreatorChrome(page, width);
      await expect(banner).toBeVisible();
      if (width < TIERS.desktop) {
        await expectTabBarCurrent(page, tab, { inMoreSheet: false });
      }
    });
  }
  expect(errors).toEqual([]);
});

test("G.6: /@handle fits every tier, logged out", async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  const { handle } = await signUpCreator(page, {
    handle: uniqueLongHandle(testInfo),
  });
  // A long name with no spaces, and the longest handle, must wrap at 320 px, not push the page sideways.
  await page.getByLabel("Display name", { exact: true }).fill(LONG_NAME);
  await pressAndSettleIn(
    page,
    page.getByRole("region", { name: "Profile" }),
    "Save",
  );
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.context().clearCookies();
  const response = await page.goto(`/@${handle}`);
  expect(response?.status()).toBe(200);
  const main = page.locator("main");
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectPageFrame(page, width, { banner: true });
    await expect(
      main.getByRole("heading", { level: 1, name: LONG_NAME }),
    ).toBeVisible();
    await expect(main.getByText(`@${handle}`, { exact: true })).toBeVisible();
    await expect(main.getByText("No videos yet.")).toBeVisible();
    await expect(page.locator("[data-tabbar]")).toHaveCount(0);
  });
  expect(errors).toEqual([]);
});
