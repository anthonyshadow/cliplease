import { expect, type Locator, type Page } from "@playwright/test";
import {
  MUSIC_DISABLED_USES,
  type MusicUseKey,
} from "../../../src/lib/videos/rights";
import { VIDEO_PRICE_COPY } from "../../../src/lib/videos/video-price";
import { radio } from "./buyer";

// The Prices section's VideoPriceEditor and music Switches (P19d; 04 §9.29; 05 §6.5 callouts 38 and 47, §6.7 callouts 8
// and 11; 07 D82) on the Review and the video page, and the music Switches of the Rights step.

/** "rate_card" ("Use my rate card (CA$150)") or "video" ("Set a base price for this video"). */
export type BasePriceChoice = "rate_card" | "video";

/** A base-price choice's radio (the editor's `name="basePrice"`). */
export const basePriceRadio = (page: Page, choice: BasePriceChoice) =>
  radio(page, "basePrice", choice);

/** A base-price choice's tile label: stretched over the tile, it is the 44 px target. */
export const basePriceTile = (page: Page, choice: BasePriceChoice) =>
  basePriceRadio(page, choice).locator("xpath=ancestor::label[1]");

/** One music Switch inside `scope`, by the use it turns back on ("Allow Paid social ads anyway"). */
export const musicSwitch = (scope: Page | Locator, key: MusicUseKey) =>
  scope.getByRole("switch", {
    name: VIDEO_PRICE_COPY.allowAnyway(key),
    exact: true,
  });

/** The music Switches' controls inside `scope` (`[data-music-switches]`), in order. */
export const musicSwitchControls = (scope: Page | Locator) =>
  scope.locator("[data-music-switches] [role=switch]");

/**
 * `scope` holds two Switches and no other: the music ones, Paid social ads then TV / broadcast (MUSIC_DISABLED_USES'
 * order), each on or off as `on` says.
 */
export async function expectMusicSwitches(
  scope: Page | Locator,
  on: Record<MusicUseKey, boolean>,
) {
  const switches = scope.getByRole("switch");
  await expect(switches).toHaveCount(MUSIC_DISABLED_USES.length);
  for (const [n, key] of MUSIC_DISABLED_USES.entries()) {
    await expect(switches.nth(n)).toHaveAccessibleName(
      VIDEO_PRICE_COPY.allowAnyway(key),
    );
    await expect(switches.nth(n)).toHaveAttribute(
      "aria-checked",
      String(on[key]),
    );
  }
}
