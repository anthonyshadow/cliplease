import { expect, type Locator, type Page, test } from "@playwright/test";
import { RIGHTS_COPY } from "../../src/lib/videos/rights";
import { sourcePageHref } from "../../src/lib/videos/steps";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  atEveryWidth,
  expectAbove,
  expectCreatorFrame,
  expectInside,
  expectInsideColumn,
  expectLeftOf,
  expectReadingColumn,
  expectTouchTarget,
  TIERS,
} from "./helpers/layout";
import { libraryPostId, POST_01, tiles } from "./helpers/library";
import {
  answerRights,
  attachSample,
  cleanCreatedVideos,
  continueButton,
  continueToPostings,
  continueToReview,
  continueToRights,
  expectOneLine,
  expectStepLayout,
  expectVideoStepper,
  expectWherePostedLayout,
  makeLicensable,
  platformChip,
  rightsQuestion,
  sameVideoBlock,
  sameVideoTick,
  showLinkSwitch,
  sourceRow,
  stepColumn,
} from "./helpers/videos";

// G.6 for Make licensable (P11, P11c; 05 §1.6 S16, S17, S17b, §6.5; 07 D145, D146, D150, D154, D156) on all four
// projects. The Source page is one centered max-w-reading column at every tier, its thumbnail well at most 50dvh tall. A
// Library draft's File step is one centered max-w-reading column below lg with the provenance line above the step, and
// from lg two columns in the app frame with the line left of the step; swept before and after sample.mp4 is attached.
// Its Where posted step (after the upload, so the locked source row, the same-video block and its picture row show) is
// one centered max-w-reading column below lg (the video summary absent below md, above the step on md) and two columns
// from lg; the chips wrap and never scroll, and the cover and the post's picture sit on one line from md. Rights and
// Review (P13) take the same layout: the Yes / No tiles side by side on one line, the Review's rows, read-only prices,
// payouts Notice and Publish inside the step column; every control a 44 px target.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

/** The Library File step's two parts (P11's hooks): the post summary and the step itself. */
const fileStepParts = (page: Page): [Locator, Locator] => [
  page.locator("[data-post-summary]"),
  page.locator("[data-file-step-body]"),
];

/**
 * S17 (07 D146): below lg one centered ≤ 640 px column with the summary above the step; from lg the summary left of the
 * step. Both parts fill their own column either way.
 */
async function expectFileStepLayout(page: Page, width: number) {
  const [summary, step] = fileStepParts(page);
  await expect(summary).toBeVisible();
  await expect(step).toBeVisible();
  if (width < TIERS.desktop) {
    await expectReadingColumn(page);
    await expectInsideColumn(summary);
    await expectInsideColumn(step);
    await expectAbove(summary, step);
  } else {
    await expectLeftOf(summary, step);
  }
}

test("G.6: the Source page is one centered reading column at every tier", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { connectDemo: true, payouts: false });
  await expect(tiles(page)).toHaveCount(24);
  const postId = await libraryPostId(page, POST_01);

  await page.goto(sourcePageHref(postId));
  const main = page.locator("main");
  const heading = main.getByRole("heading", { level: 1 });
  const well = main.locator(".aspect-post").first();
  const primary = main.getByRole("button", {
    name: "Make licensable",
    exact: true,
  });
  const badge = main.getByText("Verified · @demo.creator (demo account)", {
    exact: true,
  });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectReadingColumn(page);
    for (const part of [heading, well, badge, primary]) {
      await expect(part).toBeVisible();
      await expectInsideColumn(part);
    }
    // 07 D150: the well keeps its 50dvh cap at every tier.
    const { height, viewport } = await well.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      viewport: window.innerHeight,
    }));
    expect(height).toBeLessThanOrEqual(viewport / 2 + 1);
  });
  expect(errors).toEqual([]);
});

