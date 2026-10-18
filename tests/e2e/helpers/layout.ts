import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";

// The four layout tiers (07 D144, 04 §5.2): the width in px where each one starts.
export const TIERS = {
  mobile: 0,
  tablet: 768,
  desktop: 1024,
  xl: 1536,
} as const;
export type Tier = keyof typeof TIERS;

export function tierAt(width: number): Tier {
  if (width >= TIERS.xl) return "xl";
  if (width >= TIERS.desktop) return "desktop";
  if (width >= TIERS.tablet) return "tablet";
  return "mobile";
}

// The widths a responsive check covers (07 D153): the Verify set, two spot checks and both sides of each switch.
export const VERIFY_WIDTHS = [375, 768, 1024, 1280, 1920] as const;
export const SPOT_WIDTHS = [320, 2560] as const;
export const EDGE_WIDTHS = [767, 1023, 1535, 1536] as const;

// --gutter per tier (04 §5.3): 16 px, 24 px from md, 32 px from lg.
const GUTTER: Record<Tier, number> = {
  mobile: 16,
  tablet: 24,
  desktop: 32,
  xl: 32,
};

/** WCAG 2.2 SC 1.4.10 Reflow: nothing scrolls sideways. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * The box is at most `maxPx` wide and centered within 1 px. Measured with getBoundingClientRect, not boundingBox(): a box
 * can be 0 px tall (/admin's <main> holds only an sr-only h1), and Playwright treats that as not visible.
 */
export async function expectWithinCap(locator: Locator, maxPx: number) {
  const { left, right, width, clientWidth } = await locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      width: box.width,
      clientWidth: document.documentElement.clientWidth,
    };
  });
  expect(width).toBeLessThanOrEqual(maxPx);
  expect(Math.abs(left - (clientWidth - right))).toBeLessThanOrEqual(1);
}

/** The app column's cap: 1200 px, 1440 px from XL (07 D145). */
export const appCap = (width: number) => (tierAt(width) === "xl" ? 1440 : 1200);

/**
 * The page frame at `width`: nothing scrolls sideways, and <main>, plus the NavBar row when the page has a banner,
 * each keep the tier's gutter, are capped by `max-w-app` (the computed max-width too, so the XL widening is proven)
 * and centered.
 */
export async function expectPageFrame(
  page: Page,
  width: number,
  { banner }: { banner: boolean },
) {
  await expectNoHorizontalScroll(page);
  const gutter = `${GUTTER[tierAt(width)]}px`;
  const boxes = [page.locator("main")];
  if (banner) boxes.push(page.getByRole("banner").locator(":scope > div"));
  for (const box of boxes) {
    await expect(box).toHaveCSS("padding-left", gutter);
    await expect(box).toHaveCSS("padding-right", gutter);
    await expect(box).toHaveCSS("max-width", `${appCap(width)}px`);
    await expectWithinCap(box, appCap(width));
  }
}

/** A reading page (04 §5.2.3): the frame, one centered 640 px column, and no TabBar at any tier. */
export async function expectReadingPage(page: Page, width: number) {
  await expectPageFrame(page, width, { banner: true });
  const column = page.locator("main .max-w-reading").first();
  await expect(column).toHaveCSS("max-width", "640px");
  await expectWithinCap(column, 640);
  await expect(page.locator("[data-tabbar]")).toHaveCount(0);
}

/**
 * The creator chrome for `width` (04 §9.30): the TabBar below lg, with its five tabs in a centered row of at most 640
 * px on Tablet; the NavBar's creator links (`links`, the banner's nav unless given) from lg.
 */
export async function expectCreatorChrome(
  page: Page,
  width: number,
  links: Locator = page.getByRole("banner").locator("nav"),
) {
  const tabBar = page.locator("[data-tabbar]");
  if (width >= TIERS.desktop) {
    await expect(tabBar).toBeHidden();
    await expect(links).toBeVisible();
    return;
  }
  await expect(tabBar).toBeVisible();
  await expect(links).toBeHidden();
  if (tierAt(width) === "tablet") {
    await expect(tabBar.locator(":scope > ul > li")).toHaveCount(5);
    await expectWithinCap(tabBar.locator(":scope > ul"), 640);
  }
}

export type WidthCheck = {
  width: number;
  tier: Tier;
  theme: "light" | "dark";
};

/**
 * Waits for running CSS transitions. Under reduced motion the app turns every change into a 1 ms transition
 * (globals.css), so a value read in the frame of a resize or a theme switch can still be the old one. Built on
 * getAnimations, not timers, so it also works under page.clock; animations that never end (spinners) are left alone.
 */
async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/**
 * Runs `check` in light and dark at every width that matters, without navigating: on chromium-desktop at every Verify,
 * spot and edge width (11 widths, height 900), elsewhere at the project's own viewport. The app follows
 * prefers-color-scheme, so emulateMedia is the theme switch.
 */
export async function atEveryWidth(
  page: Page,
  testInfo: TestInfo,
  check: (at: WidthCheck) => Promise<void>,
) {
  const resize = testInfo.project.name === "chromium-desktop";
  const widths: readonly number[] = resize
    ? [...VERIFY_WIDTHS, ...SPOT_WIDTHS, ...EDGE_WIDTHS]
    : [page.viewportSize()?.width ?? 0];
  for (const width of widths) {
    if (resize) await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await settle(page);
      await test.step(`${width} px · ${theme}`, () =>
        check({ width, tier: tierAt(width), theme }));
    }
  }
}
