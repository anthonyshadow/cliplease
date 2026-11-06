import { expect, type Locator, test } from "@playwright/test";
import { VIDEO_EXCLUSIVE_MODES } from "../../src/lib/domain/values";
import { AVAILABILITY_COPY } from "../../src/lib/licensing/availability";
import { PUBLISHED_COPY, REVIEW_COPY } from "../../src/lib/videos/review";
import { videoHref } from "../../src/lib/videos/steps";
import {
  VIDEO_MENU_COPY,
  VIDEO_PAGE_COPY,
} from "../../src/lib/videos/video-page";
import { choose } from "./helpers/buyer";
import { collectConsoleErrors } from "./helpers/console";
import {
  buyLicense,
  offerExclusive,
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
  expectNoHorizontalScroll,
  expectPageFrame,
  expectReadingColumn,
  expectSheetForm,
  expectTouchTarget,
  expectWithinCap,
  TIERS,
  tierAt,
} from "./helpers/layout";
import { POST_01 } from "./helpers/library";
import { pressLocator } from "./helpers/press";
import {
  baseField,
  basePriceRadio,
  basePriceTile,
  editorButton,
  exclusiveEditor,
  exclusiveField,
  exclusiveRadio,
  exclusiveTile,
  musicSwitchControls,
} from "./helpers/video-price";
import { cleanCreatedVideos, createDraft, DRAFT_TITLE } from "./helpers/videos";

// G.6 for publishing and the video page (P14a, P14b, P19d, P19e; 05 §1.6 S06, S17, S19, S20; 07 D82, D109, D145, D146,
// D149, D152, D153, D154) on all four projects, from one Demo video with music published through the UI: the success view
// is one centered column of at most 640 px at every tier; the video's page is that column below 1024 and two columns from
// 1024, its Prices' base-price choices, exclusive choices and live music Switches 44 px targets inside the sections, and
// with "Set a base price for this video" and "Offer on this video" both chosen each field, Save and Cancel too, with no
// sideways scroll; /dashboard/videos (with a draft beside it, its Menu's Delete sheet a bottom sheet or a dialog) and,
// logged out, /@handle hold their cards in 2 / 3 / 4 / 5 columns (Mobile / Tablet / Desktop / XL) inside the app frame,
// with no sideways scroll and no console error. A second test (P19f; 07 D110): an exclusive request's availability line
// inside its card and the video page, and the public card's.
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
  // Music Yes: the video page has its live music Switches (Organic social repost stays on, so nothing else changes).
  const { handle, videoId } = await publishDemoVideo(page, { music: "Yes" });

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
  const switches = musicSwitchControls(sections);
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
    // The Prices' base-price choices, exclusive choices and music Switches (07 D82, D109, D152).
    await expect(switches).toHaveCount(2);
    for (const control of [
      basePriceTile(page, "rate_card"),
      basePriceTile(page, "video"),
      ...VIDEO_EXCLUSIVE_MODES.map((mode) => exclusiveTile(page, mode)),
      ...(await switches.all()),
    ]) {
      await expectInside(control, sections);
      await expectTouchTarget(control);
    }
  });

  // "Set a base price for this video" and "Offer on this video" both chosen: each field, Save and Cancel stay inside the
  // sections; each Cancel leaves its editor clean (no leave guard) for the navigations below.
  await choose(page, "basePrice", "video");
  await choose(page, "exclusiveOffer", "on");
  const baseEditor = page.locator("[data-video-price-editor]");
  const offerEditor = exclusiveEditor(page);
  const field = baseField(page);
  const premium = exclusiveField(page);
  const cancel = editorButton(baseEditor, REVIEW_COPY.cancel);
  const cancelOffer = editorButton(offerEditor, REVIEW_COPY.cancel);
  await atEveryWidth(page, testInfo, async () => {
    await expectNoHorizontalScroll(page);
    await expect(field).toBeVisible();
    await expect(premium).toBeVisible();
    for (const control of [
      field,
      editorButton(baseEditor, REVIEW_COPY.save),
      cancel,
      premium,
      editorButton(offerEditor, REVIEW_COPY.save),
      cancelOffer,
    ]) {
      await expectInside(control, sections);
      await expectTouchTarget(control);
    }
  });
  await pressLocator(cancel);
  await expect(field).toHaveCount(0);
  await expect(basePriceRadio(page, "rate_card")).toBeChecked();
  await pressLocator(cancelOffer);
  await expect(premium).toHaveCount(0);
  await expect(exclusiveRadio(page, "rate_card")).toBeChecked();

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

test("G.6, 07 D110: an exclusive request's line stays inside its card on /dashboard/videos and on the video page, and logged out the public card's Reserved, at every tier", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(600_000);
  const errors = collectConsoleErrors(page);
  const { handle, shareUrl, videoId } = await publishDemoVideo(page);
  await offerExclusive(page);
  const bought = await buyLicense(browser, shareUrl, {
    use: "paid_social",
    term: "y1",
    territory: "worldwide",
    exclusive: true,
  });
  await bought.context.close();

  const words = AVAILABILITY_COPY.line;
  await page.goto("/dashboard/videos");
  const card = videoCard(page, POST_01);
  const cardLine = card.getByText(words.requestWaiting, { exact: true });
  await atEveryWidth(page, testInfo, async () => {
    await expect(cardLine).toBeVisible();
    await expectInside(cardLine, card);
    await expectNoHorizontalScroll(page);
  });

  await page.goto(videoHref(videoId));
  const aside = videoPage(page).locator("[data-video-aside]");
  const pageLine = aside.getByText(words.requestWaiting, { exact: true });
  await atEveryWidth(page, testInfo, async () => {
    await expect(pageLine).toBeVisible();
    await expectInside(pageLine, aside);
    await expectNoHorizontalScroll(page);
  });

  // Logged out: the public page on the same viewport.
  await page.context().clearCookies();
  await page.goto(`/@${handle}`);
  const publicCard = videoCard(page, POST_01);
  const publicLine = publicCard.getByText(words.reserved, { exact: true });
  await atEveryWidth(page, testInfo, async () => {
    await expect(publicLine).toBeVisible();
    await expectInside(publicLine, publicCard);
    await expectNoHorizontalScroll(page);
  });
  expect(errors).toEqual([]);
});
