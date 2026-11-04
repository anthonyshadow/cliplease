// The rate-card tests' shared card (P12, P13): onboarding's default card as getRateCard reads it. Tests only.
import {
  DEFAULT_EXCLUSIVE_MULTIPLIER_BPS,
  defaultRateOptions,
} from "../../src/lib/pricing/presets";
import type {
  RateCardDTO,
  RateCardOption,
  VideoPricing,
} from "../../src/server/pricing/rate-card";

/** A video that changes nothing about its creator's card (07 D82, D109). */
export const NO_VIDEO: VideoPricing = {
  disabledUses: [],
  basePriceOverrideCents: null,
  exclusiveEnabled: null,
  exclusiveMultiplierBps: null,
};

/** CA$150 with every default option on and exclusive off at ×3.00, then `change` on each option and `card` over the card. */
export const rateCardFixture = (
  change: (o: RateCardOption) => Partial<RateCardOption> = () => ({}),
  card: Partial<Omit<RateCardDTO, "options">> = {},
): RateCardDTO => ({
  currency: "cad",
  basePriceCents: 15000,
  exclusiveEnabled: false,
  exclusiveMultiplierBps: DEFAULT_EXCLUSIVE_MULTIPLIER_BPS,
  ...card,
  options: defaultRateOptions().map((o) => {
    const option: RateCardOption = {
      dimension: o.dimension,
      key: o.optionKey,
      enabled: true,
      multiplierBps: o.multiplierBps,
      sortOrder: o.sortOrder,
    };
    return { ...option, ...change(option) };
  }),
});
