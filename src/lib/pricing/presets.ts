// Rate card presets (02 §5.5, 07 D97): per-currency money maps, currency-free multipliers. The only home of these
// constants (P19e adds the exclusive ones here); nothing redeclares them.
import {
  type Currency,
  RATE_DIMENSIONS,
  type RateDimension,
  type RateOptionKey,
  type TermKey,
  type TerritoryKey,
  type UseKey,
} from "../domain/values";

export const DEFAULT_BASE_PRICE_CENTS = {
  cad: 15000,
  usd: 15000,
} as const satisfies Record<Currency, number>; // CA$150 / US$150
export const BASE_PRICE_MIN_CENTS = {
  cad: 1000,
  usd: 1000,
} as const satisfies Record<Currency, number>; // CA$10 / US$10; whole dollars (multiples of 100 minor units)
export const BASE_PRICE_MAX_CENTS = {
  cad: 1_000_000,
  usd: 1_000_000,
} as const satisfies Record<Currency, number>; // CA$10,000 / US$10,000
// Applied to the total (OQ-09): at or below Stripe's CAD and USD maximums, 8 digits for non-card methods while cards
// allow 12 and American Express 9 (owner answer Q-90, read 2026-10-23).
export const MAX_TOTAL_CENTS = {
  cad: 99_999_999,
  usd: 99_999_999,
} as const satisfies Record<Currency, number>;
// The service fee's floor (OQ-18, 07 D79, D97): a constant, not env; PLATFORM_FEE_BPS stays env.
export const PLATFORM_FEE_MIN_CENTS = {
  cad: 200,
  usd: 200,
} as const satisfies Record<Currency, number>; // CA$2.00 / US$2.00

export const MULTIPLIER_MIN_BPS = 10000; // ×1.00 (rate_option_multiplier_range)
export const MULTIPLIER_MAX_BPS = 100000; // ×10.00
export const MULTIPLIER_STEP_BPS = 500; // ×0.05 steps (07 D21)

/** Brief §5 presets, in basis points (×1.00 = 10000). */
export const DEFAULT_OPTIONS = {
  use: { organic_social: 10000, paid_social: 30000, broadcast: 50000 },
  term: { d30: 10000, m6: 15000, y1: 20000, perpetual: 30000 },
  territory: { country: 10000, region: 13000, worldwide: 17500 },
} as const satisfies {
  use: Record<UseKey, number>;
  term: Record<TermKey, number>;
  territory: Record<TerritoryKey, number>;
};

export type DefaultRateOption = {
  dimension: RateDimension;
  optionKey: RateOptionKey;
  multiplierBps: number;
  enabled: true;
  sortOrder: number;
};

/** The 10 rate_option rows of a new rate card, in 03 §8.1's order; sortOrder counts within each dimension. */
export function defaultRateOptions(): DefaultRateOption[] {
  return RATE_DIMENSIONS.flatMap((dimension) =>
    Object.entries(DEFAULT_OPTIONS[dimension]).map(([optionKey, bps], i) => ({
      dimension,
      optionKey: optionKey as RateOptionKey,
      multiplierBps: bps,
      enabled: true as const,
      sortOrder: i,
    })),
  );
}
