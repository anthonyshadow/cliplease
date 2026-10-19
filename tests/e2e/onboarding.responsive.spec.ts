import { expect, type Page, test } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator, uniqueLongHandle } from "./helpers/creator";
import {
  atEveryWidth,
  expectCreatorChrome,
  expectInsideColumn,
  expectPageFrame,
  expectReadingPage,
  expectTouchTarget,
  TIERS,
} from "./helpers/layout";
import { pressAndSettle, pressLink } from "./helpers/press";

// G.6 for P05's and P06's pages (07 D154), on all four projects: each test signs up its own creator with signUpCreator.
// The profile step stays in responsive.spec.ts (its /onboarding route lands on ?step=profile). P08 moves the Connections
// checks into its own connections.responsive.spec.ts.
test.use({ reducedMotion: "reduce" });

// 43 characters, no break opportunity.
const LONG_NAME = "Dailylaughsproductionsandfriendsofthestudio";

/**
 * Settings (05 §6.11, 07 D145): one column of at most 640 px that starts at the content edge of <main>, level with its
 * h1, and so is not centered once <main> is wider than the column.
 */
async function expectSettingsColumn(page: Page, width: number) {
  const column = page.locator("main .max-w-reading").first();
  await expect(column).toHaveCSS("max-width", "640px");
  const box = await column.evaluate((el) => {
    const main = el.closest("main") as HTMLElement;
    const style = getComputedStyle(main);
    const h1 = el.querySelector("h1") as HTMLElement;
    return {
      left: el.getBoundingClientRect().left,
      right: el.getBoundingClientRect().right,
      width: el.getBoundingClientRect().width,
      h1Left: h1.getBoundingClientRect().left,
      contentLeft:
        main.getBoundingClientRect().left +
        Number.parseFloat(style.paddingLeft),
      clientWidth: document.documentElement.clientWidth,
    };
  });
  expect(box.width).toBeLessThanOrEqual(640);
  expect(Math.abs(box.left - box.h1Left)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.left - box.contentLeft)).toBeLessThanOrEqual(1);
  if (width >= TIERS.desktop) {
    expect(Math.abs(box.left - (box.clientWidth - box.right))).toBeGreaterThan(
      1,
    );
  }
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

const CONNECTED_TOAST = "Demo connected. Showing your latest videos.";
const DEMO_LINE = "@demo.creator · Demo · Connected";
// The callback's first sync (P07, 07 D13); a slow run can read "1 min ago".
const SYNC_LINE = /^Synced (just now|\d+ min ago) · 24 videos$/;

/** Checks the Connect Demo link carries `returnTo`, follows it and waits for the toast back on `returnTo`. */
async function connectDemo(page: Page, returnTo: string) {
  await expect(
    page.getByRole("link", { name: "Connect Demo" }),
  ).toHaveAttribute(
    "href",
    `/api/connect/mock/start?returnTo=${encodeURIComponent(returnTo)}`,
  );
  await pressLink(page, "Connect Demo");
  const back = new URL(returnTo, "http://x");
  back.searchParams.set("connected", "mock");
  await page.waitForURL(`${back.pathname}${back.search}`);
  await expect(page.getByText(CONNECTED_TOAST, { exact: true })).toBeVisible();
}

test("G.6: a Demo connect from onboarding comes back to the connect step, which keeps its centered column", async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  await page.goto("/onboarding?step=connect");
  await connectDemo(page, "/onboarding?step=connect");
  // Onboarding shows the sync status but no Sync now (P08 Task 3).
  await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectReadingPage(page, width);
    await expect(page.getByText(DEMO_LINE)).toBeVisible();
    await expect(page.getByText(SYNC_LINE)).toBeVisible();
  });
  expect(errors).toEqual([]);
});

test("G.6: Connections keeps a left-aligned 640 px column, and a connect comes back to it", async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  await page.goto("/dashboard/connections");
  await expect(
    page.getByRole("heading", { level: 1, name: /^Connections\./ }),
  ).toBeVisible();
  await connectDemo(page, "/dashboard/connections");
  await expect(page.getByText(DEMO_LINE)).toBeVisible();
  await expect(page.getByText(SYNC_LINE)).toBeVisible();
  // Sync now can be pressed, its action completes, and the button comes back ready with the status line still there.
  // The [int] suite proves what the action does (sync.test.ts: "syncAccount syncs the creator's account").
  await pressAndSettle(page, "Sync now");
  const syncNow = page.getByRole("button", { name: "Sync now", exact: true });
  await expect(syncNow).toBeEnabled();
  await expect(syncNow).not.toHaveAttribute("aria-busy", "true");
  await expect(page.getByText(SYNC_LINE)).toBeVisible();
  // The page never carries a token (07 D37).
  const html = await (await page.request.get("/dashboard/connections")).text();
  expect(html).not.toMatch(/mock_(access|refresh)_/);

  // The longest error message, with the account, its sync status, Sync now and the row, at every width.
  await page.goto("/dashboard/connections?error=already_linked");
  const banner = page.getByText(/is already connected to another/);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectPageFrame(page, width, { banner: true });
    await expectSettingsColumn(page, width);
    await expectCreatorChrome(page, width);
    await expect(banner).toBeVisible();
    await expect(page.getByText(DEMO_LINE)).toBeVisible();
    await expect(page.getByText(SYNC_LINE)).toBeVisible();
    await expect(syncNow).toBeVisible();
    await expectInsideColumn(syncNow);
    await expectTouchTarget(syncNow);
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
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectPageFrame(page, width, { banner: true });
    await expectSettingsColumn(page, width);
    await expectCreatorChrome(page, width);
  });
  expect(errors).toEqual([]);
});

test("G.6: the Inbox and the Library show the payouts banner and the creator chrome per tier", async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  for (const path of ["/dashboard", "/dashboard/library"]) {
    await page.goto(path);
    const banner = page.getByText(
      "Set up payouts so you can approve requests (about 2 min)",
    );
    await atEveryWidth(page, testInfo, async ({ width }) => {
      await expectPageFrame(page, width, { banner: true });
      await expectCreatorChrome(page, width);
      await expect(banner).toBeVisible();
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
  await pressAndSettle(page, "Save");
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
