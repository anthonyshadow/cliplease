import { expect, test } from "@playwright/test";
import { POSTINGS_COPY } from "../../src/lib/postings/copy";
import { videoUrl } from "../../src/lib/urls";
import { BADGE_COPY } from "../../src/lib/videos/ownership";
import { PUBLISHED_COPY } from "../../src/lib/videos/review";
import { sourcePageHref, videoHref } from "../../src/lib/videos/steps";
import { OBJECT_KEY } from "../helpers/object-key";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import { publish, publishedView, videoCard } from "./helpers/flows";
import {
  LIBRARY,
  libraryPostId,
  POST_01,
  tileByCaption,
  tileLink,
  tiles,
  waitForLibrary,
} from "./helpers/library";
import { countPresses, pressLink, pressLocator } from "./helpers/press";
import {
  answerRights,
  attachSample,
  cleanCreatedVideos,
  continueToPostings,
  continueToReview,
  continueToRights,
  createDraft,
  DRAFT_TITLE,
  makeLicensable,
  sameVideoTick,
} from "./helpers/videos";

// Publish and share (P14a; 01 J5.17, J5.18, J6; 05 §6.5 callouts 52–56, §6.8, §4.6; 07 D69, D74, D89) on
// chromium-desktop and webkit-iphone. A creator with fake payouts publishes Demo post 01 step by step, counting the
// screens and taps from the Library tile to "Link copied" as 05 §6.5 lists them (S10: ≤ 5 and ≤ 13; "Choose file"
// counts, the OS file picker and the upload time don't); the link copies (the clipboard is read on Chromium, WebKit grants no clipboard permission), the card
// on /dashboard/videos is Live and verified, and a logged-out phone sees the card on /@handle with its poster and no
// object key in the page. A creator without payouts publishes a plain upload posted nowhere: it goes live,
// self-attested (07 D74, D89).
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

test("J5.17, J6: Demo post 01 published from its Library tile, its link copied, Live on Videos and public on /@handle", async ({
  page,
  browser,
  browserName,
  baseURL,
}, testInfo) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  if (browserName === "chromium") {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  const { handle } = await signUpCreator(page, {
    payouts: true,
    connectDemo: true,
  });
  // To the Library through the nav (a client navigation, as a creator gets there): a tile pressed on a page still
  // hydrating after a full load can lose its navigation to the router's own history update.
  await pressLink(page, "Library");
  await waitForLibrary(page);
  await expect(tiles(page)).toHaveCount(24);
  const postId = await libraryPostId(page, POST_01);

  // S10 from the tile tap: every address the main frame shows after the Library, and every press.
  const screens = new Set<string>();
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const { pathname, search } = new URL(frame.url());
    if (pathname !== LIBRARY) screens.add(pathname + search);
  });
  const presses = await countPresses(page);
  await pressLocator(tileLink(tileByCaption(page, POST_01)));
  await page.waitForURL(sourcePageHref(postId));
  const videoId = await makeLicensable(page, postId);
  // "Choose file" counts (05 §6.5's S10 list) though the test sets the file directly; the OS picker and the upload don't.
  const chooseFile = 1;
  const coverOrigin = await attachSample(page);
  // WebKit in the test can't read a frame of sample.mp4, so it sets a cover too: a pick the product flow doesn't need
  // (a real browser captures the frame), logged apart and not counted.
  const coverPick = coverOrigin === "creator_image" ? 1 : 0;
  await continueToPostings(page, videoId);
  const tick = sameVideoTick(page);
  await tick.focus();
  await tick.press("Space");
  await continueToRights(page, videoId);
  await answerRights(page);
  await continueToReview(page, videoId);
  const { shareUrl, slug } = await publish(page);
  const view = publishedView(page);
  await expect(
    view.getByText("Verified · @demo.creator (demo account)", { exact: true }),
  ).toBeVisible();
  await view.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(view.getByText("Link copied", { exact: true })).toHaveCount(1);
  await expect(view.getByRole("button", { name: "Copied" })).toBeVisible();

  expect(shareUrl).toBe(new URL(videoUrl(handle, slug), baseURL).href);
  if (browserName === "chromium") {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      shareUrl,
    );
  }
  // "Share…" only where the browser can share.
  const canShare = await page.evaluate(
    () => typeof navigator.share === "function",
  );
  await expect(view.getByRole("button", { name: "Share…" })).toHaveCount(
    canShare ? 1 : 0,
  );
  const taps = presses() + chooseFile;
  const count = `${screens.size} screens (${[...screens].join(", ")}), ${taps} taps (+${coverPick} cover pick, cover: ${coverOrigin})`;
  testInfo.annotations.push({ type: "S10", description: count });
  console.log(`S10 [${testInfo.project.name}]: ${count}`);
  expect(screens.size).toBeLessThanOrEqual(5);
  expect(taps).toBeLessThanOrEqual(13);

  await expect(
    view.getByRole("link", { name: PUBLISHED_COPY.openVideo }),
  ).toHaveAttribute("href", videoHref(videoId));

  // /dashboard/videos: the card, Live, verified, with its price.
  await page.goto("/dashboard/videos");
  const card = videoCard(page, POST_01);
  await expect(card.getByText("Live", { exact: true })).toBeVisible();
  await expect(
    card.getByText("Verified · @demo.creator (demo account)", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText("From CA$150.00", { exact: true })).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Copy link", exact: true }),
  ).toBeVisible();

  // A logged-out phone: the card on /@handle with its poster, no sign-in, no object key in the page.
  const visitor = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  const phone = await visitor.newPage();
  const visitorErrors = collectConsoleErrors(phone);
  const response = await phone.goto(`/@${handle}`);
  expect(response?.status()).toBe(200);
  expect(await response?.text()).not.toMatch(OBJECT_KEY);
  const publicCard = phone.locator("[data-video-card]");
  await expect(publicCard).toHaveCount(1);
  await expect(publicCard.getByRole("link")).toHaveAttribute(
    "href",
    videoUrl(handle, slug),
  );
  const poster = publicCard.getByRole("img", {
    name: /^Poster for He saw snow/,
  });
  await expect
    .poll(() => poster.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(phone.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await visitor.close();
  expect(visitorErrors).toEqual([]);
  expect(errors).toEqual([]);
});

test("J5.17, D74: a creator without payouts publishes an upload posted nowhere; it is Live and self-attested", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);
  await attachSample(page);
  await continueToPostings(page, videoId);
  const notPosted = page
    .locator("main")
    .getByLabel(POSTINGS_COPY.notPosted, { exact: true });
  await notPosted.focus();
  await notPosted.press("Space");
  await continueToRights(page, videoId);
  await answerRights(page);
  await continueToReview(page, videoId);
  await publish(page);
  await expect(
    publishedView(page).getByText(BADGE_COPY.selfAttested, { exact: true }),
  ).toBeVisible();

  await page.goto("/dashboard/videos");
  const card = videoCard(page, DRAFT_TITLE);
  await expect(card.getByText("Live", { exact: true })).toBeVisible();
  await expect(
    card.getByText(BADGE_COPY.selfAttested, { exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
