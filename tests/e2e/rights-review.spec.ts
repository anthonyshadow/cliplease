import { expect, type Page, test } from "@playwright/test";
import { PAYOUTS_NOTICE_COPY } from "../../src/lib/payouts";
import { POSTINGS_COPY } from "../../src/lib/postings/copy";
import { videoUrl } from "../../src/lib/urls";
import { SLUG_COPY } from "../../src/lib/validation/video";
import { BADGE_COPY } from "../../src/lib/videos/ownership";
import { REVIEW_COPY } from "../../src/lib/videos/review";
import { RIGHTS_COPY } from "../../src/lib/videos/rights";
import { slugFromTitle } from "../../src/lib/videos/slug";
import { videoStepHref } from "../../src/lib/videos/steps";
import { TITLE_COPY } from "../../src/lib/videos/title";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import { viewportWidth } from "./helpers/layout";
import { libraryPostId, POST_01, tiles } from "./helpers/library";
import { pressLink } from "./helpers/press";
import {
  answerRights,
  attachSample,
  cleanCreatedVideos,
  continueButton,
  continueToPostings,
  continueToReview,
  continueToRights,
  createDraft,
  DRAFT_TITLE,
  expectRightsStep,
  expectVideoStepper,
  makeLicensable,
  POSTER_JPG,
  rightsAnswer,
  sameVideoTick,
  stepColumn,
  trackPosterStored,
} from "./helpers/videos";

// Rights and Review (P13; 01 J5.13–J5.17; 05 §6.5 callouts 36–52 and States; 07 D69, D70, D74, D82, D89; owner answers
// Q-94–Q-99) on chromium-desktop and webkit-iphone. A plain upload with no postings: Continue on Rights waits for all
// four answers and music Yes says what turns off; the Review shows its rows (the title and link edited in place by
// keyboard, the cover, "Not posted anywhere yet", the video's prices without the music-disabled uses, the self-attested
// badge) and the payouts Notice but no blockers, and "Set up payouts" comes back to the Review without the Notice.
// Back on Rights the questions keep their answers and the boxes are unticked; an arrow key turns music to No and the
// Review offers all three uses again. A Library draft shows the verified badge and its Demo row. No step shows a
// platform-link Switch (07 D69).
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const review = (page: Page) => stepColumn(page, "review");
/** The Review's read-only price picker's uses. */
const useOptions = (page: Page) =>
  review(page)
    .locator("[data-price-preview]")
    .getByLabel("Use")
    .locator("option");
const ready = (page: Page) =>
  review(page).getByRole("heading", { level: 2, name: REVIEW_COPY.ready });

/** Opens a Review row's _Edit_ by keyboard, types `value` over the field and presses Enter. */
async function editRow(page: Page, row: "title" | "link", value: string) {
  const edit = review(page).getByRole("button", {
    name: `Edit ${row}`,
    exact: true,
  });
  await edit.focus();
  await edit.press("Enter");
  const field = review(page).getByRole("textbox", {
    name: row === "title" ? "Title" : "Link",
    exact: true,
  });
  await expect(field).toBeFocused();
  await field.fill(value);
  await field.press("Enter");
  return { edit, field };
}

