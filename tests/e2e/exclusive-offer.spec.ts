import { expect, type Page, test } from "@playwright/test";
import { formatDelta, formatMoney } from "../../src/lib/format";
import { LICENSE_PAGE_COPY } from "../../src/lib/licensing/license-page";
import { EXCLUSIVE_COPY } from "../../src/lib/pricing/exclusive-copy";
import { DEFAULT_EXCLUSIVE_MULTIPLIER_BPS } from "../../src/lib/pricing/presets";
import { REVIEW_COPY } from "../../src/lib/videos/review";
import { videoHref } from "../../src/lib/videos/steps";
import { cad } from "../helpers/money";
import {
  availabilityNotice,
  BUYER_PHONE,
  choose,
  chooseDemoSelection,
  fillDetails,
  hydrated,
  licenseTypeGroup,
  optionTile,
  radio,
  requestButton,
  requestLicense,
} from "./helpers/buyer";
import { collectConsoleErrors } from "./helpers/console";
import { signUpCreator } from "./helpers/creator";
import {
  offerExclusive,
  publishDemoVideo,
  reviewPlainUpload,
} from "./helpers/flows";
import { expectNoBareDollar } from "./helpers/layout";
import { trackServerActions } from "./helpers/network";
import {
  pressAndSettle,
  pressAndSettleIn,
  pressButton,
  pressLocator,
  waitInPage,
} from "./helpers/press";
import {
  basePrice,
  exclusiveExamplePrice,
  exclusiveLine,
  exclusivePremium,
  exclusiveSection,
  exclusiveSwitch,
  PRICING,
  pickCombination,
  previewLine,
  pricePreview,
  pricesSavedToast,
  quoteLine,
  rateRow,
  setExclusiveSwitch,
} from "./helpers/pricing";
import {
  editorButton,
  exclusiveEditor,
  exclusiveField,
  exclusiveRadio,
  exclusiveSavedToast,
  exclusiveTile,
} from "./helpers/video-price";
import { cleanCreatedVideos, leaveIsGuarded } from "./helpers/videos";

// Offering exclusive licenses (P19e; 01 J12.1, J12.2, J12.15; 04 §9.29, §9.39; 05 §6.5 callout 57, §6.7 callout 13, §6.9
// callout 10; 07 D109, D127; owner answers Q-163–Q-166) on chromium-desktop and webkit-iphone. On the rate card the
// section starts off, the Switch shows the premium at ×3.00 with its example price and the preview's Exclusive line, the
// bounds refuse on Save with the focus on the field, and Reset turns it off at ×3.00. On a published video and on a plain
// upload's Review the choice and the premium are one draft (Q-163): an arrow key or a typed premium sends nothing, the
// preview follows, Save stores it and a reload reads it back, and an empty premium is the rate card's (Q-164). A buyer
// then sees the License type group (P19f) with Standard chosen at the standard price, and a press another buyer's request
// has overtaken lands on the notice (P19f; AD-67). Every Switch and radio is worked by keyboard. A later save reloads
// first, so the toast it reads is its own.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

/** Paid social ads · 1 year · Worldwide (CA$1,575.00 at the default base) with the premium: ×3.00, then ×4.00. */
const LINE_AT_3 = EXCLUSIVE_COPY.line(cad(472_500), cad(519_750));
const LINE_AT_4 = EXCLUSIVE_COPY.line(cad(630_000), cad(693_000));

const SAVE_PRICES = "Save prices";

/** Reloads with nothing left unsaved: a draft arms the leave guard, which would keep the page. */
async function reloadClean(page: Page) {
  await expect.poll(() => leaveIsGuarded(page)).toBe(false);
  await page.reload();
}

/** Presses the editor's Save: the toast shows, and with the saved offer back from the server its buttons go. */
async function saveOffer(page: Page) {
  const editor = exclusiveEditor(page);
  await pressAndSettleIn(page, editor, REVIEW_COPY.save);
  await expect(exclusiveSavedToast(page)).toBeVisible();
  await expect(editorButton(editor, REVIEW_COPY.save)).toHaveCount(0);
}

async function saveAndReload(page: Page) {
  await saveOffer(page);
  await reloadClean(page);
}

const cancelOffer = (page: Page) =>
  pressLocator(editorButton(exclusiveEditor(page), REVIEW_COPY.cancel));

/**
 * The field shows empty with its helper ("Leave empty to use your rate card's ×3.00."): the rate card's premium applies
 * (owner answer Q-164).
 */
