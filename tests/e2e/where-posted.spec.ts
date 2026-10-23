import { expect, type Page, test } from "@playwright/test";
import { sourcePageHref, videoStepHref } from "../../src/lib/videos/steps";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import { expectAbove, expectLeftOf } from "./helpers/layout";
import { libraryPostId, tiles, waitForLibrary } from "./helpers/library";
import {
  trackExternalRequests,
  trackPageFetches,
  trackServerActions,
} from "./helpers/network";
import {
  pressAndSettle,
  pressButton,
  pressLink,
  pressLocator,
  waitInPage,
} from "./helpers/press";
import {
  attachSample,
  chipGroup,
  cleanCreatedVideos,
  continueToPostings,
  createDraft,
  expectOneLine,
  expectVideoStepper,
  linkFields,
  makeLicensable,
  platformChip,
  postingCard,
  sameVideoBlock,
  sameVideoTick,
  showLinkSwitch,
  sourceRow,
} from "./helpers/videos";

// J5's Where posted step (P11c; 01 J5.6, J5.10, J5.17, J5.22–J5.29; 04 §9.33, §11.10; 05 §6.5 S17b; 07 D65–D70;
// owner answers Q-73–Q-81) on chromium-desktop and webkit-iphone. A Library draft arrives with its source posting locked
// and the same-video tick required: Continue without it stays with "Confirm these posts show this same video", and the
// source row's Switch survives a reload. Post 02 (38 s) warns above the tick wherever the browser read the file's length
// (recorded per project). A plain upload picks chips, pastes links (Move for a link from another platform, the short-link
// copy, a client-blocked Continue), and sees each saved link's result in place; nothing is ever asked of a pasted host.
// "I haven't posted it anywhere yet." completes the step with nothing chosen; nothing chosen at all says "Say where it
// was posted". The states the e2e server can't reach (check failed, Reconnect, not found, released, private, unlisted,
// the refusals, the read-only mode) are proven by the unit and [int] suites. P14a/P15 extend this spec to publish and the
// buyer view. Controls are pressed with the keyboard: on the iPhone a click near the bottom can land on the fixed TabBar.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

// Post 01 (14 s, 1 Oct 2026) and post 02 (38 s, 24 Sep 2026), the two newest Demo posts (07 D53).
const POST_01 = /^He saw snow for the first time/;
const POST_02 = /^Caught a wave at sunrise/;
/** The creator's own Demo link to post 01 (P11b: built from the provider's post id only, unique per creator). */
const OWN_DEMO_LINK =
  /^https:\/\/example\.com\/mock\/mock_post_[0-9a-f]{8}_01$/;
const IG_REEL = "https://www.instagram.com/reel/C0dEaBcDeF1/";
const TIKTOK_SHORT = "https://vm.tiktok.com/ZMabc123/";
const FB_REEL = "https://www.facebook.com/reel/1234567890123";
const VIMEO = "https://vimeo.com/123456789";

const NOT_POSTED = "I haven't posted it anywhere yet.";
const UPLOAD_NOTE =
  "Is this video on Instagram, TikTok or YouTube? Connect the account to get a Verified label.";
const MISSING_TICK = "Confirm these posts show this same video";
const NOTHING_CHOSEN = "Say where it was posted";
const WARNING_02 =
  "This file is 0:14 but the post is 0:38. Make sure it's the same video.";
const ANY_WARNING = /Make sure it's the same video\.$/;
const VERIFIED_DEMO = "Verified · on @demo.creator";
const POSTER_SRC = (videoId: string) =>
  new RegExp(`^/api/media/posters/${videoId}\\?v=[0-9a-f]{8}$`);
const THUMBNAIL_SRC = /^\/api\/library\/thumbnails\/[0-9a-f-]{36}(\?v=\S+)?$/;

/** The page's viewport width (the project's own: these tests never resize). */
const viewportWidth = (page: Page) => page.viewportSize()?.width ?? 0;

/** "Say where it was posted" under the chips (the field error, not its screen-reader announcement). */
const nothingChosen = (page: Page) =>
  page.locator('main p:not([role="alert"])', {
    hasText: new RegExp(`^${NOTHING_CHOSEN}$`),
  });