test("J5.13–J5.17: a plain upload's Rights waits for all four answers; its Review edits the title and link in place, shows its rows and the payouts Notice, and comes back from payout setup", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  const { handle } = await signUpCreator(page, {
    payouts: false,
    connectDemo: true,
  });
  // Another draft holds the link the Review tries to take.
  await createDraft(page, "Second clip");
  const videoId = await createDraft(page);
  await attachSample(page);
  await continueToPostings(page, videoId);
  const notPosted = page
    .locator("main")
    .getByLabel(POSTINGS_COPY.notPosted, { exact: true });
  await notPosted.focus();
  await notPosted.press("Space");

  // Rights: Continue waits for both boxes and both questions; music Yes says what turns off.
  await continueToRights(page, videoId);
  await expectVideoStepper(page, viewportWidth(page), {
    step: 3,
    label: "Rights",
  });
  await expect(continueButton(page)).toBeDisabled();
  await expect(continueButton(page)).toHaveAccessibleDescription(
    RIGHTS_COPY.answerAll,
  );
  await expect(page.getByText(RIGHTS_COPY.musicFootnote)).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);
  // No default: the four answers start empty.
  for (const input of await stepColumn(page, "rights")
    .getByRole("radio")
    .all()) {
    await expect(input).not.toBeChecked();
  }
  await answerRights(page, { music: "Yes" });
  await expect(
    page.getByText(RIGHTS_COPY.musicFootnote, { exact: true }),
  ).toBeVisible();
  await expect(continueButton(page)).toBeEnabled();
  await continueToReview(page, videoId);

  // Review: nothing blocks, every row, the prices without the music-disabled uses, and the payouts Notice.
  const step = review(page);
  await expectVideoStepper(page, viewportWidth(page), {
    step: 4,
    label: "Review",
  });
  await expect(ready(page)).toBeVisible();
  await expect(step.getByText(DRAFT_TITLE, { exact: true })).toBeVisible();
  await expect(
    step.getByText(videoUrl(handle, slugFromTitle(DRAFT_TITLE)), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    step.getByText(SLUG_COPY.locked, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    step.getByRole("img", { name: `Cover image for ${DRAFT_TITLE}` }),
  ).toBeVisible();
  await expect(
    step.getByText(REVIEW_COPY.notPosted, { exact: true }),
  ).toBeVisible();
  const prices = step.locator("[data-price-preview]");
  await expect(prices).toContainText(
    /License CA\$[\d,]+\.\d\d · Buyer pays CA\$[\d,]+\.\d\d/,
  );
  await expect(useOptions(page)).toHaveText(["Organic social repost"]);
  await expect(
    step.getByText(BADGE_COPY.selfAttested, { exact: true }),
  ).toBeVisible();
  await expect(
    step.getByText(PAYOUTS_NOTICE_COPY.canPublish, { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-publish-blockers]")).toHaveCount(0);
  await expect(
    step.getByRole("button", { name: "Publish", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(
    prices.getByRole("link", { name: "Edit your rate card", exact: true }),
  ).toHaveAttribute("href", "/dashboard/pricing");
  await expect(
    step.getByRole("link", { name: "Edit where it was posted", exact: true }),
  ).toHaveAttribute("href", videoStepHref(videoId, "postings"));
  // Money only ever shows with its currency (07 D98).
  expect(await page.locator("main").innerText()).not.toMatch(/(?<!CA)\$/);

  // The title in place: an empty one says so on the field; a new one shows, and focus goes back to its Edit.
  const title = await editRow(page, "title", "");
  await expect(title.field).toHaveAccessibleDescription(TITLE_COPY.empty);
  await expect(title.field).toBeFocused();
  await title.field.fill("Storm over the roofs");
  await title.field.press("Enter");
  await expect(
    step.getByText("Storm over the roofs", { exact: true }),
  ).toBeVisible();
  await expect(title.edit).toBeFocused();

  // The link: refused shapes and a taken link say why; Escape cancels; a free one shows trimmed and lowercased.
  const link = await editRow(page, "link", "Not a link!");
  await expect(link.field).toHaveAccessibleDescription(
    new RegExp(`^${SLUG_COPY.format}`),
  );
  await link.field.fill(slugFromTitle("Second clip"));
  await link.field.press("Enter");
  await expect(link.field).toHaveAccessibleDescription(
    new RegExp(`^${SLUG_COPY.taken}`),
  );
  await link.field.press("Escape");
  await expect(link.edit).toBeFocused();
  await editRow(page, "link", "  Storm-Roofs ");
  await expect(
    step.getByText(videoUrl(handle, "storm-roofs"), { exact: true }),
  ).toBeVisible();
  await expect(link.edit).toBeFocused();

  // The cover's Edit opens the image picker; the chosen image is stored as the cover (creator_image).
  const stored = trackPosterStored(page);
  const chooser = page.waitForEvent("filechooser");
  await step
    .getByRole("button", { name: "Edit cover image", exact: true })
    .click();
  await (await chooser).setFiles(POSTER_JPG);
  await expect.poll(stored, { timeout: 20_000 }).toBe(true);

  // Set up payouts (the fake driver) comes back to this Review, at its plain address, and the Notice is gone.
  await step.getByRole("link", { name: "Set up payouts", exact: true }).click();
  await expect(page.getByText(PAYOUTS_NOTICE_COPY.canPublish)).toHaveCount(0);
  await expect(page).toHaveURL(videoStepHref(videoId, "review"));
  await expect(ready(page)).toBeVisible();

  // Back on Rights: the questions keep their answers, the boxes start unticked (owner answer Q-99 a).
  await pressLink(page, "Back");
  await expectRightsStep(page, videoId);
  const musicYes = rightsAnswer(page, RIGHTS_COPY.musicQuestion, "Yes");
  const musicNo = rightsAnswer(page, RIGHTS_COPY.musicQuestion, "No");
  await expect(musicYes).toBeChecked();
  await expect(
    rightsAnswer(page, RIGHTS_COPY.peopleQuestion, "No"),
  ).toBeChecked();
  for (const box of [RIGHTS_COPY.ownsRights, RIGHTS_COPY.notReupload]) {
    await expect(page.getByLabel(box, { exact: true })).not.toBeChecked();
  }
  await expect(continueButton(page)).toBeDisabled();

  // An arrow key moves the music answer to No; the Review offers all three uses again.
  await musicYes.focus();
  await musicYes.press("ArrowRight");
  await expect(musicNo).toBeChecked();
  await expect(musicNo).toBeFocused();
  await answerRights(page);
  await continueToReview(page, videoId);
  await expect(useOptions(page)).toHaveText([
    "Organic social repost",
    "Paid social ads",
    "TV / broadcast",
  ]);
  expect(errors).toEqual([]);
});

test("J5.15–J5.17: a Library draft's Review shows the verified badge and its Demo row; people Yes says what buyers will see", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false, connectDemo: true });
  await expect(tiles(page)).toHaveCount(24);
  const videoId = await makeLicensable(
    page,
    await libraryPostId(page, POST_01),
  );
  await attachSample(page);
  await continueToPostings(page, videoId);
  const tick = sameVideoTick(page);
  await tick.focus();
  await tick.press("Space");
  await continueToRights(page, videoId);
  await answerRights(page, { people: "Yes" });
  await expect(
    page.getByText(RIGHTS_COPY.peopleNotice, { exact: true }),
  ).toBeVisible();
  await continueToReview(page, videoId);

  const step = review(page);
  await expect(
    step.getByText("Verified · @demo.creator (demo account)", { exact: true }),
  ).toBeVisible();
  await expect(
    step.getByText("Demo · @demo.creator · Verified", { exact: true }),
  ).toBeVisible();
  await expect(ready(page)).toBeVisible();
  // Organic social, paid social and TV / broadcast: no music, so nothing turned off.
  await expect(useOptions(page)).toHaveCount(3);
  await expect(page.getByRole("switch")).toHaveCount(0);
  expect(errors).toEqual([]);
});
