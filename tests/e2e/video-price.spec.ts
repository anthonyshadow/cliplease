import { expect, type Page, test } from "@playwright/test";
import { USE_KEYS } from "../../src/lib/domain/values";
import { formatMoney } from "../../src/lib/format";
import { LICENSE_V1_SUMMARY } from "../../src/lib/legal/license-v1-summary";
import { LICENSE_PAGE_COPY } from "../../src/lib/licensing/license-page";
import { rateOptionLabel } from "../../src/lib/licensing/options";
import { scopeLabel } from "../../src/lib/licensing/selection";
import { fromPriceText } from "../../src/lib/pricing/from-price";
import { editRowLabel, REVIEW_COPY } from "../../src/lib/videos/review";
import { MUSIC_DISABLED_USES, RIGHTS_COPY } from "../../src/lib/videos/rights";
import { videoHref } from "../../src/lib/videos/steps";
import {
  fromPriceLine,
  VIDEO_PAGE_COPY,
} from "../../src/lib/videos/video-page";
import { VIDEO_PRICE_COPY } from "../../src/lib/videos/video-price";
import { cad } from "../helpers/money";
import {
  BUYER_PHONE,
  choose,
  chooseDemoSelection,
  hydrated,
  optionTile,
  radio,
  requestButton,
} from "./helpers/buyer";
import { collectConsoleErrors } from "./helpers/console";
import { buyLicense, publishDemoVideo } from "./helpers/flows";
import { expectNoBareDollar } from "./helpers/layout";
import { trackServerActions } from "./helpers/network";
import {
  isServerAction,
  pressAndSettle,
  pressAndSettleIn,
  pressLink,
  requestEnded,
  waitInPage,
} from "./helpers/press";
import { previewLine, quoteLine } from "./helpers/pricing";
import {
  baseField,
  basePriceRadio,
  expectMusicSwitches,
  musicSwitch,
  pricesSection,
} from "./helpers/video-price";
import {
  answerRights,
  cleanCreatedVideos,
  expectRightsStep,
  leaveIsGuarded,
  rightsAnswer,
  stepColumn,
} from "./helpers/videos";

// The per-video base price and the music re-enable (P19d; 01 J4.8, J5.14, J7.4; 04 §9.29; 05 §6.5 callout 38, §6.7
// callouts 8 and 11; 07 D82, D98; owner answers Q-158, Q-161, Q-162) on chromium-desktop and webkit-iphone, each test
// from its own Demo post 01 published through the UI (publishDemoVideo). A video's own base price is a draft until Save:
// an arrow key or a choice sends nothing and arms the leave guard, the preview under the editor follows the typed
// amount, and once saved it prices the From line, the /@handle card and a logged-out buyer's license page; "Use my rate
// card (CA$150)" and Save bring the card's base back. On a music video "Allow Paid social ads anyway" saves on toggle,
// and a buyer can then license Paid social ads with the music left out (the summary's Music row) while TV / broadcast
// stays off. On a published music video's Rights step a Switch posts with Continue. Every radio and Switch is worked by
// keyboard; the editor is left clean (Save) before any navigation, since a draft arms the beforeunload guard.
test.use({ reducedMotion: "reduce" });
test.afterEach(cleanCreatedVideos);

/** The PriceBar's lines: "License CA$300.00 · Service fee CA$30.00". */
const priceLines = (license: number, fee: number) =>
  `${LICENSE_PAGE_COPY.license(cad(license))} · ${LICENSE_PAGE_COPY.serviceFee(cad(fee))}`;

/** The From line's uses: "Organic social repost", "Paid social ads", "TV / broadcast". */
const ALL_USES = USE_KEYS.map((key) => rateOptionLabel(key));
const DEMO_SCOPE = scopeLabel({
  useKey: "paid_social",
  termKey: "y1",
  territoryKey: "worldwide",
  territoryCode: null,
});

