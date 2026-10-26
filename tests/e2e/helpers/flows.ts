import { expect, type Locator, type Page } from "@playwright/test";
import { PUBLISHED_COPY, REVIEW_COPY } from "../../../src/lib/videos/review";
import { VIDEO_MENU_COPY } from "../../../src/lib/videos/video-page";
import { signUpCreator } from "./creator";
import { LIBRARY, libraryPostId, POST_01, tiles } from "./library";
import { isServerAction, pressButton, requestEnded } from "./press";
import {
  answerRights,
  attachSample,
  continueToPostings,
  continueToReview,
  continueToRights,
  makeLicensable,
  sameVideoTick,
} from "./videos";

// Whole creator flows the later specs start from (P14a; P15–P22 build on this file).

/** Review's success view (05 §6.5 States "Success"), once Publish has run. */
export const publishedView = (page: Page): Locator =>
  page.locator("[data-published-view]");

/** The video page (S19, P14b): `[data-video-aside]` (poster, title, link) and `[data-video-sections]` inside. */
export const videoPage = (page: Page): Locator =>
  page.locator("[data-video-page]");

/** Opens the card's Menu ("More for {title}") with the keyboard (04 §9.1); Edit takes the focus. */
export async function openCardMenu(page: Page, title: string) {
  await pressButton(page, VIDEO_MENU_COPY.more(title));
  await expect(
    page.getByRole("menuitem", { name: REVIEW_COPY.edit }),
  ).toBeFocused();
}

/** Opens the draft card's Delete draft sheet from its Menu with the keyboard, and returns the sheet once it shows. */
export async function openDeleteSheet(
  page: Page,
  title: string,
): Promise<Locator> {
  await openCardMenu(page, title);
  await page
    .getByRole("menuitem", { name: VIDEO_MENU_COPY.deleteDraft })
    .press("Enter");
  const sheet = page.getByRole("alertdialog", {
    name: VIDEO_MENU_COPY.deleteTitle,
  });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Chooses `item` in the open Menu with Enter and waits until its Server Action's request has closed. */
export async function chooseMenuAction(page: Page, item: string) {
  const closed = requestEnded(page, isServerAction);
  await page.getByRole("menuitem", { name: item, exact: true }).press("Enter");
  await closed;
}

/** A card on /dashboard/videos or /@handle, by its title. */
export const videoCard = (page: Page, title: string | RegExp): Locator =>
  page.locator("[data-video-card]").filter({ hasText: title });

/** Presses Review's Publish and waits for "Your video is live."; returns the link the view offers and its slug. */
export async function publish(
  page: Page,
): Promise<{ shareUrl: string; slug: string }> {
  await pressButton(page, "Publish");
  await expect(
    publishedView(page).getByRole("heading", {
      level: 1,
      name: PUBLISHED_COPY.live,
    }),
  ).toBeVisible();
  const shareUrl =
    (await publishedView(page).locator("bdi").textContent()) ?? "";
  return { shareUrl, slug: new URL(shareUrl).pathname.split("/").at(-1) ?? "" };
}

/**
 * A fresh creator with fake payouts and Demo linked publishes Demo post 01 through the UI (File with sample.mp4 →
 * Where posted with the source and the same-video tick → Rights, four answers (`rights`: No to both questions unless
 * given) → Review → Publish) and stays on the success view. Returns the creator's handle, the video's slug, the link to
 * share and the video's id.
 */
export async function publishDemoVideo(
  page: Page,
  rights: Parameters<typeof answerRights>[1] = {},
): Promise<{
  handle: string;
  slug: string;
  shareUrl: string;
  videoId: string;
}> {
  const { handle } = await signUpCreator(page, {
    payouts: true,
    connectDemo: true,
  });
  await page.goto(LIBRARY);
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
  await answerRights(page, rights);
  await continueToReview(page, videoId);
  return { handle, videoId, ...(await publish(page)) };
}
