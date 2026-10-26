import { expect, type Page, test } from "@playwright/test";
import { POSTINGS_COPY } from "../../src/lib/postings/copy";
import {
  editRowLabel,
  PUBLISHED_COPY,
  REVIEW_COPY,
} from "../../src/lib/videos/review";
import { videoHref, videoStepHref } from "../../src/lib/videos/steps";
import {
  requestsLine,
  VIDEO_MENU_COPY,
  VIDEO_PAGE_COPY,
} from "../../src/lib/videos/video-page";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  chooseMenuAction,
  openCardMenu,
  openDeleteSheet,
  publishDemoVideo,
  videoCard,
  videoPage,
} from "./helpers/flows";
import { expectSheetForm, viewportWidth } from "./helpers/layout";
import { POST_01 } from "./helpers/library";
import { pressAndSettle, pressLink, pressLocator } from "./helpers/press";
import {
  cleanCreatedVideos,
  createDraft,
  DRAFT_TITLE,
  platformChip,
} from "./helpers/videos";

// The video page and the Videos Menu (P14b; 01 J5.19–J5.21, J6.1; 05 §6.7, §6.8; 07 D09, D69, D72) on chromium-desktop
// and webkit-iphone. A creator with fake payouts publishes Demo post 01 (publishDemoVideo) and opens its page: the link
// copies; Turn off shows «Off» and its Banner, takes the card off /@handle for a logged-out visitor and the poster off
// the public route, and opens Where posted for editing; Turn on brings it all back; the card's Menu turns it off and on
// too. A second creator deletes a plain-upload draft from the Menu through its ConfirmSheet.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

const STATUS_PILL = (page: Page, label: string) =>
  page.locator("[data-video-aside]").getByText(label, { exact: true });

