"use client";

import { type ReactNode, useId } from "react";
import { Button } from "@/components/ui/button";
import { TERTIARY } from "@/components/ui/primary-width";
import type { PostingPlatform } from "@/lib/domain/values";
import { POSTINGS_COPY } from "@/lib/postings/copy";
import { POSTINGS_FIELD } from "@/lib/postings/form";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import { ShowLinkSwitch } from "./posting-link-row";
import {
  POSTING_ROW,
  PostingCardFrame,
  SourceVerifiedLead,
} from "./posting-result";

/**
 * One editable posting card (04 §9.33): PostingCardFrame named by its title, its rows stacked with a hairline between
 * them, then "Add another link" (disabled at POSTINGS_MAX, described by the limit note).
 */
export function PostingCard({
  platform,
  children,
  onAdd,
  addDisabled,
  limitNoteId,
}: {
  platform: PostingPlatform;
  children: ReactNode;
  onAdd: () => void;
  addDisabled: boolean;
  limitNoteId: string;
}) {
  const titleId = useId();
  return (
    <PostingCardFrame platform={platform} titleId={titleId}>
      <div className="flex min-w-0 flex-col divide-y divide-hairline">
        {children}
      </div>
      <Button
        variant="tertiary"
        size="sm"
        className={TERTIARY}
        disabled={addDisabled}
        aria-describedby={addDisabled ? limitNoteId : undefined}
        data-add-link
        onClick={onAdd}
      >
        {POSTINGS_COPY.addAnotherLink}
      </Button>
    </PostingCardFrame>
  );
}

/**
 * The Library source row (04 §9.33, 05 callout 22; 07 D65; owner answer Q-73 a): first in its card and locked (no
 * Remove, no link field). Verified: SourceVerifiedLead ("{verified_username} on {Platform}", the Verified pill and
 * "From your Library"). After an admin Disable and Enable it reads its real result instead (`result`, with Check
 * again). Its Switch shows the stored value until the creator turns it (`switchOn`), and posts `sourceShowLink` only
 * then, as the link rows do: an absent one keeps the stored value.
 */
export function PostingSourceRow({
  source,
  switchOn,
  onShowLink,
  result,
}: {
  source: OwnerPostingDTO;
  /** The Switch as the creator turned it this visit (PickerState.sourceSwitch), or null while untouched. */
  switchOn: boolean | null;
  onShowLink: (on: boolean) => void;
  /** The result line for a source that is no longer verified, or "Checking the link…". */
  result: ReactNode;
}) {
  const checked = switchOn ?? source.showLink;
  return (
    <div
      data-posting-row
      data-posting-source
      data-row-key={source.id}
      className={POSTING_ROW}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {source.verification === "verified" ? (
          <SourceVerifiedLead source={source} />
        ) : (
          <>
            {result}
            <p className="text-footnote text-ink-2">
              {POSTINGS_COPY.fromLibrary}
            </p>
          </>
        )}
      </div>
      <ShowLinkSwitch
        checked={checked}
        onCheckedChange={onShowLink}
        unlisted={source.visibility === "unlisted" && !checked}
        name={POSTINGS_FIELD.sourceShowLink}
        value={switchOn ?? undefined}
      />
    </div>
  );
}
