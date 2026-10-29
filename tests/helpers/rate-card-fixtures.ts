// The rate-card tests' shared card (P12, P13): onboarding's default card as getRateCard reads it. Tests only.
import { defaultRateOptions } from "../../src/lib/pricing/presets";
import type {
  RateCardDTO,
  RateCardOption,
} from "../../src/server/pricing/rate-card";

/** CA$150 with every default option on, then `change` applied to each option. */
export const rateCardFixture = (
  change: (o: RateCardOption) => Partial<RateCardOption> = () => ({}),
): RateCardDTO => ({
  currency: "cad",
  basePriceCents: 15000,
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
