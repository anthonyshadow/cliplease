// The credit line a licensee posts with the video (01 §4.4; 07 D43, D71): read from the same primary verified posting
// as the badge (publicBadge's rule), so the two never disagree. Pure.
import type { PublicPostingDTO } from "../postings/types";

/**
 * "Video: {verified_username} on {Platform}" from the primary verified posting, its username printed as stored (it
 * carries its own "@", a YouTube channel title none) and its platform's label ("Demo" for the demo account); with no
 * verified posting, "Video: @{handle}". No quotes: whatever fills a {credit_line} token adds them.
 */
export function creditLine({
  handle,
  primary,
}: {
  handle: string;
  primary: Pick<
    PublicPostingDTO,
    "label" | "verifiedUsername" | "linkedAt"
  > | null;
}): string {
  if (!primary?.verifiedUsername || !primary.linkedAt) {
    return `Video: @${handle}`;
  }
  return `Video: ${primary.verifiedUsername} on ${primary.label}`;
}
