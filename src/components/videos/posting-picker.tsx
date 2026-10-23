"use client";

import { type ReactNode, useId } from "react";
import { FilterChips } from "@/components/library/filter-chips";
import { Banner } from "@/components/ui/banner";
import { NativeCheckbox } from "@/components/ui/checkbox";
import type { PostingPlatform } from "@/lib/domain/values";
import { POSTINGS_COPY } from "@/lib/postings/copy";
import { needsAttention, POSTINGS_FIELD } from "@/lib/postings/form";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import { PostingCard, PostingSourceRow } from "./posting-card";
import { PostingLinkRow } from "./posting-link-row";
import {
  atLimit,
  linkProblem,
  matchingSaved,
  moveTarget,
  type PickerErrors,
  type PickerState,
  pickerCards,
  pickerChips,
  postedRows,
} from "./posting-picker-state";
import { CheckingLine } from "./posting-result";

/** What the creator does in the picker; PostingsForm answers each in its state. */
export type PickerHandlers = {
  toggleChip: (platform: PostingPlatform) => void;
  notPosted: (on: boolean) => void;
  add: (platform: PostingPlatform) => void;
  /** `before`: the field above it in the card, if any (focus goes there). */
  remove: (key: string, platform: PostingPlatform, before?: string) => void;
  move: (key: string) => void;
  link: (key: string, value: string) => void;
  linkBlur: (key: string) => void;
  otherLabel: (key: string, value: string) => void;
  showLink: (key: string, on: boolean) => void;
  sourceShowLink: (on: boolean) => void;
};

/**
 * PostingPicker (04 §9.33; 05 §6.5 callouts 20–33; 07 D69; owner answers Q-73, Q-79 a): the header "Where was it
 * posted?" with its sub, the chips (FilterChips multiple mode, named by the header, wrapping at every tier, with "Say
 * where it was posted" as its error), the 12-place note, "I haven't posted it anywhere yet." (uploads only), a refusal
 * that names no field (an error Banner above the cards), then one card per platform: the source platform's first with
 * the locked source row, the others in chip order, each link field with its saved result in place (`resultOf`, from the
 * form, with its action) or "Checking the link…" while Continue runs. Each link is parsed once per render here
 * (linkProblem), and Move's target looked up only for a link from another platform. Rendered inside PostingsForm's
 * <form>; the inputs are named for postingsFromFormData by their place in the posted order.
 */
export function PostingPicker({
  picker,
  source,
  saved,
  allowMock,
  errors,
  pending,
  checking,
  resultOf,
  on,
}: {
  picker: PickerState;
  /** The locked Library source posting, or null on an upload. */
  source: OwnerPostingDTO | null;
  /** The saved postings by id. */
  saved: ReadonlyMap<string, OwnerPostingDTO>;
  allowMock: boolean;
  errors: PickerErrors;
  /** Continue is running: every link reads "Checking the link…" and the fields are read-only. */
  pending: boolean;
  /** The saved postings being checked again. */
  checking: ReadonlySet<string>;
  /** A saved posting's result in place with its one action, or "Checking the link…". */
  resultOf: (posting: OwnerPostingDTO, checkingNow: boolean) => ReactNode;
  on: PickerHandlers;
}) {
  const headingId = useId();
  const limitNoteId = useId();
  const opts = { allowMock };
  const hasSource = source !== null;
  const full = atLimit(picker, hasSource);
  const cards = pickerCards(picker.rows, source?.platform ?? null);
  const rows = postedRows(cards);
  const readOnly = pending || checking.size > 0;
  return (
    <>
      <div className="flex flex-col gap-2">
        <h2 id={headingId} className="text-title-2 text-ink">
          {POSTINGS_COPY.title}
        </h2>
        <p className="text-callout text-ink-2">{POSTINGS_COPY.sub}</p>
      </div>
      <div className="flex flex-col gap-2">
        <FilterChips
          mode="multiple"
          labelledBy={headingId}
          chips={pickerChips(picker, source?.platform ?? null, allowMock)}
          mirrorName={POSTINGS_FIELD.chipMirror}
          error={errors.platforms}
          onToggle={on.toggleChip}
        />
        {full ? (
          <p id={limitNoteId} className="text-footnote text-ink-2">
            {POSTINGS_COPY.limit}
          </p>
        ) : null}
      </div>
      {hasSource ? null : (
        <NativeCheckbox
          name={POSTINGS_FIELD.notPosted}
          label={POSTINGS_COPY.notPosted}
          checked={picker.notPosted}
          onChange={(event) => on.notPosted(event.target.checked)}
        />
      )}
      {errors.form === null ? null : (
        <div tabIndex={-1} data-form-error className="rounded-md">
          <Banner tone="error" live={false}>
            {errors.form}
          </Banner>
        </div>
      )}
      {cards.map((card) => (
        <PostingCard
          key={card.platform}
          platform={card.platform}
          addDisabled={full}
          limitNoteId={limitNoteId}
          onAdd={() => on.add(card.platform)}
        >
          {card.hasSource && source ? (
            <PostingSourceRow
              source={source}
              switchOn={picker.sourceSwitch}
              onShowLink={on.sourceShowLink}
              result={
                source.verification === "verified"
                  ? null
                  : resultOf(source, checking.has(source.id))
              }
            />
          ) : null}
          {card.rows.map((row, k) => {
            const problem = linkProblem(row, opts);
            const match = matchingSaved(
              row,
              row.savedId === null ? undefined : saved.get(row.savedId),
              opts,
            );
            const checkingNow =
              (pending && row.link.trim() !== "") ||
              (match !== null && checking.has(match.id));
            let result: ReactNode = checkingNow ? <CheckingLine /> : null;
            if (match !== null) result = resultOf(match, checkingNow);
            return (
              <PostingLinkRow
                key={row.key}
                row={row}
                index={rows.indexOf(row)}
                problem={problem}
                saved={match}
                removable={card.hasSource || k > 0}
                readOnly={readOnly}
                serverError={errors.rows[row.key]}
                result={result}
                needsAction={
                  match !== null && !checkingNow && needsAttention(match)
                }
                moveDisabled={
                  problem?.error === "wrong_platform" &&
                  moveTarget(picker, row.key, hasSource, opts) === null
                }
                limitNoteId={limitNoteId}
                onLink={(value) => on.link(row.key, value)}
                onLinkBlur={() => on.linkBlur(row.key)}
                onOtherLabel={(value) => on.otherLabel(row.key, value)}
                onSwitch={(value) => on.showLink(row.key, value)}
                onMove={() => on.move(row.key)}
                onRemove={() =>
                  on.remove(row.key, card.platform, card.rows[k - 1]?.key)
                }
              />
            );
          })}
        </PostingCard>
      ))}
    </>
  );
}
