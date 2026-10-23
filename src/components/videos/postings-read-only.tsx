import { Notice } from "@/components/ui/notice";
import { APP_NAME } from "@/lib/app-name";
import { POSTINGS_COPY, postingResultCopy } from "@/lib/postings/copy";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import {
  POSTING_ROW,
  PostingCardFrame,
  PostingResult,
  SourceVerifiedLead,
} from "./posting-result";

/** Read-only rows offer no action, so the context only words the results. */
const CONTEXT = {
  appName: APP_NAME,
  providerEnabled: false,
  hasConnectedAccount: false,
  onlyNeedsReconnect: false,
};

/**
 * Where it was posted on a live video (04 §9.33 "Locked unless draft or unpublished"; 05 §6.5 frame 35; 01 J5.30; 07
 * D69): the Notice "Turn off to edit where it was posted." first, then one card per posting in position order with its
 * result (the source row as "{verified_username} on {Platform} · Verified · From your Library"). No chips, inputs,
 * Switches, actions, Stepper or Continue. A link is plain wrapping text, never a link element, an image or a frame (07 D67).
 * Server-renderable (no hooks); P14b embeds it on the live video page.
 */
export function PostingsReadOnly({
  postings,
}: {
  postings: readonly OwnerPostingDTO[];
}) {
  return (
    <div data-postings-read-only className="flex min-w-0 flex-col gap-4">
      <Notice>{POSTINGS_COPY.locked}</Notice>
      {postings.map((posting) => (
        <PostingCardFrame
          key={posting.id}
          platform={posting.platform}
          otherLabel={posting.platform === "other" ? posting.label : null}
        >
          <div
            data-posting-source={posting.isSource || undefined}
            className={POSTING_ROW}
          >
            <ReadOnlyRow posting={posting} />
          </div>
        </PostingCardFrame>
      ))}
    </div>
  );
}

function ReadOnlyRow({ posting }: { posting: OwnerPostingDTO }) {
  if (
    posting.isSource &&
    posting.verification === "verified" &&
    posting.verifiedUsername !== null
  ) {
    return <SourceVerifiedLead source={posting} />;
  }
  return (
    <>
      {posting.url === null ? null : (
        <p className="min-w-0 text-callout text-ink break-all">{posting.url}</p>
      )}
      <PostingResult copy={postingResultCopy(posting, CONTEXT)} />
      {posting.isSource ? (
        <p className="text-footnote text-ink-2">{POSTINGS_COPY.fromLibrary}</p>
      ) : null}
    </>
  );
}
