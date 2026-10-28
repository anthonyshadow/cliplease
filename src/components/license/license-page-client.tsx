"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { startCheckout } from "@/app/(public)/u/[handle]/[slug]/actions";
import { LICENSE_COLUMNS } from "@/components/layout/gutter";
import { Banner } from "@/components/ui/banner";
import { Notice } from "@/components/ui/notice";
import { runAction } from "@/components/ui/run-action";
import type { RateDimension } from "@/lib/domain/values";
import { formatDeadline, formatDelta, formatMoney } from "@/lib/format";
import { creditLine } from "@/lib/licensing/credit";
import {
  detailsErrors,
  type FormErrors,
  type FormField,
} from "@/lib/licensing/details";
import {
  LICENSE_PAGE_COPY,
  type LicensePageDTO,
} from "@/lib/licensing/license-page";
import { rateOptionOneLiner } from "@/lib/licensing/options";
import {
  licenseDeltaCents,
  offeredOptions,
  quoteFor,
  repairSelection,
  type Selection,
  territoryToChoose,
  withOption,
} from "@/lib/licensing/selection";
import { licenseSummary } from "@/lib/licensing/summary";
import type { Quote } from "@/lib/pricing/compute-quote";
import { formText, GENERIC_ERROR_MESSAGE } from "@/lib/result";
import { SIGN_IN_COPY } from "@/lib/sign-in";
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

type Refusal = Awaited<ReturnType<typeof startCheckout>>;

/**
 * A refusal's banner above "Your details" (05 §4.1 States); `priced`: a total that answered the choice it was sent
 * with, so a new choice drops it.
 */
type PageNotice = { tone: "info" | "error"; text: string; priced?: boolean };

/** Where focus goes once the page has re-rendered: the first field in error, the banner, or a moved option group. */
type FocusTarget = "invalid" | "notice" | "gone";