/** The license summary's "Music" row (Not included), shown only for a video with music. */
const MUSIC_ROW = LICENSE_V1_SUMMARY.groups
  .flatMap((group) => group.rows)
  .find((row) => row.when === "contains_music");

/** The Prices section's "From {price} · {uses}" line. */
const fromLine = (page: Page) => page.locator("[data-from-line]");

const savedToast = (page: Page) =>
  page.getByText(VIDEO_PAGE_COPY.saved, { exact: true });

test("J4.8: a video's own base price is a draft until Save, then prices its From line, its /@handle card and the license page; Use my rate card and Save bring the card's price back", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  const { videoId, handle, shareUrl } = await publishDemoVideo(page);
  await page.goto(videoHref(videoId));
  const prices = pricesSection(page);
  const rateCard = basePriceRadio(page, "rate_card");
  const own = basePriceRadio(page, "video");
  const save = prices.getByRole("button", {
    name: REVIEW_COPY.save,
    exact: true,
  });

  // The rate card's base, on the radio's tile with its currency; one preview, then the From line (owner answer Q-162).
  await expect(rateCard).toBeChecked();
  await expect(optionTile(page, "basePrice", "rate_card")).toHaveText(
    VIDEO_PRICE_COPY.useRateCard(
      formatMoney(15_000, "cad", { wholeDollars: true }),
    ),
  );
  await expect(own).not.toBeChecked();
  await expect(baseField(page)).toHaveCount(0);
  await expect(save).toHaveCount(0);
  await expect(prices.locator("[data-price-preview]")).toHaveCount(1);
  await expect(fromLine(page)).toHaveText(
    fromPriceLine(15_000, "cad", ALL_USES),
  );
  await expectNoBareDollar(page);

  // An arrow key moves to "Set a base price for this video" and only drafts (owner answer Q-161): the field holds the
  // card's base, Save and Cancel show, leaving would ask first, and nothing is sent.
  const actions = trackServerActions(page);
  await rateCard.focus();
  await rateCard.press("ArrowDown");
  await expect(own).toBeChecked();
  await expect(own).toBeFocused();
  await expect(baseField(page)).toHaveValue("150");
  await expect(save).toBeVisible();
  await expect(
    prices.getByRole("button", { name: REVIEW_COPY.cancel, exact: true }),
  ).toBeVisible();
  await expect.poll(() => leaveIsGuarded(page)).toBe(true);
  await waitInPage(page, 500);
  expect(actions).toEqual([]);

  // The preview follows the typed amount (Paid social ads · 1 year · Worldwide); Save stores it.
  await baseField(page).fill("300");
  await expect(previewLine(page)).toHaveText(
    quoteLine(cad(315_000), cad(346_500), cad(31_500)),
  );
  await pressAndSettleIn(page, prices, REVIEW_COPY.save);
  await expect(savedToast(page)).toBeVisible();
  await expect(fromLine(page)).toHaveText(
    fromPriceLine(30_000, "cad", ALL_USES),
  );
  await expect(save).toHaveCount(0);
  await expect.poll(() => leaveIsGuarded(page)).toBe(false);

  // Logged out at 390 × 844: the /@handle card, then the license page's first load and the demo selection at CA$300.
  const context = await browser.newContext({ baseURL, viewport: BUYER_PHONE });
  const buyer = await context.newPage();
  const buyerErrors = collectConsoleErrors(buyer);
  await buyer.goto(`/@${handle}`);
  const card = buyer.locator("[data-video-card]");
  await expect(card).toHaveCount(1);
  await expect(
    card.getByText(fromPriceText(30_000, "cad"), { exact: true }),
  ).toBeVisible();
  await buyer.goto(shareUrl);
  await hydrated(buyer);
  const lines = buyer.locator("[data-pricebar] [data-price-lines]");
  await expect(lines).toHaveText(priceLines(30_000, 3_000));
  await expect(
    buyer.locator("[data-pricebar] [data-price-total]"),
  ).toContainText(LICENSE_PAGE_COPY.total(cad(33_000)));
  await expect(requestButton(buyer)).toHaveAccessibleName(
    LICENSE_PAGE_COPY.country.choose,
  );
  await chooseDemoSelection(buyer);
  await expect(lines).toHaveText(priceLines(315_000, 31_500));
  await expect(requestButton(buyer)).toHaveAccessibleName(
    LICENSE_PAGE_COPY.request(cad(346_500)),
  );

  // A fresh load reads the stored price back (the first Save's toast gone with it); choosing "Use my rate card (CA$150)"
  // only drafts: the preview is back at the card's base, but nothing is sent and nothing says Saved. until Save.
  await page.reload();
  await expect(own).toBeChecked();
  await expect(baseField(page)).toHaveValue("300");
  await expect(save).toHaveCount(0);
  const choosing = trackServerActions(page);
  await choose(page, "basePrice", "rate_card");
  await expect(baseField(page)).toHaveCount(0);
  await expect(previewLine(page)).toHaveText(
    quoteLine(cad(157_500), cad(173_250), cad(15_750)),
  );
  await waitInPage(page, 500);
  expect(choosing).toEqual([]);
  await expect(savedToast(page)).toHaveCount(0);
  await pressAndSettleIn(page, prices, REVIEW_COPY.save);
  await expect(savedToast(page)).toBeVisible();
  await expect(fromLine(page)).toHaveText(
    fromPriceLine(15_000, "cad", ALL_USES),
  );
  await expect(save).toHaveCount(0);

  // The buyer's next load is back on the card: CA$1,732.50 for the demo selection (07 D79's golden).
  await buyer.reload();
  await hydrated(buyer);
  await chooseDemoSelection(buyer);
  await expect(lines).toHaveText(priceLines(157_500, 15_750));
  await expect(requestButton(buyer)).toHaveAccessibleName(
    LICENSE_PAGE_COPY.request(cad(173_250)),
  );
  await context.close();
  expect(buyerErrors).toEqual([]);
  expect(errors).toEqual([]);
});

