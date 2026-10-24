import { expect, type Page, test } from "@playwright/test";
import { POSTINGS_COPY } from "../../src/lib/postings/copy";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  atEveryWidth,
  expectCreatorFrame,
  expectInside,
  expectInsideColumn,
  expectReadingColumn,
  expectTouchTarget,
  TIERS,
} from "./helpers/layout";
import { pressLocator } from "./helpers/press";
import {
  attachSample,
  cleanCreatedVideos,
  continueToPostings,
  continueToRights,
  createDraft,
  expectStepLayout,
  expectVideoStepper,
  expectWherePostedLayout,
  linkFields,
  NEW_VIDEO,
  platformChip,
  postingCard,
  stepColumn,
} from "./helpers/videos";

// G.6 for the plain upload (S18, S17b; 05 §1.6, §6.5, §6.6; 07 D145, D146, D149, D153, D154) on all four projects:
// /dashboard/videos, the title page and the File step (before and after sample.mp4 is attached) are one centered
// max-w-reading column inside the app frame at every tier; the dropzone is ≥ 160 px tall below md and ≥ 200 px from md;
// the four-step Stepper shows its segment bar below md and its <ol> from md. Where posted, on the way to Rights, is
// swept with every card open, the longest Other name and a long link's error, then Rights: one centered column below lg
// (no video summary below md, the summary above the step on md), two columns from lg, the chips wrapping and every card
// inside the step. The iPhone hint is never asserted (07 D152). make-licensable.responsive.spec.ts sweeps Rights and
// Review in full (P13); the non-draft placeholder is P14a's (D154).
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

/** One centered ≤ 640 px column inside the app frame, with the creator chrome. */
async function expectColumn(page: Page, width: number) {
  await expectCreatorFrame(page, width);
  await expectReadingColumn(page);
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
    await expectVideoStepper(page, width);
    const height = await dropzone.evaluate(
      (el) => el.getBoundingClientRect().height,
    );
    expect(height).toBeGreaterThanOrEqual(width < TIERS.tablet ? 160 : 200);
  });

  await attachSample(page);
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectColumn(page, width);
    await expectVideoStepper(page, width);
    await expect(page.getByText(/^Original attached/).first()).toBeVisible();
  });
  expect(errors).toEqual([]);
});

test("G.6: /dashboard/videos is one centered reading column at every tier", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });

  await page.goto("/dashboard/videos");
  const heading = page.getByRole("heading", { level: 1 });
  const upload = page.getByRole("link", { name: "Upload a file", exact: true });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectColumn(page, width);
    await expect(heading).toHaveText("Videos. Ready to license.");
    await expectInsideColumn(heading);
    await expect(upload).toBeVisible();
    await expectInsideColumn(upload);
  });
  expect(errors).toEqual([]);
});

test("G.6: an upload's Where posted with every card open, then its Rights step, at every tier", async ({
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);
  await attachSample(page);
  await continueToPostings(page, videoId);

  // Every chip on, with the longest Other name (40 characters) and a long unbroken link whose error shows: nothing may
  // widen the page (07 D146, D153).
  for (const label of [
    "Instagram",
    "TikTok",
    "YouTube",
    "Facebook",
    "X",
    "Snapchat",
    "Other",
    "Demo",
  ]) {
    await pressLocator(platformChip(page, label));
  }
  const other = postingCard(page, "other");
  await other
    .getByLabel("Where? (for example, Vimeo)", { exact: true })
    .fill("W".repeat(40));
  const longLink = linkFields(postingCard(page, "instagram"));
  await longLink.fill(`https://www.instagram.com/reel/${"A".repeat(400)}/`);
  await longLink.blur();
  await expect(longLink).toHaveAttribute("aria-invalid", "true");
  const step = stepColumn(page, "postings");
  const cards = page.locator("[data-posting-card]");
  await expect(cards).toHaveCount(8);
  const notPosted = page.getByLabel(POSTINGS_COPY.notPosted, { exact: true });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectVideoStepper(page, width, { step: 2, label: "Where posted" });
    await expectWherePostedLayout(page, width);
    for (const card of await cards.all()) await expectInside(card, step);
    await expectInside(longLink, step);
    await expectTouchTarget(platformChip(page, "X"));
    await expectTouchTarget(notPosted.locator("xpath=ancestor::label[1]"));
  });

  // "I haven't posted it anywhere yet." clears every card, and Continue goes to Rights.
  await notPosted.focus();
  await notPosted.press("Space");
  await expect(cards).toHaveCount(0);
  await continueToRights(page, videoId);
  const rights = stepColumn(page, "rights");
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectCreatorFrame(page, width);
    await expectVideoStepper(page, width, { step: 3, label: "Rights" });
    await expectStepLayout(page, width, rights);
  });
  expect(errors).toEqual([]);
});
