"use client";

import { type ReactNode, useEffect, useId } from "react";
import { setVideoExclusiveOffer } from "@/app/(dashboard)/dashboard/videos/[id]/actions";
import { OptionGroup, OptionTile } from "@/components/license/option-group";
import {
  VIDEO_EXCLUSIVE_MODES,
  type VideoExclusiveMode,
} from "@/lib/domain/values";
import { enabledKeys } from "@/lib/pricing/choices";
import {
  exclusiveColumnsOf,
  exclusiveModeOf,
  hasExclusiveTerm,
  resolveExclusiveOffer,
  type VideoExclusiveColumns,
} from "@/lib/pricing/exclusive";
import { EXCLUSIVE_COPY } from "@/lib/pricing/exclusive-copy";
import {
  multiplierFieldValue,
  parseMultiplierBps,
} from "@/lib/pricing/multiplier";
import { ExclusiveMultiplierBpsSchema } from "@/lib/validation/pricing";
import type { EffectiveOptions, RateCardDTO } from "@/server/pricing/rate-card";
import { ChoiceDraftForm, useChoiceDraft } from "./choice-draft";
import { usePriceDraft } from "./price-draft";

type Offer = { choice: VideoExclusiveMode; text: string };

/** The field's text counts only while "Offer on this video" is chosen; spaces don't. */
const sameOffer = (a: Offer, b: Offer) =>
  a.choice === b.choice &&
  (a.choice !== "on" || a.text.trim() === b.text.trim());

const premiumText = (bps: number | null) =>
  bps === null ? "" : multiplierFieldValue(bps);

/** The optional premium: empty is the rate card's (owner answer Q-164), so it never reaches parseMultiplierBps. */
const parsePremium = (text: string) =>
  ExclusiveMultiplierBpsSchema.nullable().safeParse(
    text.trim() === "" ? null : (parseMultiplierBps(text) ?? Number.NaN),
  );

/**
 * 04 §9.39 ExclusiveOfferEditor, the Prices of Review and the video page (05 §6.5 callout 57, §6.7 callout 13; 07 D109,
 * D127), under VideoPriceEditor and above the read-only preview (owner answer Q-166): "Use my rate card (on, ×3.00)",
 * "Offer on this video", whose optional premium field shows while it is chosen (empty is the rate card's premium, owner
 * answer Q-164), or "Don't offer on this video". The choice and the premium are a draft (owner answer Q-163): Save and
 * Cancel show while it differs from what is stored, and only Save calls setVideoExclusiveOffer. Enter saves, Escape
 * cancels; closing or reloading the tab asks first. The draft prices the preview (PriceDraftProvider) with the last
 * premium the field would accept, and stays until the saved offer comes back with the page's refresh. A refusal goes
 * under the field (under the choices without one) and takes the focus; once Save and Cancel go away, the checked choice
 * does.
 */
export function ExclusiveOfferEditor({
  videoId,
  options,
  rateCard,
  videoExclusive,
}: {
  videoId: string;
  options: EffectiveOptions;
  rateCard: RateCardDTO;
  videoExclusive: VideoExclusiveColumns;
}) {
  const draft = useChoiceDraft({
    stored: {
      choice: exclusiveModeOf(videoExclusive.exclusiveEnabled),
      text: premiumText(videoExclusive.exclusiveMultiplierBps),
    },
    storedValue: videoExclusive.exclusiveMultiplierBps,
    fieldChoice: "on",
    same: sameOffer,
    parse: parsePremium,
    toText: premiumText,
    radioName: "exclusiveOffer",
    submit: (mode, multiplierBps) =>
      setVideoExclusiveOffer({ videoId, mode, multiplierBps }),
    savedToast: EXCLUSIVE_COPY.saved,
  });
  const { dirty } = draft;
  const { setExclusive } = usePriceDraft();
  const helperId = useId();
  const noteId = useId();

  const termKeys = enabledKeys(options.term);
  const noTerm = !hasExclusiveTerm(termKeys);
  const { offered, multiplierBps } = resolveExclusiveOffer(
    rateCard,
    exclusiveColumnsOf(draft.choice, draft.lastValid),
    termKeys,
  );
  // Keyed on primitives: the resolved object is new on every render, and setting it would loop.
  useEffect(() => {
    setExclusive(dirty ? { offered, multiplierBps } : null);
  }, [dirty, offered, multiplierBps, setExclusive]);

  const titles: Record<VideoExclusiveMode, ReactNode> = {
    rate_card: (
      <span className="tabular-nums">
        {EXCLUSIVE_COPY.useRateCard(
          rateCard.exclusiveEnabled,
          rateCard.exclusiveMultiplierBps,
        )}
      </span>
    ),
    on: EXCLUSIVE_COPY.offerOnVideo,
    off: EXCLUSIVE_COPY.dontOffer,
  };

  return (
    <div
      data-exclusive-offer-editor
      className="flex min-w-0 flex-col gap-4"
      {...draft.refocus}
    >
      <OptionGroup
        legend={EXCLUSIVE_COPY.title}
        aria-describedby={noTerm ? `${helperId} ${noteId}` : helperId}
        error={draft.showField ? undefined : draft.refusal?.message}
      >
        <div className="grid grid-cols-1 gap-3">
          {VIDEO_EXCLUSIVE_MODES.map((value) => (
            <OptionTile
              key={value}
              name="exclusiveOffer"
              value={value}
              title={titles[value]}
              checked={draft.choice === value}
              onChange={() => draft.choose(value)}
              disabled={draft.saving}
            />
          ))}
        </div>
        <p id={helperId} className="mt-3 text-footnote text-ink-2">
          {EXCLUSIVE_COPY.groupHelper}
        </p>
        {noTerm ? (
          <p id={noteId} className="mt-1 text-footnote text-ink-2">
            {EXCLUSIVE_COPY.noExclusiveTerm}
          </p>
        ) : null}
      </OptionGroup>
      <ChoiceDraftForm
        draft={draft}
        label={EXCLUSIVE_COPY.videoField}
        prefix="×"
        helper={EXCLUSIVE_COPY.videoFieldHelper(
          rateCard.exclusiveMultiplierBps,
        )}
      />
    </div>
  );
}