async function expectEmptyField(page: Page) {
  await expect(exclusiveField(page)).toHaveValue("");
  await expect(
    exclusiveEditor(page).getByText(
      EXCLUSIVE_COPY.videoFieldHelper(DEFAULT_EXCLUSIVE_MULTIPLIER_BPS),
      { exact: true },
    ),
  ).toBeVisible();
}

/**
 * Types a premium past the bound and presses Save: the browser refuses it, nothing is sent, and the field says so and
 * takes the focus. The first match is the line under the field; the screen readers' alert after it repeats it. Cancel
 * then brings the empty field back and leaves the editor clean.
 */
async function expectAboveMaximumRefused(page: Page) {
  const editor = exclusiveEditor(page);
  const save = editorButton(editor, REVIEW_COPY.save);
  await exclusiveField(page).fill("10.05");
  await pressLocator(save);
  await expect(
    editor.getByText("Maximum is ×10.00.", { exact: true }).first(),
  ).toBeVisible();
  await expect(exclusiveField(page)).toBeFocused();
  await cancelOffer(page);
  await expectEmptyField(page);
  await expect(save).toHaveCount(0);
}

test("J12.1: the rate card's Exclusive licenses start off; on, the premium prices its example and the preview's line, its bounds refuse on Save, it saves, and Reset turns it off at ×3.00", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await signUpCreator(page, { payouts: false });
  await page.goto(PRICING);
  await expect(basePrice(page)).toBeVisible();

  // Off by default: the section, its Switch and helper, and no premium or Exclusive line anywhere.
  await expect(exclusiveSection(page)).toBeVisible();
  await expect(exclusiveSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(
    page.getByText(EXCLUSIVE_COPY.offerSwitchHelper, { exact: true }),
  ).toBeVisible();
  await expect(exclusivePremium(page)).toHaveCount(0);
  await expect(exclusiveLine(page)).toHaveCount(0);

  // On: the premium at ×3.00, its helper and example price, and the line under the standard one, which doesn't change.
  await setExclusiveSwitch(page, true);
  await expect(exclusivePremium(page)).toHaveValue("3.00");
  await expect(
    page.getByText(EXCLUSIVE_COPY.premiumHelper, { exact: true }),
  ).toBeVisible();
  await expect(exclusiveExamplePrice(page)).toHaveText(cad(45_000));
  await pickCombination(page, "Paid social ads", "1 year", "Worldwide");
  await expect(previewLine(page)).toHaveText(
    quoteLine(cad(157_500), cad(173_250), cad(15_750)),
  );
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_3);
  await expectNoBareDollar(page);

  // The line follows the typed premium without a reload; Perpetual has no exclusive price.
  await exclusivePremium(page).fill("4.00");
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_4);
  await pickCombination(page, "Paid social ads", "Perpetual", "Worldwide");
  await expect(exclusiveLine(page)).toHaveText(EXCLUSIVE_COPY.perpetualLine);
  await pickCombination(page, "Paid social ads", "1 year", "Worldwide");
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_4);

  // Save names a premium out of bounds (owner answer Q-91) under the field and moves the focus there; nothing is sent.
  const row = rateRow(page, EXCLUSIVE_COPY.premiumLabel);
  for (const [text, message] of [
    ["0.95", "Minimum is ×1.00."],
    ["3.33", "Use steps of 0.05."],
  ] as const) {
    await exclusivePremium(page).fill(text);
    await pressButton(page, SAVE_PRICES);
    await expect(row.getByText(message, { exact: true })).toBeVisible();
    await expect(exclusivePremium(page)).toBeFocused();
  }

  // Saved, it survives a reload.
  await exclusivePremium(page).fill("3.00");
  await pressAndSettle(page, SAVE_PRICES);
  await expect(pricesSavedToast(page)).toBeVisible();
  await reloadClean(page);
  await expect(basePrice(page)).toBeVisible();
  await expect(exclusiveSwitch(page)).toHaveAttribute("aria-checked", "true");
  await expect(exclusivePremium(page)).toHaveValue("3.00");
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_3);

  // Another premium saved; a reload takes its toast away, so the next one is Reset's.
  await exclusivePremium(page).fill("4.00");
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_4);
  await pressAndSettle(page, SAVE_PRICES);
  await expect(pricesSavedToast(page)).toBeVisible();
  await reloadClean(page);
  await expect(basePrice(page)).toBeVisible();

  // Reset to defaults asks with owner answer Q-165's sentence, then saves off at ×3.00. A press before the reloaded page
  // has hydrated is lost, so it is pressed again while the sheet isn't open.
  const sheet = page.getByRole("alertdialog", {
    name: "Reset prices to defaults?",
  });
  await expect(async () => {
    if (!(await sheet.isVisible())) {
      await pressButton(page, "Reset to defaults");
    }
    await expect(sheet).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 30_000 });
  await expect(
    sheet.getByText(
      EXCLUSIVE_COPY.resetSheet(
        formatMoney(15_000, "cad", { wholeDollars: true }),
      ),
      { exact: true },
    ),
  ).toBeVisible();
  await pressAndSettleIn(page, sheet, "Reset prices");
  await expect(sheet).toBeHidden();
  await expect(pricesSavedToast(page)).toBeVisible();
  await expect(exclusiveSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(exclusivePremium(page)).toHaveCount(0);

  // The premium went back too: on (unsaved) shows ×3.00, and off again leaves nothing unsaved.
  await setExclusiveSwitch(page, true);
  await expect(exclusivePremium(page)).toHaveValue("3.00");
  await setExclusiveSwitch(page, false);
  await expect(exclusivePremium(page)).toHaveCount(0);
  await reloadClean(page);
  await expect(basePrice(page)).toBeVisible();
  await expect(exclusiveSwitch(page)).toHaveAttribute("aria-checked", "false");
  await expect(exclusivePremium(page)).toHaveCount(0);
  await expect(exclusiveLine(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("J12.2: on a video page the exclusive choice and premium are a draft until Save, an empty premium is the rate card's, and a buyer gets the License type group with Standard chosen at the standard price", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  const { videoId, shareUrl } = await publishDemoVideo(page);
  await offerExclusive(page);
  await page.goto(videoHref(videoId));
  const editor = exclusiveEditor(page);
  const save = editorButton(editor, REVIEW_COPY.save);
  const rateCard = exclusiveRadio(page, "rate_card");
  const on = exclusiveRadio(page, "on");
  const off = exclusiveRadio(page, "off");

  // The video follows the card: its choice names the card's offer, and the line prices it.
  await expect(rateCard).toBeChecked();
  await expect(exclusiveTile(page, "rate_card")).toHaveText(
    EXCLUSIVE_COPY.useRateCard(true, DEFAULT_EXCLUSIVE_MULTIPLIER_BPS),
  );
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_3);

  // Arrow keys only draft (owner answer Q-163): the empty field and its helper, Save and Cancel, the leave guard armed;
  // "Don't offer" takes the line away; nothing is sent.
  const actions = trackServerActions(page);
  await rateCard.focus();
  await rateCard.press("ArrowDown");
  await expect(on).toBeChecked();
  await expectEmptyField(page);
  await expect(save).toBeVisible();
  await expect(editorButton(editor, REVIEW_COPY.cancel)).toBeVisible();
  await expect.poll(() => leaveIsGuarded(page)).toBe(true);
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_3);
  await on.press("ArrowDown");
  await expect(off).toBeChecked();
  await expect(exclusiveField(page)).toHaveCount(0);
  await expect(exclusiveLine(page)).toHaveCount(0);
  await waitInPage(page, 500);
  expect(actions).toEqual([]);

  // Cancel: back on the card, the line with it.
  await cancelOffer(page);
  await expect(rateCard).toBeChecked();
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_3);
  await expect(save).toHaveCount(0);

  // "Don't offer" saved: the line stays gone after a reload.
  await choose(page, "exclusiveOffer", "off");
  await expect(exclusiveLine(page)).toHaveCount(0);
  await saveOffer(page);
  await expect(exclusiveLine(page)).toHaveCount(0);
  await reloadClean(page);
  await expect(off).toBeChecked();
  await expect(exclusiveLine(page)).toHaveCount(0);

  // "Offer on this video" at ×4.00: the preview follows before any save, and a reload reads it back.
  await choose(page, "exclusiveOffer", "on");
  await expectEmptyField(page);
  const sentBefore = actions.length;
  await exclusiveField(page).fill("4.00");
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_4);
  await waitInPage(page, 500);
  expect(actions).toHaveLength(sentBefore);
  await saveAndReload(page);
  await expect(on).toBeChecked();
  await expect(exclusiveField(page)).toHaveValue("4.00");
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_4);

  // An empty premium is the rate card's (owner answer Q-164), as a draft and once saved.
  await exclusiveField(page).fill("");
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_3);
  await saveAndReload(page);
  await expect(on).toBeChecked();
  await expectEmptyField(page);
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_3);

  // Past the bound: refused under the field, and Cancel brings the empty field back.
  await expectAboveMaximumRefused(page);

  // Back on the card, with one preview and no bare dollar in the page.
  await choose(page, "exclusiveOffer", "rate_card");
  await expect(exclusiveField(page)).toHaveCount(0);
  await saveAndReload(page);
  await expect(rateCard).toBeChecked();
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_3);
  await expect(pricePreview(page)).toHaveCount(1);
  await expectNoBareDollar(page);

  // Logged out at 390 × 844: the License type group with Standard chosen, Exclusive's delta beside the demo selection,
  // which keeps the standard price until Exclusive is chosen.
  const context = await browser.newContext({ baseURL, viewport: BUYER_PHONE });
  const buyer = await context.newPage();
  const buyerErrors = collectConsoleErrors(buyer);
  await buyer.goto(shareUrl);
  await hydrated(buyer);
  await expect(licenseTypeGroup(buyer)).toBeVisible();
  await expect(radio(buyer, "exclusive", "false")).toBeChecked();
  await chooseDemoSelection(buyer);
  await expect(optionTile(buyer, "exclusive", "true")).toContainText(
    formatDelta(315_000, "cad"),
  );
  await expect(requestButton(buyer)).toHaveAccessibleName(
    LICENSE_PAGE_COPY.request(cad(173_250)),
  );
  await context.close();
  expect(buyerErrors).toEqual([]);
  expect(errors).toEqual([]);
});

