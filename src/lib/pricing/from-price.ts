// "From {price}" on a video's cards (04 §9.27; 07 D82, D97, D98). Pure.
import type { EffectiveOptions } from "../../server/pricing/rate-card";
import type { Currency, RateDimension } from "../domain/values";
import { formatMoney } from "../format";
import { computeQuote } from "./compute-quote";
import { PLATFORM_FEE_MIN_CENTS } from "./presets";

/**
 * The lowest license price (without the service fee) over the enabled combinations a buyer can pay in one payment, in
 * `options.currency`; null when a group has nothing on or every combination is over the cap. The price grows with each
 * multiplier, so the cheapest combination takes each group's lowest enabled one; the fee (`platformFeeBps`, the
 * server's PLATFORM_FEE_BPS) only decides whether it fits under the cap (computeQuote's over_max). Callers pass
 * effectiveOptions(rateCard, video) and print the result with formatMoney(cents, options.currency).
 */
export function fromPriceCents(
  options: EffectiveOptions,
  platformFeeBps: number,
): number | null {
  const lowest = (dimension: RateDimension) => {
    const bps = options[dimension].filter((o) => o.enabled).map((o) => o.bps);
    return bps.length > 0 ? Math.min(...bps) : null;
  };
  const useBps = lowest("use");
  const termBps = lowest("term");
  const territoryBps = lowest("territory");
  if (useBps === null || termBps === null || territoryBps === null) return null;
  const quote = computeQuote({
    currency: options.currency,
    basePriceCents: options.basePriceCents,
    useBps,
    termBps,
    territoryBps,
    platformFeeBps,
    platformFeeMinCents: PLATFORM_FEE_MIN_CENTS[options.currency],
  });
  return quote.ok ? quote.quote.licensePriceCents : null;
}

/** "From CA$150.00": fromPriceCents' price as the cards and the video page print it. */
export const fromPriceText = (cents: number, currency: Currency) =>
  `From ${formatMoney(cents, currency)}`;
