import { expect, type Page, test } from "@playwright/test";
import {
  sourcePageHref,
  videoHref,
  videoStepHref,
} from "../../src/lib/videos/steps";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  LIBRARY,
  libraryPostId,
  tileByCaption,
  tileLink,
  tiles,
} from "./helpers/library";
import { pressLocator } from "./helpers/press";
import {
  attachSample,
  cleanCreatedVideos,
  continueToPostings,
  makeLicensable,
} from "./helpers/videos";

// J5's verified path up to Where posted (P11, P11c; 01 J5.1–J5.5, J3.14; 05 §6.5; 07 D39, D43, D69) on chromium-desktop
// and webkit-iphone: a Library tile opens the Source page with the badge preview, Make licensable opens the draft's File
// step with the provenance line and the Notice, sample.mp4 (14 s) attaches, and Continue goes to Where posted (the post's
// picture, the duration warning and the same-video tick live there now, owner answer Q-81 a); the post's Source page then
// says it is already licensable (owner answer Q-62 a) and Open video goes back to Where posted. tests/e2e/where-posted.spec.ts
// takes the step from there, post 02's warning and "‹ Back" included. The other Source page states can't be reached here
// (the e2e server's mock scenario is fixed and every mock post is public): source-page.test(s) and the [int] suites prove
// them. Controls are pressed with the keyboard: on the iPhone a click near the bottom can land on the fixed TabBar.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

// Post 01 (14 s, 1 Oct 2026), the newest Demo post (07 D53).
const POST_01 = /^He saw snow for the first time/;
const POST_01_CAPTION =
  "He saw snow for the first time and lost it #dogs #firstsnow";
const BADGE = "Verified · @demo.creator (demo account)";
const LINKED = /^Account linked \d{1,2} [A-Z][a-z]{2} \d{4}$/;
const NOTICE =
  "Demo doesn't share original files with apps. Upload the original from your phone or camera, the version without the Demo watermark.";
const ANY_WARNING = /Make sure it's the same video\.$/;

/** The File step's Continue while the original isn't ready: a disabled button (a link to Where posted once it is). */
const continueButton = (page: Page) =>
  page.getByRole("button", { name: "Continue", exact: true });

test("J5.1–J5.5: post 01's Source page, Make licensable, the File step, then Where posted", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { connectDemo: true, payouts: false });
  await expect(tiles(page)).toHaveCount(24);
  const postId = await libraryPostId(page, POST_01);

  // The tile opens the Source page (S16).
  await pressLocator(tileLink(tileByCaption(page, POST_01)));
  await page.waitForURL(sourcePageHref(postId));
  const main = page.locator("main");
  await expect(
    main.getByRole("heading", {
      level: 1,
      name: "New video. From your Library or a file.",
    }),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: "Library", exact: true }),
  ).toHaveAttribute("href", LIBRARY);
  await expect(main.getByText(POST_01_CAPTION, { exact: true })).toBeVisible();
  await expect(
    main.getByText("Demo · 1 Oct 2026 · 0:14", { exact: true }),
  ).toBeVisible();
  const viewOn = main.getByRole("link", {
    name: "View on Demo (opens in a new tab)",
    exact: true,
  });
  await expect(viewOn).toHaveText("View on Demo ↗");
  await expect(viewOn).toHaveAttribute("target", "_blank");
  await expect(viewOn).toHaveAttribute("rel", "noopener noreferrer");
  await expect(viewOn).toHaveAttribute(
    "href",
    /^https:\/\/example\.com\/mock\/\S+$/,
  );
  // The Source page's provenance line never says "· Verified": nothing is verified yet (05 over 01 J5.1).
  await expect(
    main.getByText("From Demo · @demo.creator · posted 1 Oct 2026", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    main.getByText("Buyers will see:", { exact: true }),
  ).toBeVisible();
  await expect(main.getByText(BADGE, { exact: true })).toBeVisible();
  await expect(main.getByText(LINKED)).toBeVisible();
  await expect(main.locator("ol")).toHaveCount(0);

  // The badge's explainer (04 §9.19, §11.2; 07 D43, D70): Esc closes it and focus returns to its link.
  const explain = main.getByRole("button", {
    name: "What does this mean?",
    exact: true,
  });
  await pressLocator(explain);
  const sheet = page.getByRole("dialog", { name: "What “Verified” means." });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(
    "This confirms who controls the account, not who filmed it.",
  );
  await expect(sheet).toContainText(
    "Not verified means the creator added the link, but we couldn't confirm the account is theirs.",
  );
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(explain).toBeFocused();

  // Nothing is written before the press: the tile still opens the Source page and offers Make licensable.
  await page.goto(LIBRARY);
  const first = tileByCaption(page, POST_01);
  await expect(tileLink(first)).toHaveAttribute("href", sourcePageHref(postId));
  await expect(
    first.getByRole("link", { name: "Make licensable", exact: true }),
  ).toBeVisible();

  // Make licensable: the live check, then the draft's File step (S17).
  const videoId = await makeLicensable(page, postId);
  await expect(
    main.getByRole("link", { name: "Back", exact: true }),
  ).toHaveAttribute("href", LIBRARY);
  await expect(
    main.getByText("From Demo · @demo.creator · posted 1 Oct 2026 · Verified", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(main.getByText(NOTICE, { exact: true })).toBeVisible();
  await expect(
    main.getByRole("link", { name: "Connect an account", exact: true }),
  ).toHaveCount(0);
  // Before the upload: P10b's disabled Continue.
  await expect(continueButton(page)).toBeDisabled();

  const coverPath = await attachSample(page);
  test.info().annotations.push({ type: "cover path", description: coverPath });

  // The File step keeps no post picture, warning or tick (they moved to Where posted, 07 D69; owner answer Q-81 a):
  // Continue is a link to Where posted for a Library video too.
  const summary = page.locator("[data-post-summary]");
  await expect(summary.locator("figure, img")).toHaveCount(0);
  await expect(main.getByText(ANY_WARNING)).toHaveCount(0);
  await expect(main.getByRole("checkbox")).toHaveCount(0);
  await expect(main.getByText(/same video/)).toHaveCount(0);
  await expect(
    main.getByRole("link", { name: "Continue", exact: true }),
  ).toHaveAttribute("href", videoStepHref(videoId, "postings"));
  await continueToPostings(page, videoId);

  // J3.14: the tile now opens the video, and the old Source page URL says the post is already licensable (Q-62 a).
  await page.goto(LIBRARY);
  await expect(tileLink(tileByCaption(page, POST_01))).toHaveAttribute(
    "href",
    videoHref(videoId),
  );
  await page.goto(sourcePageHref(postId));
  await expect(
    main.getByText("This post is already licensable.", { exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Make licensable", exact: true }),
  ).toHaveCount(0);
  const open = main.getByRole("link", { name: "Open video", exact: true });
  await expect(open).toHaveAttribute("href", videoHref(videoId));
  await pressLocator(open);
  // The draft's first incomplete step: Where posted, which tests/e2e/where-posted.spec.ts takes from here.
  await page.waitForURL(videoStepHref(videoId, "postings"));
  expect(errors).toEqual([]);
});