/** The same-video block's cover image and the post's picture, side by side (the block's one wrapping row). */
async function expectCoverBesidePost(page: Page, videoId: string) {
  const block = sameVideoBlock(page);
  await expect(block.locator("figcaption")).toHaveText(["Cover image", "Post"]);
  const figures = block.locator("figure");
  const [cover, post] = [figures.nth(0), figures.nth(1)];
  await expect(cover.locator("img")).toHaveAttribute(
    "src",
    POSTER_SRC(videoId),
  );
  await expect(post.locator("img")).toHaveAttribute("src", THUMBNAIL_SRC);
  // Both images loaded (through the poster route and the creator-only thumbnail proxy), then the row measured.
  for (const img of await block.locator("img").all()) {
    await expect
      .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
  }
  await expectOneLine(figures);
  await expectLeftOf(cover, post);
}

test("J5.10, J5.22: a Library draft's Where posted locks the source row and waits for the tick; the source Switch survives a reload", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { connectDemo: true, payouts: false });
  await expect(tiles(page)).toHaveCount(24);
  const postId = await libraryPostId(page, POST_01);
  const videoId = await makeLicensable(page, postId);
  await attachSample(page);
  await continueToPostings(page, videoId);
  await expectVideoStepper(page, viewportWidth(page), {
    step: 2,
    label: "Where posted",
  });
  const main = page.locator("main");
  // "‹ Back" goes to the File step (owner answer Q-80 a).
  await expect(
    main.getByRole("link", { name: "Back", exact: true }),
  ).toHaveAttribute("href", videoStepHref(videoId, "file"));

  // The locked source row (04 §9.33): its title, the Verified pill and "From your Library", its Switch on, no link
  // field and no Remove; its chip on and aria-disabled. No not-posted row and no upload note on a Library video.
  const source = sourceRow(page);
  await expect(source).toHaveCount(1);
  await expect(
    source.getByText("@demo.creator on Demo", { exact: true }),
  ).toBeVisible();
  await expect(source.getByText("Verified", { exact: true })).toBeVisible();
  await expect(
    source.getByText("· From your Library", { exact: true }),
  ).toBeVisible();
  await expect(linkFields(source)).toHaveCount(0);
  await expect(
    source.getByRole("button", { name: "Remove", exact: true }),
  ).toHaveCount(0);
  const sourceSwitch = showLinkSwitch(source);
  await expect(sourceSwitch).toBeChecked();
  const demoChip = platformChip(page, "Demo");
  await expect(demoChip).toHaveAttribute("aria-pressed", "true");
  await expect(demoChip).toHaveAttribute("aria-disabled", "true");
  await expect(chipGroup(page).getByRole("button")).toHaveText([
    "Instagram",
    "TikTok",
    "YouTube",
    "Facebook",
    "X",
    "Snapchat",
    "Other",
    "Demo",
  ]);
  await expect(main.getByLabel(NOT_POSTED, { exact: true })).toHaveCount(0);
  await expect(main.getByText(UPLOAD_NOTE, { exact: true })).toHaveCount(0);

  // The same-video block: the cover beside the post's picture, no warning (post 01 is 14 s, as the file is), unticked.
  await expectCoverBesidePost(page, videoId);
  await expect(main.getByText(ANY_WARNING)).toHaveCount(0);
  const tick = sameVideoTick(page);
  await expect(tick).not.toBeChecked();

  // Continue without the tick stays, with the field error on the box and focus on it (owner answer Q-75 a).
  await pressAndSettle(page, "Continue");
  await expect(page).toHaveURL(videoStepHref(videoId, "postings"));
  await expect(tick).toHaveAccessibleDescription(MISSING_TICK);
  await expect(tick).toHaveAttribute("aria-invalid", "true");
  await expect(tick).toBeFocused();

  // The source Switch off (owner answer Q-73 a), the tick, then Continue goes to Rights.
  await sourceSwitch.focus();
  await sourceSwitch.press("Space");
  await expect(sourceSwitch).not.toBeChecked();
  await tick.focus();
  await tick.press("Space");
  await expect(tick).toBeChecked();
  await expect(main.getByText(MISSING_TICK, { exact: true })).toHaveCount(0);
  await pressButton(page, "Continue");
  await page.waitForURL(videoStepHref(videoId, "rights"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Rights" }),
  ).toBeVisible();

  // Both were saved: a fresh load of Where posted has the source Switch off and the tick on.
  await page.goto(videoStepHref(videoId, "postings"));
  await expect(sourceSwitch).toHaveAttribute("aria-checked", "false");
  await expect(sameVideoTick(page)).toBeChecked();
  expect(errors).toEqual([]);
});