/** The posted details, for the press-time check. */
const detailsOf = (data: FormData) => ({
  licenseeName: formText(data, "licenseeName"),
  contactName: formText(data, "contactName"),
  buyerEmail: formText(data, "buyerEmail"),
  intendedUse: formText(data, "intendedUse"),
  acceptTerms: data.get("acceptTerms") === "on",
});

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
 *
 * Request license (P16a; 05 §4.1 "Submit"): every field is checked on press and focus goes to the first problem; then
 * startCheckout, with the column inert and "Starting checkout…" until the page leaves for Checkout. A refusal shows its
 * banner and gives focus to it; a change on the server refreshes the page (a new price, an option gone: its group moves
 * to an option still offered and says so, the buyer's details kept; a video gone: the 404).
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
  const router = useRouter();
  const [stored, setSelection] = useState(page.selection);
  // The choice as it stands on today's options: after a refresh, a group whose option is gone moves (01 J7.10).
  const { selection, gone } = repairSelection(
    options,
    stored,
    page.platformFeeBps,
  );
  const viewer = useViewerClock();
  const pointer = useRef(false);
  const main = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [notice, setNotice] = useState<PageNotice | null>(null);
  const [pending, setPending] = useState(false);
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  // A failed Checkout's fresh submission, until the server renders a newer one (07 D31).
  const [fresh, setFresh] = useState<{ for: string; id: string } | null>(null);
  const currentSubmissionId =
    fresh?.for === submissionId ? fresh.id : submissionId;
  const goneGroup = gone[0];
  useEffect(() => {
    if (!focus) return;
    if (focus === "gone") {
      // Waits for the refresh that brings the new options.
      if (!goneGroup) return;
      main.current
        ?.querySelector<HTMLElement>(`input[name="${goneGroup}"]:checked`)
        ?.focus();
    } else {
      main.current
        ?.querySelector<HTMLElement>(
          focus === "notice"
            ? "[data-license-notice]"
            : '[aria-invalid="true"]',
        )
        ?.focus();
    }
    setFocus(null);
  }, [focus, goneGroup]);
  // Back from Checkout restores a page that was still waiting: let the buyer press again.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  const [focusSelect, setFocusSelect] = useState(false);
  useEffect(() => {
    if (!focusSelect) return;
    setFocusSelect(false);
    document.getElementById(TERRITORY_SELECT_ID)?.focus();
  }, [focusSelect]);

  const quote = quoteOf(page, selection);
  const chooseTerritory = territoryToChoose(selection);
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
  const dropPricedNotice = () =>
    setNotice((current) => (current?.priced ? null : current));
  const choose = <G extends RateDimension>(group: G, key: Selection[G]) => {
    if (group === "territory" && key !== "worldwide" && pointer.current) {
      setFocusSelect(true);
    }
    setSelection(withOption(selection, group, key));
    dropPricedNotice();
  };
  const setError = (field: FormField, message: string | undefined) =>
    setErrors((current) => ({ ...current, [field]: message }));
  const setCode = (territoryCode: string | null) => {
    setSelection({ ...selection, territoryCode });
    setError("territoryCode", undefined);
    dropPricedNotice();
  };
  const say = (tone: PageNotice["tone"], text: string, priced = false) => {
    setNotice({ tone, text, priced });
    setFocus("notice");
  };

  async function submit(form: HTMLFormElement) {
    if (pending) return;
    // One country or One region with nothing chosen: the press asks for it (04 §9.3).
    if (chooseTerritory) {
      document.getElementById(TERRITORY_SELECT_ID)?.focus();
      return;
    }
    // Read before any state changes: a re-render resets the hidden inputs to their props.
    const data = new FormData(form);
    const problems = detailsErrors(detailsOf(data));
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      setFocus("invalid");
      return;
    }
    setErrors({});
    setNotice(null);
    setPending(true);
    const result: Refusal | null = await runAction(() => startCheckout(data));
    // null: on its way to Checkout; the column stays inert until the page leaves.
    if (result === null) return;
    setPending(false);
    refused(result);
  }

  function refused(result: Refusal) {
    switch (result.error.code) {
      case "invalid": {
        const fields = result.error.fields;
        if (!fields) return say("error", GENERIC_ERROR_MESSAGE);
        setErrors(
          Object.fromEntries(
            Object.entries(fields).map(([field, [message]]) => [
              field,
              message,
            ]),
          ),
        );
        setFocus("invalid");
        return;
      }
      case "price_changed":
        say(
          "info",
          COPY.pricesChanged(
            formatMoney(
              result.totalCents ?? quote.totalCents,
              options.currency,
            ),
          ),
          true,
        );
        router.refresh();
        return;
      case "option_disabled":
        setFocus("gone");
        router.refresh();
        return;
      case "not_available":
        router.refresh();
        return;
      case "already_submitted":
        return say("info", COPY.alreadySubmitted);
      case "checkout_failed":
        if (result.submissionId) {
          setFresh({ for: submissionId, id: result.submissionId });
        }
        return say("error", GENERIC_ERROR_MESSAGE);
      default:
        return say(
          "error",
          navigator.onLine === false
            ? SIGN_IN_COPY.offline
            : GENERIC_ERROR_MESSAGE,
        );
    }
  }
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
      <div ref={main} inert={pending} className={LICENSE_COLUMNS.main}>
        <Notice title={COPY.whatYouGet.title}>{COPY.whatYouGet.body}</Notice>
        <OptionGroup
          legend={twoTone(COPY.headings.use)}
          error={gone.includes("use") ? COPY.optionGone : undefined}
        >
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
        <OptionGroup
          legend={twoTone(COPY.headings.term)}
          error={gone.includes("term") ? COPY.optionGone : undefined}
        >
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
          error={gone.includes("territory") ? COPY.optionGone : undefined}
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
                    error={errors.territoryCode}
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
        {notice ? (
          <div data-license-notice tabIndex={-1} className="rounded-md">
            <Banner tone={notice.tone} live={false}>
              {notice.text}
            </Banner>
          </div>
        ) : null}
        <LicenseDetails
          handle={creator.handle}
          errors={errors}
          onError={setError}
          onSubmit={submit}
          values={{
            videoId: video.id,
            useKey: selection.use,
            termKey: selection.term,
            territoryKey: selection.territory,
            territoryCode: selection.territoryCode ?? "",
            submissionId: currentSubmissionId,
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
        ready={viewer !== null}
        pending={pending}
      />
    </>
  );
}
