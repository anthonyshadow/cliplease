import { expect, type Locator, type Page, test } from "@playwright/test";
import { sourcePageHref } from "../../src/lib/videos/steps";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  atEveryWidth,
  boxOf,
  expectAbove,
  expectCreatorChrome,
  expectInsideColumn,
  expectLeftOf,
  expectPageFrame,
  expectReadingColumn,
  TIERS,
} from "./helpers/layout";
import { libraryPostId, tiles } from "./helpers/library";
import {
  attachSample,
  cleanCreatedVideos,
  makeLicensable,
} from "./helpers/videos";

// G.6 for Make licensable (P11; 05 §1.6 S16, S17, §6.5; 07 D145, D146, D150, D154) on all four projects. The Source page
// is one centered max-w-reading column at every tier, its thumbnail well at most 50dvh tall. A Library draft's File step
// is one centered max-w-reading column below lg with the post summary above the step, and from lg two columns in the app
// frame with the post summary left of the step; swept before and after sample.mp4 is attached, as the post's picture
// and the cover only show once it is. P11c and P13 extend this spec with their steps.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

// Post 01, the newest Demo post (07 D53).
const POST_01 = /^He saw snow for the first time/;

/** The page frame (<main> within its cap, the tier's gutter, nothing sideways) and the creator chrome. */
async function expectFrame(page: Page, width: number) {
  await expectPageFrame(page, width, { banner: true });
  await expectCreatorChrome(page, width);
}

/** The Library File step's two parts (P11's hooks): the post summary and the step itself. */
const fileStepParts = (page: Page): [Locator, Locator] => [
  page.locator("[data-post-summary]"),
  page.locator("[data-file-step-body]"),
];

/** `inner` lies within `outer` from left to right, within 1 px. */
async function expectInside(inner: Locator, outer: Locator) {
  const [a, b] = await Promise.all([boxOf(inner), boxOf(outer)]);
  expect(a.left).toBeGreaterThanOrEqual(b.left - 1);
  expect(a.right).toBeLessThanOrEqual(b.right + 1);
}

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
    await expectFrame(page, width);
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

test("G.6: a Library draft's File step is one column below lg and two from lg, before and after the upload", async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { connectDemo: true, payouts: false });
  await expect(tiles(page)).toHaveCount(24);
  const postId = await libraryPostId(page, POST_01);
  await makeLicensable(page, postId);

  const [summary, step] = fileStepParts(page);
  const dropzone = page.locator("[data-dropzone]");
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectFrame(page, width);
    await expectFileStepLayout(page, width);
    // The upload stays whole in the step (owner answer Q-66 a).
    await expect(dropzone).toBeVisible();
    await expectInside(dropzone, step);
  });

  await attachSample(page);
  const figures = summary.locator("figure");
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectFrame(page, width);
    await expectFileStepLayout(page, width);
    await expect(figures).toHaveCount(2);
    await expect(step.getByText(/^Original attached/).first()).toBeVisible();
    await expect(
      step.getByLabel("This file is the same video as the post", {
        exact: true,
      }),
    ).toBeVisible();
  });
  expect(errors).toEqual([]);
});