test("J5.10: post 02 (38 s) warns above the tick wherever the browser read the file's length; Rights waits for Where posted; ‹ Back goes to the File step, then the Library", async ({
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
  // The done row carries the length only when the browser read it (P10b; P11 recorded both projects reading 0:14).
  const attached = main.getByText(/^Original attached/).first();
  const read = ((await attached.textContent()) ?? "").includes("0:14");
  test.info().annotations.push(
    { type: "cover path", description: coverPath },
    {
      type: "duration read",
      description: read
        ? "yes: the File step showed 0:14, and Where posted warns above the tick"
        : "no: the browser gave no length, so no warning",
    },
  );
  // The File step has no warning, picture or tick any more (07 D69, owner answer Q-81 a).
  await expect(main.getByText(ANY_WARNING)).toHaveCount(0);
  await expect(sameVideoTick(page)).toHaveCount(0);
  await expect(main.locator("figure")).toHaveCount(0);

  // The original is ready but Where posted isn't done: Rights sends the draft there.
  await page.goto(videoStepHref(videoId, "rights"));
  await expect(page).toHaveURL(videoStepHref(videoId, "postings"));
  const tick = sameVideoTick(page);
  await expect(tick).not.toBeChecked();
  const warning = main.getByText(WARNING_02, { exact: true });
  if (read) {
    await expect(warning).toBeVisible();
    // 05 §6.5: the warning sits above the tick, inside the same-video block.
    await expect(sameVideoBlock(page).getByText(WARNING_02)).toBeVisible();
    await expectAbove(warning, tick);
  } else {
    await expect(main.getByText(ANY_WARNING)).toHaveCount(0);
  }

  // "‹ Back" goes to the File step (Q-80 a), whose own Back goes to the Library (Q-63 b).
  await pressLink(page, "Back");
  await page.waitForURL(videoStepHref(videoId, "file"));
  await expect(main.getByText(/^Original attached/).first()).toBeVisible();
  await pressLink(page, "Back");
  await waitForLibrary(page);
  await expect(tiles(page)).toHaveCount(24);
  expect(errors).toEqual([]);
});

test("J5.6, J5.22–J5.26: an upload's links: Move, the short-link copy, then each saved result in place, the tick, and Rights; no pasted host is asked", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectConsoleErrors(page);
  const external = trackExternalRequests(page);
  await signUpCreator(page, { connectDemo: true, payouts: false });
  await expect(tiles(page)).toHaveCount(24);

  // The creator's own Demo link to post 01, read from its Source page without pressing Make licensable (and never
  // followed: it opens example.com in a new tab).
  const postId = await libraryPostId(page, POST_01);
  await page.goto(sourcePageHref(postId));
  const main = page.locator("main");
  const viewOn = main.getByRole("link", {
    name: "View on Demo (opens in a new tab)",
    exact: true,
  });
  await expect(viewOn).toHaveAttribute("href", OWN_DEMO_LINK);
  const ownLink = (await viewOn.getAttribute("href")) ?? "";

  const videoId = await createDraft(page);
  await attachSample(page);
  // The upload note moved to Where posted (07 D69).
  await expect(main.getByText(UPLOAD_NOTE, { exact: true })).toHaveCount(0);
  await continueToPostings(page, videoId);
  await expectVideoStepper(page, viewportWidth(page), {
    step: 2,
    label: "Where posted",
  });
  await expect(main.getByText(UPLOAD_NOTE, { exact: true })).toBeVisible();
  await expect(
    main.getByRole("link", { name: "Connect an account", exact: true }),
  ).toHaveAttribute("href", "/dashboard/connections");
  await expect(main.getByLabel(NOT_POSTED, { exact: true })).not.toBeChecked();
  await expect(page.locator("[data-posting-card]")).toHaveCount(0);
  // Rights isn't reachable before Where posted is done.
  await page.goto(videoStepHref(videoId, "rights"));
  await expect(page).toHaveURL(videoStepHref(videoId, "postings"));

  // From here to Continue nothing may leave the browser but the router's own prefetches.
  const fetches = trackPageFetches(page);

  // TikTok's card, and an Instagram reel pasted into it: no error while typing, the Move line on blur (Q-76 a).
  await pressLocator(platformChip(page, "TikTok"));
  await expect(platformChip(page, "TikTok")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const tiktok = postingCard(page, "tiktok");
  const tiktokLink = linkFields(tiktok);
  await expect(tiktokLink).toHaveAttribute(
    "placeholder",
    "tiktok.com/@you/video/…",
  );
  await expect(
    tiktok.getByText(
      "Optional. Without a link, buyers see “Also posted on TikTok”.",
      { exact: true },
    ),
  ).toBeVisible();
  await tiktokLink.fill(IG_REEL);
  const moveLine = tiktok.getByText(
    "This is an Instagram link. Move it there?",
    { exact: true },
  );
  await expect(moveLine).toHaveCount(0);
  await tiktokLink.blur();
  await expect(moveLine).toBeVisible();
  await expect(tiktokLink).toHaveAttribute("aria-invalid", "true");

  // Move: Instagram's chip turns on, the link sits in its card, the TikTok field is empty again and focus follows it.
  await pressLocator(tiktok.getByRole("button", { name: "Move", exact: true }));
  await expect(platformChip(page, "Instagram")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const instagramLink = linkFields(postingCard(page, "instagram"));
  await expect(instagramLink).toHaveValue(IG_REEL);
  await expect(instagramLink).toBeFocused();
  await expect(tiktokLink).toHaveValue("");
  await expect(moveLine).toHaveCount(0);

  // A TikTok short link: the short-link copy on blur, and Continue refused in the browser with focus on the field.
  await tiktokLink.fill(TIKTOK_SHORT);
  await tiktokLink.blur();
  await expect(
    tiktok.getByText(
      "That's a short link. Open it in your browser, then copy the full address from the address bar.",
      { exact: true },
    ),
  ).toBeVisible();
  const actions = trackServerActions(page);
  await pressButton(page, "Continue");
  await expect(tiktokLink).toBeFocused();
  await waitInPage(page, 500);
  expect(actions).toEqual([]);
  await expect(page).toHaveURL(videoStepHref(videoId, "postings"));
  // TikTok's chip off takes its card and its link away (no confirm).
  await pressLocator(platformChip(page, "TikTok"));
  await expect(tiktok).toHaveCount(0);

  // Facebook, Other "Vimeo" and the creator's own Demo link.
  await pressLocator(platformChip(page, "Facebook"));
  const facebookLink = linkFields(postingCard(page, "facebook"));
  await facebookLink.fill(FB_REEL);
  await facebookLink.blur();
  await pressLocator(platformChip(page, "Other"));
  const other = postingCard(page, "other");
  await other
    .getByLabel("Where? (for example, Vimeo)", { exact: true })
    .fill("Vimeo");
  await linkFields(other).fill(VIMEO);
  await linkFields(other).blur();
  await pressLocator(platformChip(page, "Demo"));
  const demo = postingCard(page, "mock");
  await linkFields(demo).fill(ownLink);
  await linkFields(demo).blur();
  // Each card with a link that parses has its own "Show buyers this link", on by default (04 §9.33).
  for (const card of ["instagram", "facebook", "other", "mock"] as const) {
    await expect(linkFields(postingCard(page, card))).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(showLinkSwitch(postingCard(page, card))).toBeChecked();
  }
  expect(fetches).toEqual([]);

  // Continue saves and verifies on the server, then stays: Instagram needs the creator (07 D69, 04 §9.33).
  await pressAndSettle(page, "Continue");
  await expect(page).toHaveURL(videoStepHref(videoId, "postings"));
  await expect(
    postingCard(page, "mock").locator('[data-posting-result="verified"]'),
  ).toHaveText(VERIFIED_DEMO);
  await expect(
    postingCard(page, "instagram").getByText(
      "Not verified. Link your Instagram account to verify it.",
      { exact: true },
    ),
  ).toBeVisible();
  // Instagram isn't enabled on the e2e server, so there is nothing to link (04 §9.33).
  await expect(
    main.getByRole("link", { name: "Link Instagram", exact: true }),
  ).toHaveCount(0);
  await expect(
    postingCard(page, "facebook").getByText(
      "Links from Facebook, X and Snapchat can't be verified yet. Buyers will see “Not verified”.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    postingCard(page, "other").getByText(
      "Links from other sites can't be verified. Buyers will see the site name, for example vimeo.com.",
      { exact: true },
    ),
  ).toBeVisible();

  // One verified post: the same-video block, no warning (post 01 is 14 s), the tick, then Rights.
  await expectCoverBesidePost(page, videoId);
  await expect(main.getByText(ANY_WARNING)).toHaveCount(0);
  const tick = sameVideoTick(page);
  await expect(tick).not.toBeChecked();
  await tick.focus();
  await tick.press("Space");
  await expect(tick).toBeChecked();
  await pressButton(page, "Continue");
  await page.waitForURL(videoStepHref(videoId, "rights"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Rights" }),
  ).toBeVisible();

  // The page never asked another host for anything, least of all a pasted one (07 D67): only the e2e server.
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("J5.29: nothing chosen says where; “I haven't posted it anywhere yet.” disables the chips and goes to Rights", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);
  await attachSample(page);
  await continueToPostings(page, videoId);
  const main = page.locator("main");
  const chips = chipGroup(page).getByRole("button");
  // Demo is last while mock is enabled (the e2e server's ENABLED_SOCIAL_PROVIDERS=mock).
  await expect(chips).toHaveText([
    "Instagram",
    "TikTok",
    "YouTube",
    "Facebook",
    "X",
    "Snapchat",
    "Other",
    "Demo",
  ]);

  // Nothing chosen: "Say where it was posted" under the chips and said once, focus on the first chip, nothing sent (05
  // §6.5 States).
  const actions = trackServerActions(page);
  await pressButton(page, "Continue");
  await expect(nothingChosen(page)).toBeVisible();
  // Said once: the focused chip is described by the error, with no second alert line.
  await expect(platformChip(page, "Instagram")).toBeFocused();
  await expect(platformChip(page, "Instagram")).toHaveAccessibleDescription(
    NOTHING_CHOSEN,
  );
  await expect(
    page.getByRole("alert").filter({ hasText: NOTHING_CHOSEN }),
  ).toHaveCount(0);
  await waitInPage(page, 500);
  expect(actions).toEqual([]);
  await expect(page).toHaveURL(videoStepHref(videoId, "postings"));

  // Ticked: every chip aria-disabled; unticked: the chips come back, all off.
  const notPosted = main.getByLabel(NOT_POSTED, { exact: true });
  await notPosted.focus();
  await notPosted.press("Space");
  await expect(notPosted).toBeChecked();
  await expect(nothingChosen(page)).toHaveCount(0);
  for (const chip of await chips.all()) {
    await expect(chip).toHaveAttribute("aria-disabled", "true");
    await expect(chip).toHaveAttribute("aria-pressed", "false");
  }
  await notPosted.press("Space");
  await expect(notPosted).not.toBeChecked();
  for (const chip of await chips.all()) {
    await expect(chip).not.toHaveAttribute("aria-disabled", "true");
    await expect(chip).toHaveAttribute("aria-pressed", "false");
  }
  await notPosted.press("Space");
  await expect(notPosted).toBeChecked();

  await pressButton(page, "Continue");
  await page.waitForURL(videoStepHref(videoId, "rights"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Rights" }),
  ).toBeVisible();
  // Saved that way: Where posted reads it back ticked, with no card.
  await page.goto(videoStepHref(videoId, "postings"));
  await expect(main.getByLabel(NOT_POSTED, { exact: true })).toBeChecked();
  await expect(page.locator("[data-posting-card]")).toHaveCount(0);
  expect(errors).toEqual([]);
});
