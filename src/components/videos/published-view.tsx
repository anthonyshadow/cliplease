import Link from "next/link";
import { READING_COLUMN } from "@/components/layout/gutter";
import { VerifiedOwnerBadge } from "@/components/license/verified-owner-badge";
import { Button } from "@/components/ui/button";
import { CopyLinkField } from "@/components/ui/copy-link-field";
import { FocusedHeading } from "@/components/ui/focused-heading";
import { TERTIARY } from "@/components/ui/primary-width";
import { ShareButton } from "@/components/ui/share-button";
import { LIBRARY_PATH } from "@/lib/library/filter";
import { publicBadge } from "@/lib/videos/ownership";
import { PUBLISHED_COPY } from "@/lib/videos/review";
import { videoHref } from "@/lib/videos/steps";
import { getPublicPostings } from "@/server/postings/queries";
import { shareUrl } from "@/server/videos/visibility";

/**
 * Review once the video is live (01 J5.17, J6; 05 §6.5 callouts 53–56 and States "Success"; 07 D145, D149): one
 * centered reading column at every tier in place of both Review columns. "Your video is live." (it takes the focus), the
 * badge buyers see (the public read, now that the video is published), the link with Copy, "Share…" where the browser
 * can share, then "Open video" and "Back to Library". The same address as the Review: a reload shows it again.
 */
export async function PublishedView({
  videoId,
  slug,
  handle,
}: {
  videoId: string;
  slug: string;
  handle: string;
}) {
  const postings = await getPublicPostings(videoId);
  const url = shareUrl(handle, slug);
  return (
    <div data-published-view className={READING_COLUMN}>
      <FocusedHeading className="text-title-1 text-ink outline-none">
        {PUBLISHED_COPY.live}
      </FocusedHeading>
      <VerifiedOwnerBadge {...publicBadge(postings, "lg")} />
      <CopyLinkField url={url} label={PUBLISHED_COPY.shareLink} />
      <ShareButton url={url} />
      <div className="flex flex-wrap gap-x-6">
        <Button asChild variant="tertiary" className={TERTIARY}>
          <Link href={videoHref(videoId)}>{PUBLISHED_COPY.openVideo}</Link>
        </Button>
        <Button asChild variant="tertiary" className={TERTIARY}>
          <Link href={LIBRARY_PATH}>{PUBLISHED_COPY.backToLibrary}</Link>
        </Button>
      </div>
    </div>
  );
}