test("J5.14, J7.4: on a music video, Allow Paid social ads anyway saves on toggle, and a buyer licenses Paid social ads with the music left out while TV / broadcast stays off", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  if (!MUSIC_ROW) throw new Error("License v1's summary has no music row");
  const errors = collectConsoleErrors(page);
  const { videoId, shareUrl } = await publishDemoVideo(page, {
    music: "Yes",
  });

  // The buyer first: both music uses off, each saying why (01 J7.4).
  const context = await browser.newContext({ baseURL, viewport: BUYER_PHONE });
  const buyer = await context.newPage();
  const buyerErrors = collectConsoleErrors(buyer);
  await buyer.goto(shareUrl);
  await hydrated(buyer);
  for (const key of MUSIC_DISABLED_USES) {
    await expect(radio(buyer, "use", key)).toBeDisabled();
    await expect(optionTile(buyer, "use", key)).toContainText(
      LICENSE_PAGE_COPY.musicDisabled,
    );
  }

  // The video page: both Switches off, the helper once under them, Organic alone on the From line.
  await page.goto(videoHref(videoId));
  const prices = pricesSection(page);
  await expectMusicSwitches(prices, { paid_social: false, broadcast: false });
  const helper = prices.getByText(VIDEO_PRICE_COPY.musicHelper, {
    exact: true,
  });
  await expect(helper).toHaveCount(1);
  await expect(helper).toBeVisible();
  await expect(fromLine(page)).toHaveText(
    fromPriceLine(15_000, "cad", [rateOptionLabel("organic_social")]),
  );

  // Space on "Allow Paid social ads anyway" saves it at once (05 §6.7 Interaction): Saved., on, and on the From line.
  const paid = musicSwitch(prices, "paid_social");
  const saved = requestEnded(page, isServerAction);
  await paid.focus();
  await paid.press("Space");
  await saved;
  await expect(savedToast(page)).toBeVisible();
  await expect(paid).toHaveAttribute("aria-checked", "true");
  await expect(musicSwitch(prices, "broadcast")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(fromLine(page)).toHaveText(
    fromPriceLine(15_000, "cad", [
      rateOptionLabel("organic_social"),
      rateOptionLabel("paid_social"),
    ]),
  );
  await page.reload();
  await expectMusicSwitches(prices, { paid_social: true, broadcast: false });

  // The buyer's next load: Paid social ads is on, TV / broadcast still off, the music notice stays; the summary of
  // Paid social ads · 1 year · Worldwide leaves the music out.
  await buyer.reload();
  await hydrated(buyer);
  await expect(radio(buyer, "use", "paid_social")).toBeEnabled();
  await expect(optionTile(buyer, "use", "paid_social")).not.toContainText(
    LICENSE_PAGE_COPY.musicDisabled,
  );
  await expect(radio(buyer, "use", "broadcast")).toBeDisabled();
  await expect(optionTile(buyer, "use", "broadcast")).toContainText(
    LICENSE_PAGE_COPY.musicDisabled,
  );
  await expect(
    buyer.getByText(LICENSE_PAGE_COPY.music.title, { exact: true }),
  ).toBeVisible();
  await chooseDemoSelection(buyer);
  await expect(buyer.getByText(MUSIC_ROW.text, { exact: true })).toBeVisible();
  await context.close();
  expect(buyerErrors).toEqual([]);

  // A paid request for Paid social ads waits for the creator and reaches the Inbox with its scope.
  const bought = await buyLicense(browser, shareUrl, {
    use: "paid_social",
    term: "y1",
    territory: "worldwide",
  });
  await bought.context.close();
  await page.goto("/dashboard");
  const row = page.locator("[data-inbox-row]");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(DEMO_SCOPE);
  expect(errors).toEqual([]);
});

