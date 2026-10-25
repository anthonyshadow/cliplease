import { expect, type Locator, test } from "@playwright/test";
import { PUBLISHED_COPY } from "../../src/lib/videos/review";
import { videoHref } from "../../src/lib/videos/steps";
import {
  VIDEO_MENU_COPY,
  VIDEO_PAGE_COPY,
} from "../../src/lib/videos/video-page";
import { collectConsoleErrors } from "./helpers/console";
import {
  openDeleteSheet,
  publishDemoVideo,
  publishedView,
  videoCard,
  videoPage,
} from "./helpers/flows";
import {
  appCap,
  atEveryWidth,
  expectAbove,
  expectCreatorFrame,
  expectInside,
  expectLeftOf,
  expectPageFrame,
  expectReadingColumn,
  expectSheetForm,
  expectTouchTarget,
  expectWithinCap,
  TIERS,
  tierAt,
} from "./helpers/layout";
import { POST_01 } from "./helpers/library";
import { cleanCreatedVideos, createDraft, DRAFT_TITLE } from "./helpers/videos";

// G.6 for publishing and the video page (P14a, P14b; 05 §1.6 S06, S17, S19, S20; 07 D145, D146, D149, D153, D154) on
// all four projects, from one Demo video published through the UI: the success view is one centered column of at most
// 640 px at every tier; the video's page is that column below 1024 and two columns from 1024; /dashboard/videos (with a
// draft beside it, its Menu's Delete sheet a bottom sheet or a dialog) and, logged out, /@handle hold their cards in
// 2 / 3 / 4 / 5 columns (Mobile / Tablet / Desktop / XL) inside the app frame, with no sideways scroll and no console
// error.
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

  // The video's page (S19; 07 D146): one centered 640 column below 1024, the poster above the sections; from 1024 two
  // columns in the app frame, the poster and the link left of the sections.
  await page.goto(videoHref(videoId));
  const videoGrid = videoPage(page);
  const aside = videoGrid.locator("[data-video-aside]");
  const sections = videoGrid.locator("[data-video-sections]");
  const poster = aside.locator("img").filter({ visible: true });
  const copy = aside.getByRole("button", { name: "Copy", exact: true });
  const turnOff = sections.getByRole("button", {
    name: VIDEO_PAGE_COPY.turnOff,
    exact: true,
  });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    if (width < TIERS.desktop) {
      await expectReadingColumn(page);
      await expectWithinCap(videoGrid, 640);
      await expectAbove(poster, sections);
    } else {
      await expectWithinCap(videoGrid, appCap(width));
      await expectLeftOf(aside, sections);
    }
    await expect(poster).toHaveCount(1);
    await expect(aside.getByText("Live", { exact: true })).toBeVisible();
    await expect(
      aside.getByText("Verified · @demo.creator (demo account)", {
        exact: true,
      }),
    ).toBeVisible();
    for (const control of [copy, turnOff]) {
      await expectTouchTarget(control);
    }
    await expectInside(copy, aside);
    await expectInside(turnOff, sections);
  });

  // A draft beside it, so the list has a Continue row too.
  await createDraft(page);
  await page.goto("/dashboard/videos");
  const grid = page.locator("[data-video-grid]");
  const card = grid.locator("[data-video-card]");
  const live = videoCard(page, POST_01);
  const draft = videoCard(page, DRAFT_TITLE);
  const more = draft.getByRole("button", {
    name: VIDEO_MENU_COPY.more(DRAFT_TITLE),
  });
  await expect(card).toHaveCount(2);
  await atEveryWidth(page, testInfo, async ({ width, theme }) => {
    await expectCreatorFrame(page, width);
    await expectTracks(grid, width);
    for (const [control, inside] of [
      [live.getByRole("button", { name: "Copy link" }), live],
      [live.getByRole("button", { name: /^More for / }), live],
      [draft.getByRole("link", { name: "Continue" }), draft],
      [more, draft],
    ] as const) {
      await expectInside(control, inside);
      await expectTouchTarget(control);
    }
    // Delete draft's sheet: a bottom sheet below 768, a dialog from 768 (07 D153); its form doesn't change with the theme.
    if (theme === "dark") return;
    const sheet = await openDeleteSheet(page, DRAFT_TITLE);
    await expectSheetForm(sheet, width);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });

  // Logged out: the public page on the same viewport (the draft isn't on it).
  await page.context().clearCookies();
  await page.goto(`/@${handle}`);
  await expect(card).toHaveCount(1);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectPageFrame(page, width, { banner: true });
    await expectTracks(grid, width);
  });
  expect(errors).toEqual([]);
});
