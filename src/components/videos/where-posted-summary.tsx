import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import {
  editRowLabel,
  postingSummaryLine,
  REVIEW_COPY,
} from "@/lib/videos/review";

/**
 * "Where it was posted" as one line per posting (05 §6.5 callout 46; the video page while Off or Disabled, §6.7's Off
 * frame), or "Not posted anywhere yet". No link is ever shown.
 */
export function PostingSummary({
  postings,
}: {
  postings: readonly OwnerPostingDTO[];
}) {
  if (postings.length === 0) return REVIEW_COPY.notPosted;
  return (
    <ul className="flex flex-col gap-1">
      {postings.map((posting) => (
        <li key={posting.id} className="wrap-anywhere">
          {postingSummaryLine(posting)}
        </li>
      ))}
    </ul>
  );
}

/** A row's _Edit_ to the step that changes it, named for the row ("Edit where it was posted", "Edit rights"). */
export function EditLink({ href, row }: { href: string; row: string }) {
  return (
    <Button asChild variant="tertiary" size="sm" aria-label={editRowLabel(row)}>
      <Link href={href}>{REVIEW_COPY.edit}</Link>
    </Button>
  );
}