test("G.6: a Library draft's File step (before and after the upload), Where posted (the source row and the same-video block), Rights and Review are one column below lg and two from lg", async ({
  page,
}, testInfo) => {
  test.setTimeout(600_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { connectDemo: true, payouts: false });
  await expect(tiles(page)).toHaveCount(24);
  const postId = await libraryPostId(page, POST_01);
  const videoId = await makeLicensable(page, postId);

  const [summary, step] = fileStepParts(page);
  const dropzone = page.locator("[data-dropzone]");
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectFileStepLayout(page, width);
    // The upload stays whole in the step (owner answer Q-66 a).
    await expect(dropzone).toBeVisible();
    await expectInside(dropzone, step);
  });

  await attachSample(page);
  // The summary is the provenance line alone: the post's picture and the tick moved to Where posted (07 D69, Q-81 a).
  const provenance = summary.getByText(
    "From Demo · @demo.creator · posted 1 Oct 2026 · Verified",
    { exact: true },
  );
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectFileStepLayout(page, width);
    await expect(provenance).toBeVisible();
    await expect(summary.locator("figure, img")).toHaveCount(0);
    await expect(step.getByText(/^Original attached/).first()).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  await continueToPostings(page, videoId);
  const postingsStep = stepColumn(page, "postings");
  const source = sourceRow(page);
  const block = sameVideoBlock(page);
  const figures = block.locator("figure");
  await expect(figures).toHaveCount(2);
  const demoChip = platformChip(page, "Demo");
  const next = continueButton(page);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectVideoStepper(page, width, { step: 2, label: "Where posted" });
    await expectWherePostedLayout(page, width);
    for (const part of [source, block, next]) {
      await expect(part).toBeVisible();
      await expectInside(part, postingsStep);
    }
    // 07 D146: the cover and the post's picture in one row from md (below it the row may wrap).
    if (width >= TIERS.tablet) await expectOneLine(figures);
    // 44 px targets at every tier (07 D152).
    for (const control of [
      demoChip,
      showLinkSwitch(source),
      sameVideoTick(page).locator("xpath=ancestor::label[1]"),
      next,
    ]) {
      await expectTouchTarget(control);
    }
  });

  // Rights (P13): the attestations and the Yes / No tiles fill the step column.
  const tick = sameVideoTick(page);
  await tick.focus();
  await tick.press("Space");
  await continueToRights(page, videoId);
  const rightsStep = stepColumn(page, "rights");
  const tilesOf = (question: string) =>
    rightsQuestion(page, question).locator("label");
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectVideoStepper(page, width, { step: 3, label: "Rights" });
    await expectStepLayout(page, width, rightsStep);
    for (const question of [
      RIGHTS_COPY.musicQuestion,
      RIGHTS_COPY.peopleQuestion,
    ]) {
      await expect(tilesOf(question)).toHaveCount(2);
      await expectOneLine(tilesOf(question));
      for (const tile of await tilesOf(question).all()) {
        await expectInside(tile, rightsStep);
        await expectTouchTarget(tile);
      }
    }
    await expectTouchTarget(
      page
        .getByLabel(RIGHTS_COPY.ownsRights)
        .locator("xpath=ancestor::label[1]"),
    );
  });

  // Review (P13): its rows, the read-only prices and the payouts Notice fill the step column.
  await answerRights(page);
  await continueToReview(page, videoId);
  const reviewStep = stepColumn(page, "review");
  const rowParts = [
    reviewStep.locator("dl"),
    reviewStep.locator("[data-price-preview]"),
    page.locator("[data-payouts-notice]"),
  ];
  const publish = reviewStep.getByRole("button", {
    name: "Publish",
    exact: true,
  });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectVideoStepper(page, width, { step: 4, label: "Review" });
    await expectStepLayout(page, width, reviewStep);
    for (const part of [...rowParts, publish]) {
      await expect(part).toBeVisible();
      await expectInside(part, reviewStep);
    }
    for (const control of [
      reviewStep.getByRole("button", { name: "Edit title", exact: true }),
      reviewStep.getByRole("link", { name: "Set up payouts", exact: true }),
      publish,
    ]) {
      await expectTouchTarget(control);
    }
  });
  expect(errors).toEqual([]);
});
