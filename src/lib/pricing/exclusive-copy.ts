// The exclusive offer's words (04 §9.29, §9.39, §11.10; 07 D109, D127; owner answers Q-164, Q-165), in one place because
// the rate card, PricePreview and the video's editor all need them. Pure.
import { formatMultiplier } from "./multiplier";
import { DEFAULT_EXCLUSIVE_MULTIPLIER_BPS } from "./presets";

export const EXCLUSIVE_COPY = {
  title: "Exclusive licenses",
  offerSwitch: "Offer exclusive licenses",
  offerSwitchHelper: "On all your videos. You can change it per video.",
  premiumLabel: "Exclusive premium",
  premiumHelper:
    "Buyers pay this on top of the normal price. While an exclusive license runs, no one else can license that video.",
  noExclusiveTerm:
    "Turn on 30 days, 6 months or 1 year to offer exclusive licenses.",
  /** "Exclusive: License CA$4,725.00 · Buyer pays CA$5,197.50" */
  line: (price: string, total: string) =>
    `Exclusive: License ${price} · Buyer pays ${total}`,
  perpetualLine:
    "Exclusive: not offered for Perpetual. Exclusive licenses last up to 1 year.",
  tooHighLine: "Exclusive: Too high for one payment.",
  /** "Use my rate card (on, ×3.00)" · "Use my rate card (off)" */
  useRateCard: (enabled: boolean, bps: number) =>
    enabled
      ? `Use my rate card (on, ${formatMultiplier(bps)})`
      : "Use my rate card (off)",
  offerOnVideo: "Offer on this video",
  dontOffer: "Don't offer on this video",
  videoField: "Exclusive premium for this video",
  videoFieldHelper: (bps: number) =>
    `Leave empty to use your rate card's ${formatMultiplier(bps)}.`,
  groupHelper:
    "New requests only. A running license or a waiting request doesn't change.",
  saved: "Exclusive setting saved.",
  /** `base`: the currency's default base in whole dollars ("CA$150"). */
  resetSheet: (base: string) =>
    `Your base price goes back to ${base}, every option to its default, switched on, and exclusive licenses off at ${formatMultiplier(DEFAULT_EXCLUSIVE_MULTIPLIER_BPS)}. New requests only.`,
} as const;