test("J5.19, J5.20, J6.1: the live video's page, Copy, Turn off and Turn on, from the page and from the Menu", async ({
  page,
  browser,
  browserName,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  if (browserName === "chromium") {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
  }
  const { handle, videoId, shareUrl } = await publishDemoVideo(page);
  // To the page by its link (a client navigation, as the creator gets there).
  await pressLink(page, PUBLISHED_COPY.openVideo);
  await page.waitForURL(videoHref(videoId));
  const view = videoPage(page);
  const sections = view.locator("[data-video-sections]");
  const heading = view.getByRole("heading", { level: 1, name: /^He saw snow/ });
  await expect(heading).toBeVisible();
  const title = (await heading.textContent()) ?? "";
  await expect(STATUS_PILL(page, "Live")).toBeVisible();
  await expect(
    view.getByText("Verified · @demo.creator (demo account)", { exact: true }),
  ).toBeVisible();
  await expect(sections.getByText(requestsLine(0, 0))).toBeVisible();
  await expect(sections.getByText(POSTINGS_COPY.locked)).toBeVisible();
  await expect(
    sections.getByRole("link", { name: editRowLabel(REVIEW_COPY.wherePosted) }),
  ).toHaveCount(0);
  await expect(sections.getByText(VIDEO_PAGE_COPY.replaceLocked)).toBeVisible();

  // View license page ↗ opens the buyer's page in a new tab (05 §6.7 callout 3; owner answer Q-116 a).
  const licensePage = view.getByRole("link", {
    name: VIDEO_PAGE_COPY.viewLicensePageLabel,
    exact: true,
  });
  await expect(licensePage).toHaveText(VIDEO_PAGE_COPY.viewLicensePage);
  await expect(licensePage).toHaveAttribute("href", shareUrl);
  await expect(licensePage).toHaveAttribute("target", "_blank");

  // Copy (J6.1): "Copied" on the button, "Link copied" said politely, the link in the clipboard where it can be read.
  await view.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(view.getByText("Link copied", { exact: true })).toHaveCount(1);
  await expect(view.getByRole("button", { name: "Copied" })).toBeVisible();
  if (browserName === "chromium") {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      shareUrl,
    );
  }

  // A logged-out visitor sees the card on /@handle and its poster.
  const visitor = await browser.newContext();
  const phone = await visitor.newPage();
  const visitorErrors = collectConsoleErrors(phone);
  await phone.goto(`/@${handle}`);
  await expect(phone.locator("[data-video-card]")).toHaveCount(1);
  const posterSrc = await view
    .locator("[data-video-aside] img")
    .first()
    .getAttribute("src");
  const poster = new URL(posterSrc ?? "", baseURL).href;
  expect((await visitor.request.get(poster)).status()).toBe(200);

  // Turn off: «Off», its Banner, the focus kept on the button now reading Turn on; gone from /@handle, poster and all.
  await pressAndSettle(page, VIDEO_PAGE_COPY.turnOff);
  await expect(STATUS_PILL(page, "Off")).toBeVisible();
  await expect(sections.getByText(VIDEO_PAGE_COPY.off)).toBeVisible();
  await expect(
    page.getByRole("button", { name: VIDEO_PAGE_COPY.turnOn }),
  ).toBeFocused();
  await phone.reload();
  await expect(
    phone.getByText("No videos yet.", { exact: true }),
  ).toBeVisible();
  await expect(phone.locator("[data-video-card]")).toHaveCount(0);
  expect((await visitor.request.get(poster)).status()).toBe(404);

  // Off, Where posted is editable (07 D69): Edit opens the step, Back comes back.
  await expect(sections.getByText(POSTINGS_COPY.locked)).toHaveCount(0);
  await pressLink(page, editRowLabel(REVIEW_COPY.wherePosted));
  await page.waitForURL(videoStepHref(videoId, "postings"));
  await expect(platformChip(page, "Instagram")).toBeEnabled();
  await pressLink(page, "Back");
  await page.waitForURL(videoHref(videoId));

  // Turn on runs the blockers again (none here): Live, and back on /@handle.
  await pressAndSettle(page, VIDEO_PAGE_COPY.turnOn);
  await expect(STATUS_PILL(page, "Live")).toBeVisible();
  await phone.reload();
  await expect(phone.locator("[data-video-card]")).toHaveCount(1);
  expect((await visitor.request.get(poster)).status()).toBe(200);

  // The Videos Menu turns it off and on too (05 §6.8 Interaction).
  await pressLocator(
    page.locator("main").getByRole("link", { name: "Videos", exact: true }),
  );
  await page.waitForURL("/dashboard/videos");
  const card = videoCard(page, POST_01);
  await openCardMenu(page, title);
  await chooseMenuAction(page, VIDEO_PAGE_COPY.turnOff);
  await expect(card.getByText("Off", { exact: true })).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Copy link", exact: true }),
  ).toBeVisible();
  await openCardMenu(page, title);
  await chooseMenuAction(page, VIDEO_PAGE_COPY.turnOn);
  await expect(card.getByText("Live", { exact: true })).toBeVisible();

  await visitor.close();
  expect(visitorErrors).toEqual([]);
  expect(errors).toEqual([]);
});

test("J5.21: a draft deleted from the Videos Menu through its ConfirmSheet, the focus kept", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  const videoId = await createDraft(page);
  // To the list by the nav (a client navigation): the File step's own link reads "Back".
  await pressLink(page, "Videos");
  await page.waitForURL("/dashboard/videos");
  const card = videoCard(page, DRAFT_TITLE);
  await expect(card.getByText("Draft", { exact: true })).toBeVisible();
  const more = page.getByRole("button", {
    name: VIDEO_MENU_COPY.more(DRAFT_TITLE),
  });

  // The Menu by keyboard: Edit first, then Delete draft; Escape gives the focus back to "···".
  await openCardMenu(page, DRAFT_TITLE);
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: VIDEO_MENU_COPY.deleteDraft }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toBeHidden();
  await expect(more).toBeFocused();

  // The sheet: the safe button focused; Escape closes it and the focus goes back to "···".
  const sheet = await openDeleteSheet(page, DRAFT_TITLE);
  await expectSheetForm(sheet, viewportWidth(page));
  await expect(
    sheet.getByRole("button", { name: VIDEO_MENU_COPY.keepDraft }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(more).toBeFocused();

  // Delete draft: the card goes, and with no video left the empty state's title takes the focus.
  await openDeleteSheet(page, DRAFT_TITLE);
  await pressAndSettle(page, VIDEO_MENU_COPY.deleteDraft);
  await expect(card).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: /^Videos\. Nothing/ }),
  ).toBeFocused();
  expect((await page.request.get(videoHref(videoId))).status()).toBe(404);
  expect(errors).toEqual([]);
});