test("AD-67: a press the video can't take any more, at 1280 × 720: the page turns to the notice from lg, in view and with the focus", async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "Only the focus on the copy from lg is tested here: jsdom can't tell the two copies apart.",
  );
  test.setTimeout(240_000);
  const { shareUrl } = await publishDemoVideo(page);
  await offerExclusive(page);

  // A buyer gets as far as the press, with the options on the page.
  const buyerContext = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 720 },
  });
  const buyer = await buyerContext.newPage();
  const errors = collectConsoleErrors(buyer);
  await buyer.goto(shareUrl);
  await hydrated(buyer);
  await choose(buyer, "territory", "worldwide");
  await fillDetails(buyer);
  const terms = buyer.getByRole("checkbox");
  await terms.focus();
  await terms.press("Space");

  // Another buyer's Exclusive reaches the fake checkout first, and stays there: its unpaid hold reserves the video.
  const otherContext = await browser.newContext({
    baseURL,
    viewport: BUYER_PHONE,
  });
  await requestLicense(await otherContext.newPage(), shareUrl, {
    use: "paid_social",
    term: "y1",
    territory: "worldwide",
    exclusive: true,
  });

  await pressLocator(requestButton(buyer));
  await expect(availabilityNotice(buyer)).toBeFocused();
  await expect(availabilityNotice(buyer)).toBeInViewport();
  await expect(
    buyer.locator("[data-license-side] [data-availability-notice]"),
  ).toBeHidden();
  await expect(buyer.locator("[data-pricebar]")).toHaveCount(0);
  await otherContext.close();
  await buyerContext.close();
  expect(errors).toEqual([]);
});

