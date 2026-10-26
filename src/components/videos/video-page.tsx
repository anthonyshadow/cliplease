import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CREATOR_NAV } from "@/components/layout/creator-nav";
import { TWO_COLUMN } from "@/components/layout/gutter";
import { PosterFrame } from "@/components/license/poster-frame";
import { VerifiedOwnerBadge } from "@/components/license/verified-owner-badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CopyLinkField } from "@/components/ui/copy-link-field";
import { ShareButton } from "@/components/ui/share-button";
import type { OwnerPostingDTO } from "@/lib/postings/types";
import { fromPriceCents } from "@/lib/pricing/from-price";
import { COVER_COPY } from "@/lib/upload/messages";
import type { OriginalUploadProgress } from "@/lib/upload/resume";
import { cn } from "@/lib/utils";
import { ownerBadge } from "@/lib/videos/ownership";
import {
  COVER_IMAGE_ID,
  disabledLine,
  ORIGINAL_FILE_ID,
  PUBLISHED_COPY,
  publishBlockerRows,
  REVIEW_COPY,
} from "@/lib/videos/review";
import { RIGHTS_LOCK_COPY } from "@/lib/videos/rights";
import { videoStepHref } from "@/lib/videos/steps";
import {
  fromPriceLine,
  offersShareLink,
  originalLine,
  removedPostLine,
  requestsLine,
  rightsSummary,
  VIDEO_PAGE_COPY,
} from "@/lib/videos/video-page";
import type { Actor } from "@/server/auth/actor";
import { listVideoPostings } from "@/server/postings/queries";
import { getOriginalUploadProgress } from "@/server/storage/uploads";
import { getPublishBlockers } from "@/server/videos/publish";
import {
  type CreatorVideoDTO,
  getRequestCounts,
} from "@/server/videos/queries";
import { shareUrl } from "@/server/videos/visibility";
import { BackLink } from "./back-link";
import { DoneLine } from "./done-line";
import { uploadVideo } from "./file-step";
import { FileStepUpload } from "./file-step-upload";
import { PosterPicker } from "./poster-picker";
import { PostingsReadOnly } from "./postings-read-only";
import { RefreshOnCoverDone } from "./refresh-on-cover";
import { ReviewBlockers } from "./review-blockers";
import { ReviewDetails } from "./review-details";
import { TurnButton } from "./turn-button";
import { VideoStatusPill } from "./video-status-pill";
import { EditLink, PostingSummary } from "./where-posted-summary";

/**
 * The video page (S19; 05 §6.7; 01 J5.19–J5.21, J6) of a video past its draft, live, off or disabled: its postings (with
 * their removed posts), its blockers (Turn on runs them again) with the prices, its request counts, and an Off video's
 * paused upload (P10c), read together.
 */
export async function VideoPage({
  actor,
  video,
  handle,
  platformFeeBps,
}: {
  actor: Actor;
  video: CreatorVideoDTO;
  handle: string;
  platformFeeBps: number;
}) {
  const [postings, publish, counts, progress] = await Promise.all([
    listVideoPostings(actor, video.id),
    getPublishBlockers(actor, video.id),
    getRequestCounts(actor, video.id),
    video.status === "unpublished" && video.originalStatus === "uploading"
      ? getOriginalUploadProgress(actor, { videoId: video.id })
      : null,
  ]);
  if (!counts) notFound();
  return (
    <VideoPageView
      video={video}
      handle={handle}
      shareUrl={shareUrl(handle, video.slug)}
      postings={postings}
      publish={publish}
      counts={counts}
      platformFeeBps={platformFeeBps}
      progress={progress}
    />
  );
}

/**
 * The page itself. From lg two columns in max-w-app (poster and share left, sections right); below lg one centered
 * max-w-reading column in the Mobile order (07 D146; 05 §1.6 S19). The poster is the small frame beside the title on a
 * phone (05's frame) and the large one, at most 60svh, from md. Sections: Requests, Details, Where it was posted,
 * Original file, Rights, Prices, then Turn off / Turn on. Off: its Banner, Where posted and the original editable.
 * Disabled: the admin's reason only (never the note, 07 D45), nothing editable, no link and no prices.
 */
