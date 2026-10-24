// The one pricing function (02 §5.5, 03 §3.7.1): the editor's live preview, the license page and the server's authority
// all run this code. Integer minor units and basis points, BigInt inside, round half up. BigInt goes through the
// constructor: the tsconfig targets ES2017, where `10n` literals don't compile. P19e adds the exclusive factor
// (07 D109).
import type { Currency } from "../domain/values";
import { MAX_TOTAL_CENTS } from "./presets";

const BPS = BigInt(10_000);
const BPS3 = BPS * BPS * BPS;
const TWO = BigInt(2);
const FEE_BPS_MAX = 10_000;
const FEE_MIN_CENTS_MAX = 10_000; // CHECK license_request_fee_min_range

export type QuoteInput = {
  currency: Currency;
  basePriceCents: number;
  useBps: number;
  termBps: number;
  territoryBps: number;
  /** PLATFORM_FEE_BPS (env, 1000 = 10 %). */
  platformFeeBps: number;
  /** PLATFORM_FEE_MIN_CENTS[currency]; a request snapshots it (07 D79, D97). */
  platformFeeMinCents: number;
};

export type Quote = {
  currency: Currency;
  licensePriceCents: number;
  platformFeeCents: number;
  totalCents: number;
};

export type QuoteResult =
  | { ok: true; quote: Quote }
  | { ok: false; reason: "invalid_input" | "over_max" };

/** round_half_up(base × use × term × territory / 10^12): exact integer math. */
export function licensePriceCents(
  basePriceCents: number,
  useBps: number,
  termBps: number,
  territoryBps: number,
): number {
  const product =
    BigInt(basePriceCents) *
    BigInt(useBps) *
    BigInt(termBps) *
    BigInt(territoryBps);
  return Number((product + BPS3 / TWO) / BPS3);
}

/** max(round_half_up(price × feeBps / 10^4), minCents): the service fee with its floor (07 D79, D97). */
export function platformFeeCents(
  priceCents: number,
  feeBps: number,
  minCents: number,
): number {
  const percent = (BigInt(priceCents) * BigInt(feeBps) + BPS / TWO) / BPS;
  const floor = BigInt(minCents);
  return Number(percent > floor ? percent : floor);
}

const isPositiveInteger = (n: number) => Number.isSafeInteger(n) && n > 0;
const isIntegerIn = (n: number, max: number) =>
  Number.isSafeInteger(n) && n >= 0 && n <= max;

/**
 * The license price, the buyer's service fee on top and the total, in the input's currency. `invalid_input` for a
 * factor that isn't a positive safe integer or a fee setting outside 0..10000 (the creator-facing bounds live in the
 * Zod schemas, src/lib/validation/pricing.ts); `over_max` when the total passes MAX_TOTAL_CENTS[currency] (07 D22).
 */
export function computeQuote(i: QuoteInput): QuoteResult {
  const factors = [i.basePriceCents, i.useBps, i.termBps, i.territoryBps];
  if (
    !factors.every(isPositiveInteger) ||
    !isIntegerIn(i.platformFeeBps, FEE_BPS_MAX) ||
    !isIntegerIn(i.platformFeeMinCents, FEE_MIN_CENTS_MAX)
  ) {
    return { ok: false, reason: "invalid_input" };
  }
  const price = licensePriceCents(
    i.basePriceCents,
    i.useBps,
    i.termBps,
    i.territoryBps,
  );
  const fee = platformFeeCents(price, i.platformFeeBps, i.platformFeeMinCents);
  const total = price + fee;
  if (total > MAX_TOTAL_CENTS[i.currency]) {
    return { ok: false, reason: "over_max" };
  }
  return {
    ok: true,
    quote: {
      currency: i.currency,
      licensePriceCents: price,
      platformFeeCents: fee,
      totalCents: total,
    },
  };
}
