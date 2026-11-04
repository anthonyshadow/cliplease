// The exclusive offer's rule (02 §5.5; 07 D109, D127): what a card and a video's own columns offer, and how the video's
// three-way choice is stored. Pure and client-safe, for the server's effectiveOptions and the browser's editors.
import {
  EXCLUSIVE_TERM_KEYS,
  type ExclusiveTermKey,
  isOneOf,
  type TermKey,
  type VideoExclusiveMode,
} from "../domain/values";

export type ExclusiveOffer = {
  offered: boolean;
  multiplierBps: number;
  source: "rate_card" | "video";
};

/** What PricePreview's Exclusive line needs. */
export type ExclusiveLine = Pick<ExclusiveOffer, "offered" | "multiplierBps">;

/** video.exclusive_enabled and video.exclusive_multiplier_bps: null = follow the rate card (07 D109). */
export type VideoExclusiveColumns = {
  exclusiveEnabled: boolean | null;
  exclusiveMultiplierBps: number | null;
};

export const FOLLOWS_RATE_CARD: VideoExclusiveColumns = {
  exclusiveEnabled: null,
  exclusiveMultiplierBps: null,
};

export const isExclusiveTermKey = (key: TermKey): key is ExclusiveTermKey =>
  isOneOf(EXCLUSIVE_TERM_KEYS, key);

/** Whether a 30-day, 6-month or 1-year term is among these. */
export const hasExclusiveTerm = (termKeys: readonly TermKey[]) =>
  termKeys.some(isExclusiveTermKey);

/**
 * The offer on one video (07 D109): the video's switch, else the card's, with a 30-day, 6-month or 1-year term on; the
 * video's premium, else the card's. `offered` has no use, territory or over-cap condition.
 */
export function resolveExclusiveOffer(
  rateCard: { exclusiveEnabled: boolean; exclusiveMultiplierBps: number },
  video: VideoExclusiveColumns,
  enabledTermKeys: readonly TermKey[],
): ExclusiveOffer {
  return {
    offered:
      (video.exclusiveEnabled ?? rateCard.exclusiveEnabled) &&
      hasExclusiveTerm(enabledTermKeys),
    multiplierBps:
      video.exclusiveMultiplierBps ?? rateCard.exclusiveMultiplierBps,
    source: video.exclusiveEnabled === null ? "rate_card" : "video",
  };
}

/** null → 'rate_card', true → 'on', false → 'off'. */
export const exclusiveModeOf = (enabled: boolean | null): VideoExclusiveMode =>
  enabled === null ? "rate_card" : enabled ? "on" : "off";

/** The storage rule: 'rate_card' → (null, null), 'on' → (true, multiplierBps), 'off' → (false, null). */
export const exclusiveColumnsOf = (
  mode: VideoExclusiveMode,
  multiplierBps: number | null,
): VideoExclusiveColumns => ({
  exclusiveEnabled: mode === "rate_card" ? null : mode === "on",
  exclusiveMultiplierBps: mode === "on" ? multiplierBps : null,
});
