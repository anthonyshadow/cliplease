import { expect, type Locator, test } from "@playwright/test";
import { PUBLISHED_COPY } from "../../src/lib/videos/review";
import { videoHref } from "../../src/lib/videos/steps";
import { collectConsoleErrors } from "./helpers/console";
import { publishDemoVideo, publishedView } from "./helpers/flows";
import {
  atEveryWidth,
  expectCreatorFrame,
  expectInside,
  expectPageFrame,
  expectReadingColumn,
  expectTouchTarget,
  expectWithinCap,
  tierAt,
} from "./helpers/layout";
import { cleanCreatedVideos } from "./helpers/videos";

// G.6 for publishing (P14a; 05 §1.6 S06, S17, S20; 07 D145, D146, D149, D154) on all four projects, from one Demo video
// published through the UI: the success view and the video's own page are one centered column of at most 640 px at
// every tier; /dashboard/videos and, logged out, /@handle hold their cards in 2 / 3 / 4 / 5 columns (Mobile / Tablet /
// Desktop / XL) inside the app frame, with no sideways scroll and no console error.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const TRACKS = { mobile: 2, tablet: 3, desktop: 4, xl: 5 } as const;

/** The grid's column count for the tier at `width` (07 D146), read from its computed tracks. */
async function expectTracks(grid: Locator, width: number) {
  const count = await grid.evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.split(" ").length,
  );
  expect(count).toBe(TRACKS[tierAt(width)]);
}

test("G.6: the success view, the video's page, /dashboard/videos and the public /@handle at every tier", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const errors = collectConsoleErrors(page);
  const { handle, videoId } = await publishDemoVideo(page);

  const view = publishedView(page);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectReadingColumn(page);
    await expectWithinCap(view, 640);
    for (const control of [
      view.getByRole("button", { name: "Copy", exact: true }),
      view.getByRole("link", { name: PUBLISHED_COPY.openVideo, exact: true }),
      view.getByRole("link", {
        name: PUBLISHED_COPY.backToLibrary,
        exact: true,
      }),
    ]) {
      await expect(control).toBeVisible();
      await expectInside(control, view);
      await expectTouchTarget(control);
    }
  });

  // The video's own page (P14a's header until P14b): the poster, title, Live, the badge and its link.
  await page.goto(videoHref(videoId));
  const header = page.locator("[data-video-header]");
  const copy = header.getByRole("button", { name: "Copy", exact: true });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectReadingColumn(page);
    await expectWithinCap(header, 640);
    await expect(header.getByText("Live", { exact: true })).toBeVisible();
    await expect(
      header.getByText("Verified · @demo.creator (demo account)", {
        exact: true,
      }),
    ).toBeVisible();
    await expectInside(copy, header);
    await expectTouchTarget(copy);
  });

  await page.goto("/dashboard/videos");
  const grid = page.locator("[data-video-grid]");
  const card = grid.locator("[data-video-card]");
  const copyLink = card.getByRole("button", { name: "Copy link" });
  await expect(card).toHaveCount(1);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectTracks(grid, width);
    await expectInside(copyLink, card);
    await expectTouchTarget(copyLink);
  });

  // Logged out: the public page on the same viewport.
  await page.context().clearCookies();
  await page.goto(`/@${handle}`);
  await expect(card).toHaveCount(1);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectPageFrame(page, width, { banner: true });
    await expectTracks(grid, width);
  });
  expect(errors).toEqual([]);
});
