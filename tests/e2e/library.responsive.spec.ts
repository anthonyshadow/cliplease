import { expect, type Page, test } from "@playwright/test";
import { SYNC_LINE } from "./helpers/connections";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  appCap,
  atEveryWidth,
  type Box,
  boxOf,
  expectCreatorChrome,
  expectPageFrame,
  expectWithinCap,
  TIERS,
} from "./helpers/layout";
import { connectDemo, LIBRARY, tiles } from "./helpers/library";

// G.6 for the Library (S12, 05 §6.1; 07 D145, D146, D150, D154) on all four projects: the app frame and creator chrome,
// the grid's track count per width, the header on one row from md, and the SearchField under the chips below md and
// on their row from md.
test.use({ reducedMotion: "reduce" });

// 07 D146: auto-fill 10 rem tracks with a 12 px gap in <main>'s content box. 2 below md (the base grid-cols-2), 8 from
// XL (1440 cap); between them the count follows the width.
const TRACKS_BETWEEN = new Map([
  [768, 4],
  [1023, 5],
  [1024, 5],
  [1280, 6],
  [1535, 6],
]);

function expectedTracks(width: number): number {
  if (width < TIERS.tablet) return 2;
  if (width >= TIERS.xl) return 8;
  const tracks = TRACKS_BETWEEN.get(width);
  if (tracks === undefined) {
    throw new Error(`no expected track count at ${width} px`);
  }
  return tracks;
}

/** <main>'s content box, inside its gutters. */
const contentOf = (page: Page): Promise<Box> =>
  page.locator("main").evaluate((el) => {
    const { top, bottom, left, right } = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      top,
      bottom,
      left: left + Number.parseFloat(style.paddingLeft),
      right: right - Number.parseFloat(style.paddingRight),
    };
  });

/** `a` and `b` share some of their vertical span: the same row. */
function expectSameRow(a: Box, b: Box) {
  expect(a.top).toBeLessThan(b.bottom);
  expect(a.bottom).toBeGreaterThan(b.top);
}

test("G.6: the Library keeps its frame, grid tracks, header row and search placement at every tier", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page);
  await connectDemo(page);
  await page.goto(LIBRARY);
  await expect(tiles(page)).toHaveCount(24);

  const grid = page.locator("[data-library-grid]");
  const title = page.getByRole("heading", { level: 1 });
  const status = page.locator('main p[aria-live="polite"]');
  const syncAll = page.getByRole("button", { name: "Sync all", exact: true });
  const strip = page
    .locator("main ul")
    .filter({ has: page.getByRole("link", { name: "Add an account" }) });
  const chips = page
    .locator("main ul")
    .filter({ has: page.getByRole("link", { name: "All 24", exact: true }) });
  const search = page.locator("main search");
  await expect(status).toHaveText(SYNC_LINE);
  for (const one of [strip, chips, search]) await expect(one).toHaveCount(1);

  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectPageFrame(page, width, { banner: true });
    await expectWithinCap(page.locator("main"), appCap(width));
    await expectCreatorChrome(page, width);
    // The strip and the chip row scroll inside themselves where they overflow; the document never does (checked by
    // expectPageFrame).
    for (const row of [strip, chips]) {
      await expect(row).toHaveCSS("overflow-x", "auto");
    }

    // The grid fills <main>'s content box with the tier's track count.
    await expect
      .poll(() =>
        grid.evaluate(
          (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
        ),
      )
      .toBe(expectedTracks(width));
    const content = await contentOf(page);
    const gridBox = await boxOf(grid);
    expect(Math.abs(gridBox.left - content.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(gridBox.right - content.right)).toBeLessThanOrEqual(1);

    // The header: stacked below md (title, then SyncStatus, then Sync all); from md SyncStatus and Sync all sit on
    // the title's row, to its right (the title may wrap).
    const titleBox = await boxOf(title);
    const statusBox = await boxOf(status);
    const syncAllBox = await boxOf(syncAll);
    if (width < TIERS.tablet) {
      expect(titleBox.bottom).toBeLessThanOrEqual(statusBox.top);
      expect(statusBox.bottom).toBeLessThanOrEqual(syncAllBox.top);
    } else {
      for (const part of [statusBox, syncAllBox]) {
        expectSameRow(part, titleBox);
        expect(part.left).toBeGreaterThanOrEqual(titleBox.right);
      }
      expectSameRow(statusBox, syncAllBox);
    }

    // SearchField: full width under the chips below md; on the chip row and right-aligned from md.
    const searchBox = await boxOf(search);
    const chipsBox = await boxOf(chips);
    expect(Math.abs(searchBox.right - content.right)).toBeLessThanOrEqual(1);
    if (width < TIERS.tablet) {
      expect(searchBox.top).toBeGreaterThanOrEqual(chipsBox.bottom);
      expect(Math.abs(searchBox.left - content.left)).toBeLessThanOrEqual(1);
    } else {
      expectSameRow(searchBox, chipsBox);
      expect(searchBox.left).toBeGreaterThan(chipsBox.right);
    }
    expect(errors).toEqual([]);
  });
});
