"use client";

import { useEffect, useRef, useState } from "react";
import { LICENSE_COLUMNS } from "@/components/layout/gutter";
import { Notice } from "@/components/ui/notice";
import type { RateDimension } from "@/lib/domain/values";
import { formatDeadline, formatDelta, formatMoney } from "@/lib/format";
import { creditLine } from "@/lib/licensing/credit";
import {
  LICENSE_PAGE_COPY,
  type LicensePageDTO,
} from "@/lib/licensing/license-page";
import { rateOptionOneLiner } from "@/lib/licensing/options";
import {
  licenseDeltaCents,
  offeredOptions,
  quoteFor,
  type Selection,
  territoryToChoose,
  withOption,
} from "@/lib/licensing/selection";
import { licenseSummary } from "@/lib/licensing/summary";
import type { Quote } from "@/lib/pricing/compute-quote";
import { HOUR_MS } from "@/lib/time";
import { HoldCopy, LicenseDetails, twoTone } from "./license-details";
import { LicenseSummary } from "./license-summary";
import { OptionGroup, OptionTile } from "./option-group";
import { PriceBar } from "./price-bar";
import {
  CountriesSheet,
  TERRITORY_SELECT_ID,
  TerritorySelect,
} from "./territory-picker";

const COPY = LICENSE_PAGE_COPY;

/** The quote for a choice the page offers: offeredOptions only shows options that fit, so there always is one. */
function quoteOf(page: LicensePageDTO, selection: Selection): Quote {
  const result = quoteFor(page.options, selection, {
    platformFeeBps: page.platformFeeBps,
    platformFeeMinCents: page.platformFeeMinCents,
  });
  if (!result?.ok)
    throw new Error("License page: an offered choice has no price");
  return result.quote;
}

/** The viewer's zone and the time the page mounted; null in the server render and before mount (02 §4.4). */
function useViewerClock() {
  const [viewer, setViewer] = useState<{
    timeZone: string;
    now: number;
  } | null>(null);
  useEffect(() => {
    setViewer({
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      now: Date.now(),
    });
  }, []);
  return viewer;
}

/**
 * The license page's live part (01 J7; 05 §4.1): "What you get.", the Use, Term and Territory tiles, the summary, the
 * details form, the hold copy, and the PriceBar last, in the right-hand column from lg (LICENSE_COLUMNS.main; the
 * server page renders the left one). Every amount comes from the one quote (computeQuote; the server recomputes it,
 * 01 G.1). A tap on One country or One region moves focus into its select; arrow keys don't, so they stay in the group
 * (owner answer Q-113 a).
 */
export function LicensePageClient({
  page,
  submissionId,
}: {
  page: LicensePageDTO;
  /** A fresh id per server render (P16a's idempotency key). */
  submissionId: string;
}) {
  const { video, creator, options } = page;
  const [selection, setSelection] = useState(page.selection);
  const viewer = useViewerClock();
  const pointer = useRef(false);
  const [focusSelect, setFocusSelect] = useState(false);
  useEffect(() => {
    if (!focusSelect) return;
    setFocusSelect(false);
    document.getElementById(TERRITORY_SELECT_ID)?.focus();
  }, [focusSelect]);

  const quote = quoteOf(page, selection);
  const offered = offeredOptions(options, selection, page.platformFeeBps);
  const total = formatMoney(quote.totalCents, quote.currency);
  const delta = <G extends RateDimension>(group: G, key: Selection[G]) => {
    const cents = licenseDeltaCents(
      options,
      selection,
      group,
      key,
      page.platformFeeBps,
    );
    return cents === null ? null : formatDelta(cents, options.currency);
  };
  const choose = <G extends RateDimension>(group: G, key: Selection[G]) => {
    if (group === "territory" && key !== "worldwide" && pointer.current) {
      setFocusSelect(true);
    }
    setSelection((current) => withOption(current, group, key));
  };
  const setCode = (territoryCode: string | null) =>
    setSelection((current) => ({ ...current, territoryCode }));
  const chooseTerritory = territoryToChoose(selection);
  const summary = licenseSummary({
    useKey: selection.use,
    termKey: selection.term,
    territoryKey: selection.territory,
    territoryCode: selection.territoryCode,
    handle: creator.handle,
    creditLine: creditLine({
      handle: creator.handle,
      primary: page.postings.primary,
    }),
    containsMusic: video.containsMusic,
    identifiablePeople: video.identifiablePeople,
  });

  return (
    <>
      <div className={LICENSE_COLUMNS.main}>
        <Notice title={COPY.whatYouGet.title}>{COPY.whatYouGet.body}</Notice>
        <OptionGroup legend={twoTone(COPY.headings.use)}>
          <div className="flex flex-col gap-3">
            {offered.use.map((option) => (
              <OptionTile
                key={option.key}
                name="use"
                value={option.key}
                title={option.label}
                checked={selection.use === option.key}
                disabled={!option.enabled}
                onChange={() => choose("use", option.key)}
                description={
                  option.enabled ? rateOptionOneLiner(option.key) : undefined
                }
                reason={
                  option.disabledReason === "music"
                    ? COPY.musicDisabled
                    : undefined
                }
                delta={option.enabled ? delta("use", option.key) : null}
              />
            ))}
          </div>
        </OptionGroup>
        <OptionGroup legend={twoTone(COPY.headings.term)}>
          <div className="grid grid-cols-2 gap-3">
            {offered.term.map((option) => (
              <OptionTile
                key={option.key}
                name="term"
                value={option.key}
                title={option.label}
                checked={selection.term === option.key}
                onChange={() => choose("term", option.key)}
                delta={delta("term", option.key)}
                deltaPlacement="below"
              />
            ))}
          </div>
        </OptionGroup>
        <OptionGroup
          legend={twoTone(COPY.headings.territory)}
          onPointerDown={() => {
            pointer.current = true;
          }}
          onKeyDown={() => {
            pointer.current = false;
          }}
        >
          <div className="flex flex-col gap-3">
            {offered.territory.map((option) => {
              const selected = selection.territory === option.key;
              const select =
                selected && option.key !== "worldwide" ? (
                  <TerritorySelect
                    territory={option.key}
                    code={selection.territoryCode}
                    onChange={setCode}
                  />
                ) : null;
              return (
                <OptionTile
                  key={option.key}
                  name="territory"
                  value={option.key}
                  title={option.label}
                  checked={selected}
                  onChange={() => choose("territory", option.key)}
                  description={rateOptionOneLiner(option.key)}
                  delta={delta("territory", option.key)}
                  picker={
                    option.key === "region" ? (
                      <>
                        {select}
                        <CountriesSheet />
                      </>
                    ) : (
                      select
                    )
                  }
                />
              );
            })}
          </div>
        </OptionGroup>
        <LicenseSummary summary={summary} currency={options.currency} />
        <LicenseDetails
          handle={creator.handle}
          values={{
            videoId: video.id,
            useKey: selection.use,
            termKey: selection.term,
            territoryKey: selection.territory,
            territoryCode: selection.territoryCode ?? "",
            submissionId,
            expectedTotalCents: quote.totalCents,
            timeZone: viewer?.timeZone ?? "",
          }}
        />
        <HoldCopy
          handle={creator.handle}
          total={total}
          currency={options.currency}
          deadline={
            viewer
              ? formatDeadline(
                  new Date(viewer.now + creator.approvalWindowHours * HOUR_MS),
                  viewer.timeZone,
                )
              : null
          }
        />
      </div>
      <PriceBar
        quote={quote}
        title={video.title}
        handle={creator.handle}
        chooseTerritory={chooseTerritory}
      />
    </>
  );
}
