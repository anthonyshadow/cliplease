// The Prices section's per-video base and music Switches (04 §9.29; 07 D82): their words and which Switches show. Pure.
import type { EffectiveOptions } from "../../server/pricing/rate-card";
import { rateOptionLabel } from "../licensing/options";
import { MUSIC_DISABLED_USES, type MusicUseKey } from "./rights";

/**
 * 04 §9.29's and §11.10's words for VideoPriceEditor ("New requests only." is REQUESTS_SETTINGS_COPY.newRequestsOnly).
 * `useRateCard`'s base is the card's, formatMoney(…, { wholeDollars: true }): "Use my rate card (CA$150)" (07 D98).
 */
export const VIDEO_PRICE_COPY = {
  useRateCard: (base: string) => `Use my rate card (${base})`,
  setOwn: "Set a base price for this video",
  field: "Base price for this video",
  /** "Allow Paid social ads anyway" · "Allow TV / broadcast anyway". */
  allowAnyway: (key: MusicUseKey) => `Allow ${rateOptionLabel(key)} anyway`,
  musicHelper: "Buyers must mute or replace the music.",
} as const;

/** One music Switch: the use it turns back on, and whether it is on. */
export type MusicSwitch = { key: MusicUseKey; on: boolean };

/**
 * The music Switches (07 D82): one per use music turns off, except a use off on the rate card, which comes back there
 * (owner answer Q-158). A Switch is on when the stored music answer is Yes and the use is on for the video.
 */
export function musicSwitches(
  options: Pick<EffectiveOptions, "use">,
  storedMusic: boolean | null,
): MusicSwitch[] {
  return MUSIC_DISABLED_USES.flatMap((key) => {
    const use = options.use.find((u) => u.key === key);
    return use && use.disabledReason !== "creator"
      ? [{ key, on: storedMusic === true && use.enabled }]
      : [];
  });
}
