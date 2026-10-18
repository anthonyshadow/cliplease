import { expect, type Page, test } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator, uniqueLongHandle } from "./helpers/creator";
import {
  atEveryWidth,
  expectCreatorChrome,
  expectNoHorizontalScroll,
  expectPageFrame,
  expectReadingPage,
  TIERS,
} from "./helpers/layout";
import { pressAndSettle } from "./helpers/server-action";

// G.6 for P05's pages (07 D154), on all four projects: each test signs up its own creator with signUpCreator. The
// profile step stays in responsive.spec.ts (its /onboarding route lands on ?step=profile).
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

test("G.6: Settings keeps a left-aligned 640 px column and the creator chrome at every tier", async ({
  page,
}, testInfo) => {
  const errors = collectConsoleErrors(page);
  // The longest handle shows read-only in Profile.
  await signUpCreator(page, { handle: uniqueLongHandle(testInfo) });
  await page.goto("/dashboard/settings");
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectNoHorizontalScroll(page);
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
      await expectNoHorizontalScroll(page);
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
    await expectNoHorizontalScroll(page);
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
