import { VerifiedOwnerBadge } from "@/components/license/verified-owner-badge";
import { PricePreview } from "@/components/pricing/price-preview";
import { Banner } from "@/components/ui/banner";
import type { PayoutsStatus } from "@/lib/domain/values";
import { COVER_COPY } from "@/lib/upload/messages";
import { ownerBadge } from "@/lib/videos/ownership";
import {
  COVER_IMAGE_ID,
  disabledLine,
  publishBlockerRows,
  REVIEW_COPY,
} from "@/lib/videos/review";
import { videoStepHref } from "@/lib/videos/steps";
import type { Actor } from "@/server/auth/actor";
import { listVideoPostings } from "@/server/postings/queries";
import { getPublishBlockers } from "@/server/videos/publish";
import type { CreatorVideoDTO } from "@/server/videos/queries";
import { PosterPicker } from "./poster-picker";
import { PublishButton } from "./publish-button";
import { RefreshOnCoverDone } from "./refresh-on-cover";
import { ReviewBlockers } from "./review-blockers";
import { ReviewDetails } from "./review-details";
import { ReviewPayoutsNotice } from "./review-payouts-notice";
import { VideoStepFrame } from "./video-step-frame";
import { EditLink, PostingSummary } from "./where-posted-summary";

/**
 * Step 4 · Review, `/dashboard/videos/<id>?step=review` (01 J5.16, J5.17; 05 §6.5 callouts 42–52; 07 D69, D74, D146,
 * D156), in Rights' layout. The step: "Ready to publish" when nothing blocks, the rows (Title and Link edited in place,
 * the cover image, "Where it was posted" with _Edit_ to that step, the video's prices read-only and the badge buyers
 * will see), the payouts Notice while payouts aren't on (never a blocker), "Before you can publish", and Publish, off
 * while anything blocks (once published, the page renders PublishedView instead). The postings and the blockers (with
 * the effective options) are read together.
 */
export async function ReviewStep({
  actor,
  video,
  handle,
  payoutsStatus,
  platformFeeBps,
}: {
  actor: Actor;
  video: CreatorVideoDTO;
  handle: string;
  /** Read by the page and awaited with the Review's own reads. */
  payoutsStatus: Promise<PayoutsStatus>;
  platformFeeBps: number;
}) {
  const [postings, publish, payouts] = await Promise.all([
    listVideoPostings(actor, video.id),
    getPublishBlockers(actor, video.id),
    payoutsStatus,
  ]);
  const rows = publishBlockerRows(
    publish.blockers,
    video.id,
    publish.reconnectPlatforms,
  );
  return (
    <VideoStepFrame video={video} step="review">
      {publish.disabledReason ? (
        <Banner tone="error">{disabledLine(publish.disabledReason)}</Banner>
      ) : null}
      {publish.blockers.length === 0 ? (
        <h2 className="text-title-2 text-ink">{REVIEW_COPY.ready}</h2>
      ) : null}
      <ReviewDetails
        videoId={video.id}
        title={video.title}
        slug={video.slug}
        handle={handle}
        slugLocked={video.slugLocked}
        facts={[
          {
            label: COVER_COPY.label,
            id: COVER_IMAGE_ID,
            alignTop: true,
            value: (
              <PosterPicker
                videoId={video.id}
                title={video.title}
                posterSrc={video.posterSrc}
                width={video.width}
                height={video.height}
                inRow="edit"
              />
            ),
          },
          {
            label: REVIEW_COPY.wherePosted,
            value: <PostingSummary postings={postings} />,
            action: (
              <EditLink
                href={videoStepHref(video.id, "postings")}
                row={REVIEW_COPY.wherePosted}
              />
            ),
          },
          {
            label: REVIEW_COPY.prices,
            value: (
              <PricePreview
                options={publish.options}
                platformFeeBps={platformFeeBps}
                readOnly
              />
            ),
          },
          {
            label: REVIEW_COPY.buyersSee,
            value: <VerifiedOwnerBadge {...ownerBadge(postings, "lg")} />,
          },
        ]}
      />
      <ReviewPayoutsNotice
        status={payouts}
        currency={publish.options.currency}
        returnTo={videoStepHref(video.id, "review")}
      />
      <ReviewBlockers rows={rows} />
      <RefreshOnCoverDone videoId={video.id} />
      <PublishButton videoId={video.id} blocked={publish.blockers.length > 0} />
    </VideoStepFrame>
  );
}
