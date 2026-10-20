import { expect, type Page, test } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  atEveryWidth,
  expectCreatorChrome,
  expectPageFrame,
  expectReadingColumn,
  TIERS,
} from "./helpers/layout";
import {
  attachSample,
  cleanCreatedVideos,
  createDraft,
  NEW_VIDEO,
} from "./helpers/videos";

// G.6 for the plain upload (S18, 05 §1.6, §6.6; 07 D145, D149, D154) on all four projects: the title page and the File
// step, before and after sample.mp4 is attached, are one centered max-w-reading column inside the app frame at every
// tier; the dropzone is ≥ 160 px tall below md and ≥ 200 px from md; the Stepper shows its segment bar below md and
// its <ol> from md. The iPhone hint is never asserted (07 D152).
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

/** One centered ≤ 640 px column inside the app frame, with the creator chrome. */
async function expectColumn(page: Page, width: number) {
  await expectPageFrame(page, width, { banner: true });
  await expectReadingColumn(page);
  await expectCreatorChrome(page, width);
}

/** The Stepper (04 §9.28): "Step 1 of 3 · File" over its 3-segment bar below md; the <ol> with the current step from md. */
async function expectStepper(page: Page, width: number) {
  const caption = page.getByText("Step 1 of 3 · File", { exact: true });
  const bar = caption.locator("xpath=following-sibling::div[1]");
  const list = page.locator("main ol").filter({ hasText: "Rights" });
  if (width < TIERS.tablet) {
    await expect(caption).toBeVisible();
    await expect(bar).toBeVisible();
    await expect(bar.locator(":scope > span")).toHaveCount(3);
    await expect(list).toBeHidden();
  } else {
    await expect(caption).toBeHidden();
    await expect(list).toBeVisible();
    await expect(list.locator('[aria-current="step"]')).toHaveText("File");
  }
}

test("G.6: the title page and the File step are one centered reading column at every tier", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });

  await page.goto(NEW_VIDEO);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectColumn(page, width);
  });

  await createDraft(page);
  const dropzone = page.locator("[data-dropzone]");
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectColumn(page, width);
    await expectStepper(page, width);
    const height = await dropzone.evaluate(
      (el) => el.getBoundingClientRect().height,
    );
    expect(height).toBeGreaterThanOrEqual(width < TIERS.tablet ? 160 : 200);
  });

  await attachSample(page);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectColumn(page, width);
    await expectStepper(page, width);
    await expect(page.getByText(/^Original attached/).first()).toBeVisible();
  });
  expect(errors).toEqual([]);
});