test("J5.14: on a published music video's Rights step a Switch turns its use back on with Continue", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectConsoleErrors(page);
  const { videoId } = await publishDemoVideo(page, { music: "Yes" });

  // The video page's Rights Edit (no request, no license: not locked): music Yes, both Switches off, the footnote.
  await page.goto(videoHref(videoId));
  await pressLink(page, editRowLabel(VIDEO_PAGE_COPY.rights));
  await expectRightsStep(page, videoId);
  await expect(
    rightsAnswer(page, RIGHTS_COPY.musicQuestion, "Yes"),
  ).toBeChecked();
  const rights = stepColumn(page, "rights");
  await expectMusicSwitches(rights, { paid_social: false, broadcast: false });
  const footnote = page.getByText(RIGHTS_COPY.musicFootnote, { exact: true });
  await expect(footnote).toBeVisible();

  // TV / broadcast on: the footnote goes (it says both uses are off). The boxes are ticked again (owner answer Q-99 a).
  const tv = musicSwitch(rights, "broadcast");
  await tv.focus();
  await tv.press("Space");
  await expect(tv).toHaveAttribute("aria-checked", "true");
  await expect(footnote).toHaveCount(0);
  await answerRights(page, { music: "Yes" });
  await expect(tv).toHaveAttribute("aria-checked", "true");
  await pressAndSettle(page, "Continue");
  await page.waitForURL(videoHref(videoId));

  // Back on the video page: TV / broadcast on, Paid social ads off, and the From line says so.
  const prices = pricesSection(page);
  await expectMusicSwitches(prices, { paid_social: false, broadcast: true });
  await expect(fromLine(page)).toHaveText(
    fromPriceLine(15_000, "cad", [
      rateOptionLabel("organic_social"),
      rateOptionLabel("broadcast"),
    ]),
  );
  expect(errors).toEqual([]);
});
