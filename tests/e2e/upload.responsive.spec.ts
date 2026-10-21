import { expect, type Page, test } from "@playwright/test";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  atEveryWidth,
  expectCreatorChrome,
  expectInsideColumn,
  expectPageFrame,
  expectReadingColumn,
  TIERS,
} from "./helpers/layout";
import { pressLink } from "./helpers/press";
import {
  attachSample,
  cleanCreatedVideos,
  createDraft,
  NEW_VIDEO,
} from "./helpers/videos";

// G.6 for the plain upload (S18, 05 §1.6, §6.6; 07 D145, D149, D154) on all four projects: /dashboard/videos, the title
// page, the File step (before and after sample.mp4 is attached) and the Rights step's placeholder are one centered
// max-w-reading column inside the app frame at every tier; the dropzone is ≥ 160 px tall below md and ≥ 200 px from md;
// the Stepper shows its segment bar below md and its <ol> from md. The iPhone hint is never asserted (07 D152). The
// Review and non-draft placeholders can't be reached yet: P13 and P14a, which replace them, add their sweeps (D154).
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

/** One centered ≤ 640 px column inside the app frame, with the creator chrome. */
async function expectColumn(page: Page, width: number) {
  await expectPageFrame(page, width, { banner: true });
  await expectReadingColumn(page);
  await expectCreatorChrome(page, width);
}

/** The Stepper (04 §9.28): "Step n of 3 · {label}" over a 3-segment bar below md; the <ol> with the current step from md. */
async function expectStepper(
  page: Page,
  width: number,
  current: { step: number; label: string } = { step: 1, label: "File" },
) {
  const caption = page.getByText(
    `Step ${current.step} of 3 · ${current.label}`,
    { exact: true },
  );
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
    await expect(list.locator('[aria-current="step"]')).toHaveText(
      current.label,
    );
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

test("G.6: the Rights step's placeholder is one centered reading column at every tier", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);
  await attachSample(page);

  await pressLink(page, "Continue");
  await page.waitForURL(`/dashboard/videos/${videoId}?step=rights`);
  const heading = page.getByRole("heading", { level: 1, name: "Rights" });
  await atEveryWidth(page, testInfo, async ({ width }) => {
    await expectColumn(page, width);
    await expectStepper(page, width, { step: 2, label: "Rights" });
    await expect(heading).toBeVisible();
    await expectInsideColumn(heading);
  });
  expect(errors).toEqual([]);
});