test("J12.2: on a plain upload's Review the exclusive choice is a draft too, saved over the rate card's off, read back after a reload, and refused past the bound", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  await reviewPlainUpload(page);
  const rateCard = exclusiveRadio(page, "rate_card");

  // The card is off: the choice says so, and the preview has no line.
  await expect(rateCard).toBeChecked();
  await expect(exclusiveTile(page, "rate_card")).toHaveText(
    EXCLUSIVE_COPY.useRateCard(false, DEFAULT_EXCLUSIVE_MULTIPLIER_BPS),
  );
  await expect(exclusiveLine(page)).toHaveCount(0);

  // "Offer on this video" with no premium is the card's ×3.00, as a draft and once saved; the preview opens on Paid
  // social ads · 1 year · Worldwide.
  await choose(page, "exclusiveOffer", "on");
  await expectEmptyField(page);
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_3);
  await saveAndReload(page);
  await expect(exclusiveRadio(page, "on")).toBeChecked();
  await expectEmptyField(page);
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_3);

  // A typed premium prices the draft, and Cancel drops it.
  await exclusiveField(page).fill("4.00");
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_4);
  await cancelOffer(page);
  await expectEmptyField(page);
  await expect(exclusiveLine(page)).toHaveText(LINE_AT_3);

  // Past the bound: refused under the field; Cancel leaves the editor clean.
  await expectAboveMaximumRefused(page);
  await expectNoBareDollar(page);
  expect(errors).toEqual([]);
});
