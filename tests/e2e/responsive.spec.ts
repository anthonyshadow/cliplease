import { expect, type Page, test } from "@playwright/test";
import { collectConsoleErrors, visit } from "./helpers/console";
import {
  atEveryWidth,
  expectCreatorChrome,
  expectPageFrame,
  expectReadingPage,
  expectWithinCap,
  TIERS,
  type Tier,
} from "./helpers/layout";
import { pressButton } from "./helpers/press";
import { requestCode, signInWithEmail, uniqueEmail } from "./helpers/sign-in";

// G.6 as amended by 07 §11: every page built so far fits the four layout tiers, on all four projects. Reduced motion
// makes every animation 1 ms (globals.css), so overlays reach their final place at once; the helpers still wait for the
// last frame before measuring.
test.use({ reducedMotion: "reduce" });

const TIER_LABEL: Record<Tier, string> = {
  mobile: "Mobile",
  tablet: "Tablet",
  desktop: "Desktop",
  xl: "XL",
};

/**
 * Opens the gallery's Sheet and checks its form for `width` (04 §5.2.5, §9.22): a full-width bottom sheet with 16 px
 * sides below md, a centered dialog of at most 480 px with 32 px sides from md. Opened with the keyboard: below lg a
 * click can land on the fixed TabBar.
 */
async function expectSheet(page: Page, width: number) {
  await pressButton(page, "Open sheet");
  const dialog = page.getByRole("dialog", { name: "Which countries?" });
  await expect(dialog).toBeVisible();
  // Even at 1 ms the entry animation starts below the screen: measure its end state.
  await dialog.evaluate((el) =>
    Promise.allSettled(
      el
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished),
    ),
  );
  const box = await dialog.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      width: rect.width,
      innerHeight: window.innerHeight,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  const body = dialog.locator(".overflow-y-auto");
  if (width < TIERS.tablet) {
    expect(Math.abs(box.bottom - box.innerHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - box.clientWidth)).toBeLessThanOrEqual(1);
    await expect(body).toHaveCSS("padding-left", "16px");
  } else {
    await expectWithinCap(dialog, 480);
    await expect(body).toHaveCSS("padding-left", "32px");
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

const READING_ROUTES = [
  { path: "/", status: 200 },
  { path: "/legal/license/v1", status: 200 },
  { path: "/legal/terms", status: 200 },
  { path: "/legal/privacy", status: 200 },
  { path: "/legal/data-deletion", status: 200 },
  { path: "/does-not-exist", status: 404 },
] as const;

for (const { path, status } of READING_ROUTES) {
  test(`G.6: ${path} fits every tier`, async ({ page }, testInfo) => {
    const errors = await visit(page, path, status);
    await atEveryWidth(page, testInfo, ({ width }) =>
      expectReadingPage(page, width),
    );
    expect(errors).toEqual([]);
  });
}

test("G.6: /sign-in fits every tier, both steps", async ({
  page,
}, testInfo) => {
  const errors = await visit(page, "/sign-in");
  await atEveryWidth(page, testInfo, ({ width }) =>
    expectReadingPage(page, width),
  );
  // Step 2 shows the masked address; a long domain with no hyphens must still wrap inside the column, even at 320 px.
  const longDomain = uniqueEmail(testInfo).replace(
    "@example.com",
    "@studentmailuniversityofnewcastleupontyne.example.com",
  );
  await requestCode(page, longDomain);
  await atEveryWidth(page, testInfo, ({ width }) =>
    expectReadingPage(page, width),
  );
  expect(errors).toEqual([]);
});

test("G.6: /onboarding fits every tier", async ({ page }, testInfo) => {
  const errors = collectConsoleErrors(page);
  await signInWithEmail(page, uniqueEmail(testInfo), "/onboarding");
  await expect(page).toHaveURL("/onboarding?step=profile");
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectReadingPage(page, width);
    // No creator profile yet, so no NavBar links at any tier (NavBar withoutProfile).
    await expect(page.getByRole("banner").locator("nav")).toHaveCount(0);
  });
  expect(errors).toEqual([]);
});

test("G.6: /dev/ui shows the shell and the primitives per tier", async ({
  page,
}, testInfo) => {
  const errors = await visit(page, "/dev/ui");
  // The countdown chips render once the page has hydrated; the Sheet trigger works from then on.
  await expect(page.locator("main time").first()).toHaveText(/\S/);
  // The creator NavBar demo is the only header in <main> with a nav inside (the admin demo's tabs sit below its header).
  const creatorLinks = page.locator("main header nav");
  await expect(creatorLinks).toHaveCount(1);
  await atEveryWidth(page, testInfo, async ({ width, tier }) => {
    // The NavBar demos sit inside <main>, so the page has no banner.
    await expectPageFrame(page, width, { banner: false });
    // Each demo sits in an overflow-hidden frame, which hides a row that runs past its bar from the page-level check.
    for (const row of await page.locator("main header > div").all()) {
      expect(
        await row.evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(0);
    }
    await expect(page.getByTestId("tier")).toHaveText(
      `Tier: ${TIER_LABEL[tier]}`,
      { useInnerText: true },
    );
    await expectCreatorChrome(page, width, creatorLinks);
    const desktop = width >= TIERS.desktop;
    // Fields are 48 px tall below lg and 44 px from lg (04 §9.6). The gallery has two "Email" fields, so not that label.
    for (const label of ["Handle", "Region"]) {
      const height = await page
        .getByLabel(label, { exact: true })
        .evaluate((el) => el.getBoundingClientRect().height);
      expect(height).toBe(desktop ? 44 : 48);
    }
    await expectSheet(page, width);
  });
  expect(errors).toEqual([]);
});

test.describe("iPad landscape: Desktop with touch", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("G.6: /dev/ui at 1024 × 768 shows the NavBar links and 44 px targets", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "webkit-ipad",
      "iPad landscape runs on webkit-ipad only (07 D154)",
    );
    const errors = await visit(page, "/dev/ui");
    await expect(page.locator("main header nav")).toBeVisible();
    await expect(page.locator("[data-tabbar]")).toBeHidden();
    // Touch is not a tier (07 D144): record what the device reports, never branch on it.
    testInfo.annotations.push({
      type: "pointer-coarse",
      description: String(
        await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      ),
    });
    const heights = async (selector: string) =>
      page
        .locator(selector)
        .filter({ visible: true })
        .evaluateAll((els) =>
          els.map((el) => el.getBoundingClientRect().height),
        );
    const controls = await heights("main header a, main header button");
    const fields = await heights(
      'input:not([type="checkbox"]):not([type="radio"]), select, textarea',
    );
    for (const list of [controls, fields]) {
      expect(list.length).toBeGreaterThan(0);
      for (const height of list) expect(height).toBeGreaterThanOrEqual(44);
    }
    expect(errors).toEqual([]);
  });
});
