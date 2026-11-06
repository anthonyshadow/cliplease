// The rate-card tests' shared cards (P12, P13): onboarding's default card as getRateCard reads it, and as saveRateCard
// takes it with an exclusive offer (P19e, P19f). Tests only.
import type { RateOptionKey } from "../../src/lib/domain/values";
import {
  DEFAULT_EXCLUSIVE_MULTIPLIER_BPS,
  defaultRateOptions,
} from "../../src/lib/pricing/presets";
import {
  defaultRateCardInput,
  type RateCardInput,
} from "../../src/lib/validation/pricing";
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

/** The default card (CA$150, every option on) as saveRateCard takes it, with this exclusive offer. */
export const cardWith = (
  exclusiveEnabled: boolean,
  exclusiveMultiplierBps: number,
): RateCardInput => ({
  ...defaultRateCardInput("cad"),
  exclusiveEnabled,
  exclusiveMultiplierBps,
});

/** The card on at ×3.00 with `off` switched off. */
export function cardOnWithout(off: readonly RateOptionKey[]): RateCardInput {
  const input = cardWith(true, 30000);
  return {
    ...input,
    options: input.options.map((o) =>
      off.includes(o.key) ? { ...o, enabled: false } : o,
    ),
  };
}
