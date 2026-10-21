import { expect, type Page, test } from "@playwright/test";
import {
  sourcePageHref,
  videoHref,
  videoStepHref,
} from "../../src/lib/videos/steps";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import { expectAbove } from "./helpers/layout";
import {
  LIBRARY,
  libraryPostId,
  tileByCaption,
  tileLink,
  tiles,
} from "./helpers/library";
import { pressButton, pressLink, pressLocator } from "./helpers/press";
import {
  attachSample,
  cleanCreatedVideos,
  makeLicensable,
} from "./helpers/videos";

// J5's verified path (P11; 01 J5.1–J5.5, J5.10, J3.14; 05 §6.5; 07 D39, D43) on chromium-desktop and webkit-iphone:
// a Library tile opens the Source page with the badge preview, Make licensable opens the draft's File step with the
// provenance line and the Notice, sample.mp4 (14 s) attaches with no duration warning, Continue waits for the tick and
// then goes to Rights; the post's Source page then says it is already licensable (owner answer Q-62 a). Post 02 (38 s)
// shows the warning wherever the browser read the file's length (recorded per project), "?step=rights" before the tick
// stays on the File step, and "‹ Back" goes to the Library (Q-63 b). The other Source page states can't be reached
// here (the e2e server's mock scenario is fixed and every mock post is public): source-page.test(s) and the [int]
// suites prove them. Controls are pressed with the keyboard: on the iPhone a click near the bottom can land on the
// fixed TabBar.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

// Post 01 (14 s, 1 Oct 2026) and post 02 (38 s, 24 Sep 2026), the two newest Demo posts (07 D53).
const POST_01 = /^He saw snow for the first time/;
const POST_02 = /^Caught a wave at sunrise/;
const POST_01_CAPTION =
  "He saw snow for the first time and lost it #dogs #firstsnow";
const BADGE = "Verified · @demo.creator (demo account)";
const LINKED = /^Account linked \d{1,2} [A-Z][a-z]{2} \d{4}$/;
const NOTICE =
  "Demo doesn't share original files with apps. Upload the original from your phone or camera, the version without the Demo watermark.";
const TICK = "This file is the same video as the post";
const TICK_TO_CONTINUE = "Tick the box to continue.";
const WARNING_02 =
  "This file is 0:14 but the post is 0:38. Make sure it's the same video.";
const ANY_WARNING = /Make sure it's the same video\.$/;

/** The File step's Continue: a disabled button until the original is ready, then the tick form's submit. */
const continueButton = (page: Page) =>
  page.getByRole("button", { name: "Continue", exact: true });

test("J5.1–J5.5: post 01's Source page, Make licensable, the File step with the tick, then Rights", async ({
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
  // Before the upload: P10b's disabled Continue, and no tick or pictures yet.
  await expect(continueButton(page)).toBeDisabled();
  await expect(main.getByLabel(TICK, { exact: true })).toHaveCount(0);
  const summary = page.locator("[data-post-summary]");
  await expect(summary.locator("figure")).toHaveCount(0);

  const coverPath = await attachSample(page);
  test.info().annotations.push({ type: "cover path", description: coverPath });

  // The post's picture beside the cover image (owner answer Q-65 a), no warning (post 01 is 14 s, as the file is),
  // and Continue disabled until the tick, with its helper line (Q-64 a).
  await expect(summary.locator("figcaption")).toHaveText([
    "Post",
    "Cover image",
  ]);
  await expect(main.getByText(ANY_WARNING)).toHaveCount(0);
  const tick = main.getByLabel(TICK, { exact: true });
  await expect(tick).not.toBeChecked();
  await expect(continueButton(page)).toBeDisabled();
  await expect(main.getByText(TICK_TO_CONTINUE, { exact: true })).toBeVisible();
  await tick.focus();
  await tick.press("Space");
  await expect(tick).toBeChecked();
  await expect(continueButton(page)).toBeEnabled();
  await expect(main.getByText(TICK_TO_CONTINUE, { exact: true })).toHaveCount(
    0,
  );
  await pressButton(page, "Continue");
  await page.waitForURL(videoStepHref(videoId, "rights"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Rights" }),
  ).toBeVisible();

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
  // The ticked draft's first incomplete step.
  await page.waitForURL(videoStepHref(videoId, "rights"));
  expect(errors).toEqual([]);
});

test("J5.10: post 02 (38 s) warns wherever the browser read the file's length; Rights waits for the tick; ‹ Back goes to the Library", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { connectDemo: true, payouts: false });
  await expect(tiles(page)).toHaveCount(24);
  const postId = await libraryPostId(page, POST_02);
  const videoId = await makeLicensable(page, postId);
  const main = page.locator("main");
  await expect(
    main.getByText(
      "From Demo · @demo.creator · posted 24 Sep 2026 · Verified",
      { exact: true },
    ),
  ).toBeVisible();

  const coverPath = await attachSample(page);
  // The done row carries the length only when the browser read it (P10b: Playwright's Chromium decodes sample.mp4,
  // its WebKit doesn't).
  const attached = main.getByText(/^Original attached/).first();
  const read = ((await attached.textContent()) ?? "").includes("0:14");
  test.info().annotations.push(
    { type: "cover path", description: coverPath },
    {
      type: "duration read",
      description: read
        ? "yes: the warning shows above the tick"
        : "no: the browser gave no length, so no warning",
    },
  );
  const tick = main.getByLabel(TICK, { exact: true });
  await expect(tick).toBeVisible();
  const warning = main.getByText(WARNING_02, { exact: true });
  if (read) {
    await expect(warning).toBeVisible();
    // 05 §6.5: the warning sits above the tick.
    await expectAbove(warning, tick);
  } else {
    await expect(main.getByText(ANY_WARNING)).toHaveCount(0);
  }

  // The original is ready but the box isn't ticked: Rights sends the draft back to the File step.
  await page.goto(videoStepHref(videoId, "rights"));
  await expect(page).toHaveURL(videoStepHref(videoId, "file"));
  await expect(main.getByText(/^Original attached/).first()).toBeVisible();
  await expect(main.getByLabel(TICK, { exact: true })).not.toBeChecked();
  await expect(continueButton(page)).toBeDisabled();
  // The stored length keeps the warning after the reload.
  if (read) await expect(warning).toBeVisible();

  // "‹ Back" goes to the Library at every tier (owner answer Q-63 b).
  await pressLink(page, "Back");
  await page.waitForURL(LIBRARY);
  await expect(tiles(page)).toHaveCount(24);
  expect(errors).toEqual([]);
});
