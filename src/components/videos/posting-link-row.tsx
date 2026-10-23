"use client";

import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import { TERTIARY } from "@/components/ui/primary-width";
import { Switch } from "@/components/ui/switch";
import { TextField } from "@/components/ui/text-field";
import {
  emptyLinkHelper,
  POSTING_LINK_PLACEHOLDERS,
  POSTINGS_COPY,
  postingLinkErrorCopy,
} from "@/lib/postings/copy";
import { postingFieldKey, switchFieldValue } from "@/lib/postings/form";
import { postingPlatformLabel } from "@/lib/postings/labels";
import { POSTING_OTHER_LABEL_MAX } from "@/lib/postings/limits";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import {
  type LinkProblem,
  nameMissing,
  type PickerRow,
  showLinkValue,
  shownSwitch,
} from "./posting-picker-state";
import { POSTING_ROW } from "./posting-result";

/** The id of a row's link field: the step focuses it after Add another link, Remove and Move. */
export const linkFieldId = (key: string) => `posting-link-${key}`;

/**
 * "Show buyers this link" (04 §9.33; 07 D18), on a link row and the Library source row: the Switch, then D18's note
 * while a verified unlisted post's link is off (the Switch described by it). A Radix Switch posts "on" or nothing, so
 * the Switch has no name: a hidden `name` posts "true" / "false" only while `value` is given (the creator turned it
 * this visit, owner answer Q-86 a); when it is absent the server keeps the saved value or applies its default.
 */
export function ShowLinkSwitch({
  checked,
  onCheckedChange,
  unlisted,
  name,
  value,
}: {
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  unlisted: boolean;
  name: string;
  value?: boolean;
}) {
  const noteId = useId();
  return (
    <div className="flex flex-col gap-1">
      <Switch
        label={POSTINGS_COPY.showLink}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-describedby={unlisted ? noteId : undefined}
      />
      {value === undefined ? null : (
        <input type="hidden" name={name} value={switchFieldValue(value)} />
      )}
      {unlisted ? (
        <p id={noteId} className="text-footnote text-ink-2">
          {POSTINGS_COPY.unlistedNote}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One link field of a posting card (04 §9.33; owner answer Q-79 a): Other's "Where? (for example, Vimeo)", "Link to the
 * post (optional)" with the platform's placeholder, its parse error (`problem`, parsed once by the picker) on blur or
 * Continue (never while typing; **Move** for a link from another platform), the saved result while the link is still
 * the saved one (`result`, or "Checking the link…"), "Show buyers this link" once the link parses, and Remove on an
 * added field. Named for postingsFromFormData at `index`. The link field has no maxLength, so a 2,049-character paste
 * reads "That link is too long…" instead of being cut. Nothing here fetches or previews the link.
 */
export function PostingLinkRow({
  row,
  index,
  problem,
  saved,
  removable,
  readOnly,
  serverError,
  result,
  needsAction,
  moveDisabled,
  limitNoteId,
  onLink,
  onLinkBlur,
  onOtherLabel,
  onSwitch,
  onMove,
  onRemove,
}: {
  row: PickerRow;
  index: number;
  /** The link's parse error (linkProblem), or null for no link or one that parses. */
  problem: LinkProblem | null;
  /** The saved posting while the link is still its link (matchingSaved). */
  saved: OwnerPostingDTO | null;
  removable: boolean;
  /** Continue or a check is running (04 §9.33: fields read-only). */
  readOnly: boolean;
  serverError: { link?: string; otherLabel?: string } | undefined;
  /** The saved result with its action, "Checking the link…", or null (a new or changed link, or no link). */
  result: ReactNode;
  /** A saved link came back not_found, no_account or check_failed: focus goes here after a staying Continue. */
  needsAction: boolean;
  /** Move has nowhere to put the link (the 12-place limit). */
  moveDisabled: boolean;
  limitNoteId: string;
  onLink: (value: string) => void;
  onLinkBlur: () => void;
  onOtherLabel: (value: string) => void;
  onSwitch: (on: boolean) => void;
  onMove: () => void;
  onRemove: () => void;
}) {
  const showProblem = problem !== null && row.linkErrorShown;
  const linkError =
    serverError?.link ??
    (showProblem
      ? postingLinkErrorCopy(problem.error, {
          platform: row.platform,
          otherLabel: row.otherLabel,
          detected: problem.detected,
        })
      : undefined);
  const nameError =
    serverError?.otherLabel ??
    (row.nameErrorShown && nameMissing(row)
      ? POSTINGS_COPY.otherNameMissing
      : undefined);
  const canMove =
    problem?.error === "wrong_platform" &&
    problem.detected !== undefined &&
    (showProblem || serverError?.link !== undefined);
  const hasLink = row.link.trim() !== "";
  const switchOn = shownSwitch(row, saved);
  return (
    <div
      data-posting-row
      data-row-key={row.key}
      data-needs-action={needsAction || undefined}
      className={POSTING_ROW}
    >
      <input
        type="hidden"
        name={postingFieldKey(index, "platform")}
        value={row.platform}
      />
      {row.platform === "other" ? (
        <TextField
          label={POSTINGS_COPY.otherNameLabel}
          name={postingFieldKey(index, "otherLabel")}
          value={row.otherLabel}
          onChange={(event) => onOtherLabel(event.target.value)}
          maxLength={POSTING_OTHER_LABEL_MAX}
          autoComplete="off"
          readOnly={readOnly}
          error={nameError}
        />
      ) : null}
      <div className="flex min-w-0 flex-col gap-2">
        <TextField
          id={linkFieldId(row.key)}
          label={POSTINGS_COPY.linkLabel}
          optional
          name={postingFieldKey(index, "link")}
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={POSTING_LINK_PLACEHOLDERS[row.platform] ?? undefined}
          value={row.link}
          onChange={(event) => onLink(event.target.value)}
          onBlur={onLinkBlur}
          readOnly={readOnly}
          helper={
            hasLink
              ? undefined
              : emptyLinkHelper(
                  postingPlatformLabel(row.platform, row.otherLabel),
                )
          }
          error={linkError}
        />
        {canMove ? (
          <Button
            variant="tertiary"
            size="sm"
            className={TERTIARY}
            disabled={moveDisabled}
            aria-describedby={moveDisabled ? limitNoteId : undefined}
            onClick={onMove}
          >
            {POSTINGS_COPY.move}
          </Button>
        ) : null}
      </div>
      {result}
      {hasLink && problem === null ? (
        <ShowLinkSwitch
          checked={switchOn}
          onCheckedChange={onSwitch}
          unlisted={saved?.visibility === "unlisted" && !switchOn}
          name={postingFieldKey(index, "showLink")}
          value={showLinkValue(row)}
        />
      ) : null}
      {removable ? (
        <Button
          variant="tertiary"
          size="sm"
          className={TERTIARY}
          onClick={onRemove}
        >
          {POSTINGS_COPY.remove}
        </Button>
      ) : null}
    </div>
  );
}