export function VideoPageView({
  video,
  handle,
  shareUrl: link,
  postings,
  publish,
  counts,
  platformFeeBps,
  progress,
}: {
  video: CreatorVideoDTO;
  handle: string;
  shareUrl: string;
  postings: readonly OwnerPostingDTO[];
  publish: Awaited<ReturnType<typeof getPublishBlockers>>;
  counts: { pendingCount: number; licenseCount: number };
  platformFeeBps: number;
  progress: OriginalUploadProgress;
}) {
  const { status } = video;
  const live = status === "published";
  const off = status === "unpublished";
  const disabled = status === "disabled";
  const url = offersShareLink(status) ? link : null;
  const poster = {
    src: video.posterSrc,
    alt: `Cover image for ${video.title}`,
    width: video.width,
    height: video.height,
  };
  const from = fromPriceCents(publish.options, platformFeeBps);
  const uses = publish.options.use
    .filter((use) => use.enabled)
    .map((use) => use.label)
    .join(" · ");
  const rights = rightsSummary(video.containsMusic, video.identifiablePeople);
  // 01 J3.9: a verified posting's post the platform removed.
  const removed = postings.flatMap(
    ({ id, platform, verification, removedAt }) =>
      verification === "verified" && removedAt
        ? [{ id, platform, removedAt: new Date(removedAt) }]
        : [],
  );
  return (
    <div data-video-page className={TWO_COLUMN.page}>
      <div className={TWO_COLUMN.span}>
        <BackLink href={CREATOR_NAV.videos.href}>Videos</BackLink>
      </div>
      <div
        data-video-aside
        className={cn(TWO_COLUMN.side, "flex flex-col gap-4")}
      >
        <div className="hidden md:block">
          <PosterFrame {...poster} />
        </div>
        <div className="flex items-start gap-4">
          <PosterFrame size="small" className="md:hidden" {...poster} />
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="text-title-1 text-ink wrap-anywhere">
              {video.title}
            </h1>
            <VideoStatusPill status={status} className="self-start" />
            <VerifiedOwnerBadge {...ownerBadge(postings, "sm")} showUnlinked />
          </div>
        </div>
        {url ? (
          <>
            <CopyLinkField url={url} label={PUBLISHED_COPY.shareLink} />
            {/* 05 §6.7 callout 3: Share… (where the browser can) and the buyer's page in a new tab (owner answer Q-116 a). */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <ShareButton url={url} />
              <Button asChild variant="link" size="sm">
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={VIDEO_PAGE_COPY.viewLicensePageLabel}
                >
                  {VIDEO_PAGE_COPY.viewLicensePage}
                </a>
              </Button>
            </div>
          </>
        ) : null}
      </div>
      <div
        data-video-sections
        className={cn(TWO_COLUMN.main, "flex flex-col gap-6 lg:gap-10")}
      >
        {off ? <Banner tone="info">{VIDEO_PAGE_COPY.off}</Banner> : null}
        {disabled ? (
          <Banner tone="error">
            {disabledLine(publish.disabledReason ?? "other")}
          </Banner>
        ) : (
          removed.map((post) => (
            <Banner key={post.id} tone="info">
              {removedPostLine(post.platform, post.removedAt, status)}
            </Banner>
          ))
        )}
        <VideoSection id="requests" title={VIDEO_PAGE_COPY.requests}>
          <p className="text-body text-ink">
            {requestsLine(counts.pendingCount, counts.licenseCount)}
          </p>
          <Button asChild variant="link" className="self-start">
            <Link href={CREATOR_NAV.inbox.href}>
              {VIDEO_PAGE_COPY.openInbox}
            </Link>
          </Button>
        </VideoSection>
        <VideoSection id="details" title={VIDEO_PAGE_COPY.details}>
          <ReviewDetails
            videoId={video.id}
            title={video.title}
            slug={video.slug}
            handle={handle}
            slugLocked={video.slugLocked}
            savedToast
            readOnly={disabled}
            facts={[
              {
                label: COVER_COPY.label,
                id: COVER_IMAGE_ID,
                alignTop: true,
                value: disabled ? (
                  <PosterFrame size="small" {...poster} />
                ) : (
                  <PosterPicker
                    videoId={video.id}
                    title={video.title}
                    posterSrc={video.posterSrc}
                    width={video.width}
                    height={video.height}
                    inRow="change"
                  />
                ),
              },
            ]}
          />
          {disabled ? null : <RefreshOnCoverDone videoId={video.id} />}
        </VideoSection>
        <VideoSection
          id="where-posted"
          title={REVIEW_COPY.wherePosted}
          action={
            off ? (
              <EditLink
                href={videoStepHref(video.id, "postings")}
                row={REVIEW_COPY.wherePosted}
              />
            ) : null
          }
        >
          {live ? (
            <PostingsReadOnly postings={postings} />
          ) : (
            <div className="text-body text-ink">
              <PostingSummary postings={postings} />
            </div>
          )}
        </VideoSection>
        <VideoSection id={ORIGINAL_FILE_ID} title={VIDEO_PAGE_COPY.original}>
          {off && !video.originalLocked ? (
            <FileStepUpload
              video={uploadVideo(video)}
              replace
              progress={progress}
            />
          ) : (
            <>
              {video.originalStatus === "ready" ? (
                <DoneLine>{originalLine(video)}</DoneLine>
              ) : null}
              {disabled ? null : (
                <p className="text-footnote text-ink-2">
                  {VIDEO_PAGE_COPY.replaceLocked}
                </p>
              )}
            </>
          )}
        </VideoSection>
        <VideoSection
          id="rights"
          title={VIDEO_PAGE_COPY.rights}
          action={
            disabled || video.rightsLock ? null : (
              <EditLink
                href={videoStepHref(video.id, "rights")}
                row={VIDEO_PAGE_COPY.rights}
              />
            )
          }
        >
          {rights ? <p className="text-body text-ink">{rights}</p> : null}
          <p className="text-footnote text-ink-2">
            {RIGHTS_LOCK_COPY[video.rightsLock ?? "license"]}
          </p>
        </VideoSection>
        {disabled ? null : (
          <VideoSection id="prices" title={VIDEO_PAGE_COPY.prices}>
            {from === null ? null : (
              <p className="text-body text-ink tabular-nums">
                {fromPriceLine(
                  from,
                  publish.options.currency,
                  publish.options.basePriceSource,
                )}
              </p>
            )}
            {uses ? <p className="text-callout text-ink-2">{uses}</p> : null}
            <Button asChild variant="link" className="self-start">
              <Link href={CREATOR_NAV.pricing.href}>
                {VIDEO_PAGE_COPY.editRateCard}
              </Link>
            </Button>
          </VideoSection>
        )}
        {live || off ? (
          <div
            data-video-actions
            className="flex flex-col gap-6 border-t border-hairline pt-6 lg:pt-10"
          >
            {off ? (
              <ReviewBlockers
                rows={publishBlockerRows(
                  publish.blockers,
                  video.id,
                  publish.reconnectPlatforms,
                  "video_page",
                )}
              />
            ) : null}
            <TurnButton
              videoId={video.id}
              live={live}
              blocked={publish.blockers.length > 0}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One section of the page (05 §6.7's "────" rules; 04 §5.1, 07 D151): a hairline above all but the first, 48 / 80 from
 * the one before (with the column's gap) and 16 / 24 from its heading, which carries the section's _Edit_ (`action`).
 */
function VideoSection({
  id,
  title,
  action = null,
  children,
}: {
  id: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 not-first-of-type:border-t not-first-of-type:border-hairline not-first-of-type:pt-6 lg:gap-6 lg:not-first-of-type:pt-10"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} className="text-title-2 text-ink">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
