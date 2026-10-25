"use client";

import Link from "next/link";
import { useState } from "react";
import { CREATOR_NAV } from "@/components/layout/creator-nav";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import {
  type Currency,
  RATE_DIMENSIONS,
  type RateDimension,
} from "@/lib/domain/values";
import { formatMoney } from "@/lib/format";
import { DIMENSION_LABELS } from "@/lib/licensing/options";
import type { RateChoice, RateChoices } from "@/lib/pricing/choices";
import { computeQuote } from "@/lib/pricing/compute-quote";
import { PLATFORM_FEE_MIN_CENTS } from "@/lib/pricing/presets";

/** What the preview needs: the editor builds it from unsaved edits; Review (P13) passes effectiveOptions' result. */
export type PreviewOptions = RateChoices & {
  currency: Currency;
  basePriceCents: number;
};

// 05 §6.9 frame 1's combination (Paid social ads · 1 year · Worldwide); a group whose choice is off shows its first
// option that is on.
const FIRST_CHOICE = {
  use: "paid_social",
  term: "y1",
  territory: "worldwide",
} as const satisfies Record<RateDimension, string>;

const pick = <C extends RateChoice>(choices: readonly C[], key: string) =>
  choices.find((c) => c.enabled && c.key === key) ??
  choices.find((c) => c.enabled);

/** 1000 bps → "10%". */
const percent = (bps: number) => `${bps / 100}%`;

/**
 * 04 §9.29 PricePreview: a use, a term and a territory among the enabled options, and the line the buyer's quote gives
 * (01 J4.4; template 07 D98) from the same computeQuote the server runs, on every change. `readOnly` is the Review
 * step's use (P13): the same picker over the video's prices, with "Edit your rate card".
 */
export function PricePreview({
  options,
  platformFeeBps,
  readOnly = false,
}: {
  options: PreviewOptions;
  platformFeeBps: number;
  readOnly?: boolean;
}) {
  const { currency } = options;
  const [chosen, setChosen] =
    useState<Record<RateDimension, string>>(FIRST_CHOICE);
  const picks = {
    use: pick(options.use, chosen.use),
    term: pick(options.term, chosen.term),
    territory: pick(options.territory, chosen.territory),
  };
  const { use, term, territory } = picks;
  const minFeeCents = PLATFORM_FEE_MIN_CENTS[currency];
  const quote =
    use && term && territory
      ? computeQuote({
          currency,
          basePriceCents: options.basePriceCents,
          useBps: use.bps,
          termBps: term.bps,
          territoryBps: territory.bps,
          platformFeeBps,
          platformFeeMinCents: minFeeCents,
        })
      : null;
  const money = (cents: number) => formatMoney(cents, currency);

  return (
    <div
      data-price-preview
      className="flex flex-col gap-4 rounded-lg bg-surface p-5"
    >
      {RATE_DIMENSIONS.map((dimension) => {
        const enabled = (options[dimension] as readonly RateChoice[]).filter(
          (c) => c.enabled,
        );
        // A group with nothing on has no picker (the editor says "Keep at least one …").
        if (enabled.length === 0) return null;
        return (
          <SelectField
            key={dimension}
            label={DIMENSION_LABELS[dimension]}
            value={picks[dimension]?.key}
            onChange={(event) =>
              setChosen((prev) => ({
                ...prev,
                [dimension]: event.target.value,
              }))
            }
          >
            {enabled.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </SelectField>
        );
      })}
      {quote && (quote.ok || quote.reason === "over_max") ? (
        <p className="text-body text-ink tabular-nums">
          {quote.ok ? (
            <>
              License {money(quote.quote.licensePriceCents)} · Buyer pays{" "}
              {money(quote.quote.totalCents)} (incl.{" "}
              {money(quote.quote.platformFeeCents)} service fee) ·{" "}
              <span className="font-semibold">
                You get {money(quote.quote.licensePriceCents)}
              </span>
            </>
          ) : (
            "Too high for one payment."
          )}
        </p>
      ) : null}
      <p className="text-footnote text-ink-2">
        {`Service fee (${percent(platformFeeBps)}, at least ${money(minFeeCents)})`}
      </p>
      {readOnly ? (
        <Button asChild variant="link" className="self-start">
          <Link href={CREATOR_NAV.pricing.href}>Edit your rate card</Link>
        </Button>
      ) : null}
    </div>
  );
}
