import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "../../db/client";
import {
  creatorProfile,
  license,
  licenseRequest,
  socialPost,
  video,
  videoPosting,
} from "../../db/schema";
import type { Video } from "../../db/schema/types";
import type {
  Currency,
  OriginalFileStatus,
  PosterOrigin,
  PostingVerification,
  SocialProviderId,
  VideoSource,
  VideoStatus,
} from "../../lib/domain/values";
import type { LibraryPostDTO } from "../../lib/library/post";
import { isUuid } from "../../lib/validation/uuid";
import { type BadgeInput, ownerBadge } from "../../lib/videos/ownership";
import { type RightsLock, rightsLockOf } from "../../lib/videos/rights";
import {
  firstIncompleteStep,
  videoStepFacts,
  videoStepHref,
} from "../../lib/videos/steps";
import { offersShareLink } from "../../lib/videos/video-page";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { postThumbnail } from "../library/queries";
import { ownerPostingsByVideo } from "../postings/queries";
import { getRateCard, videoFromPrice } from "../pricing/rate-card";
import { lockedBy, lockFlags } from "../storage/uploads";
import { ownedVideo } from "./scope";
import { posterSrc, shareUrl } from "./visibility";

/**
 * A Library video's source posting and its post, as the Library File step shows them (P11; 07 D39, D65): the post's
 * thumbnail beside the cover (the Library's creator-only proxy URL, the only place the post's own id appears), the
 * duration check and the provenance line. No account, platform or link ids. `postedAt` is null once a stale scrub
 * cleared it (07 D72).
 */
export type CreatorSourcePostDTO = Pick<
  LibraryPostDTO,
  "platform" | "postedAt" | "durationSec" | "thumbnailSrc" | "width" | "height"
> & {
  /** The posting is verified (an admin Disable releases it, keeping its fields for audit; 07 D66). */
  verified: boolean;
  /** 07 D43's display form ("@demo.creator", or a channel title), printed as stored: never given an "@". */
  verifiedUsername: string | null;
};

/**
 * What the Make licensable steps turn on (07 D69): src/lib/videos/steps.ts' videoStepFacts derives resolveStep's
 * VideoStepFacts from it. Part of CreatorVideoDTO, read alone, uncached, by getVideoStepFacts, and returned by
 * saveVideoPostings as its write left them. `hasVerifiedPosting` is `video.ownership = 'verified_owner'`, the summary
 * refreshVideoOwnership keeps in step with the postings in every posting write (07 D66).
 */
export type VideoStepState = {
  status: VideoStatus;
  originalStatus: OriginalFileStatus;
  /** 'library' videos arrive with their locked source posting (07 D65, D69). */
  source: VideoSource;
  /** postings_confirmed_at as ISO: Where posted was saved, also as "I haven't posted it anywhere yet." (07 D69). */
  postingsConfirmedAt: string | null;
  /** same_video_confirmed_at is set ("These posts show this same video", 07 D69). */
  sameVideoConfirmed: boolean;
  /** At least one posting is verified, so the same-video tick is required (07 D66, D69). */
  hasVerifiedPosting: boolean;
  rightsAnswered: boolean;
};

/** The creator's own video as the Make licensable pages show it: no object key, upload id or creator id (02 §5.10). */
export type CreatorVideoDTO = VideoStepState & {
  id: string;
  title: string;
  slug: string;
  /** 07 D09: the slug can't change once the video was first published. */
  slugLocked: boolean;
  /** The Rights answers, null until answered. */
  containsMusic: boolean | null;
  identifiablePeople: boolean | null;
  /** Why the Rights answers can't change now (owner answer Q-96 a), or null. */
  rightsLock: RightsLock | null;
  originalError: string | null;
  originalFilename: string | null;
  /** The original's size (the video page's "0.2 MB"), null until an original is attached. */
  originalBytes: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** The owner's poster URL (`?v=` changes with the stored poster, never names its key), or null. */
  posterSrc: string | null;
  posterOrigin: PosterOrigin | null;
  /** 07 D09: Replace is hidden while the original can't change. */
  originalLocked: boolean;
  /** The source posting (`is_source`): a Library video's one, null for an upload. */
  sourcePost: CreatorSourcePostDTO | null;
};

/**
 * The step facts' columns: read by the readers below and by publish.ts, and returned by saveVideoPostings' final video
 * update (its `facts`, so the Continue needn't read them again).
 */
export const stepFactColumns = {
  status: video.status,
  originalStatus: video.originalStatus,
  source: video.source,
  postingsConfirmedAt: video.postingsConfirmedAt,
  sameVideoConfirmedAt: video.sameVideoConfirmedAt,
  ownership: video.ownership,
  rightsAttestedAt: video.rightsAttestedAt,
};

/** The step facts from a row of stepFactColumns. */
export function stepFactsOf(
  row: Pick<Video, keyof typeof stepFactColumns>,
): VideoStepState {
  return {
    status: row.status,
    originalStatus: row.originalStatus,
    source: row.source,
    postingsConfirmedAt: row.postingsConfirmedAt?.toISOString() ?? null,
    sameVideoConfirmed: row.sameVideoConfirmedAt !== null,
    hasVerifiedPosting: row.ownership === "verified_owner",
    rightsAnswered: row.rightsAttestedAt !== null,
  };
}

/** The DTO's source post from the joined columns; null without a source posting (an upload). */
function sourcePostOf(row: {
  postingVerification: PostingVerification | null;
  verifiedUsername: string | null;
  postId: string | null;
  postPlatform: SocialProviderId | null;
  postedAt: Date | null;
  postDurationSec: number | null;
  postThumbnailUrl: string | null;
  postThumbnailFetchedAt: Date | null;
  postWidth: number | null;
  postHeight: number | null;
}): CreatorSourcePostDTO | null {
  if (!row.postId || !row.postPlatform) return null;
  return {
    platform: row.postPlatform,
    verified: row.postingVerification === "verified",
    verifiedUsername: row.verifiedUsername,
    postedAt: row.postedAt?.toISOString() ?? null,
    durationSec: row.postDurationSec,
    thumbnailSrc: postThumbnail({
      id: row.postId,
      thumbnailUrl: row.postThumbnailUrl,
      thumbnailFetchedAt: row.postThumbnailFetchedAt,
    }).thumbnailSrc,
    width: row.postWidth,
    height: row.postHeight,
  };
}

// Cached per request by ids (the actor object differs between generateMetadata and the page).
const videoForCreator = cache(
  async (
    creatorId: string,
    videoId: string,
  ): Promise<CreatorVideoDTO | null> => {
    if (!isUuid(videoId)) return null;
    const [row] = await db
      .select({
        ...stepFactColumns,
        id: video.id,
        title: video.title,
        slug: video.slug,
        publishedAt: video.publishedAt,
        containsMusic: video.containsMusic,
        identifiablePeople: video.identifiablePeople,
        originalError: video.originalError,
        originalFilename: video.originalFilename,
        originalBytes: video.originalBytes,
        durationMs: video.durationMs,
        width: video.width,
        height: video.height,
        posterObjectKey: video.posterObjectKey,
        posterOrigin: video.posterOrigin,
        ...lockFlags(db),
        // The source posting (video_posting_source_uidx: at most one) and its post (03 §7.4's Where-posted join).
        postingVerification: videoPosting.verification,
        verifiedUsername: videoPosting.verifiedUsername,
        postId: socialPost.id,
        postPlatform: socialPost.provider,
        postedAt: socialPost.postedAt,
        postDurationSec: socialPost.durationSec,
        postThumbnailUrl: socialPost.thumbnailUrl,
        postThumbnailFetchedAt: socialPost.thumbnailFetchedAt,
        postWidth: socialPost.width,
        postHeight: socialPost.height,
      })
      .from(video)
      .leftJoin(
        videoPosting,
        and(
          eq(videoPosting.videoId, video.id),
          eq(videoPosting.isSource, true),
        ),
      )
      .leftJoin(socialPost, eq(socialPost.id, videoPosting.socialPostId))
      .where(ownedVideo(creatorId, videoId));
    if (!row) return null;
    return {
      ...stepFactsOf(row),
      id: row.id,
      title: row.title,
      slug: row.slug,
      slugLocked: row.publishedAt !== null,
      containsMusic: row.containsMusic,
      identifiablePeople: row.identifiablePeople,
      rightsLock: rightsLockOf(row),
      originalError: row.originalError,
      originalFilename: row.originalFilename,
      originalBytes: row.originalBytes,
      durationMs: row.durationMs,
      width: row.width,
      height: row.height,
      posterSrc: posterSrc(row),
      posterOrigin: row.posterOrigin,
      originalLocked: lockedBy(row),
      sourcePost: sourcePostOf(row),
    };
  },
);

/** The creator's own video, or null (another creator's, missing, or not a uuid). */
export function getVideoForCreator(
  a: Actor,
  videoId: string,
): Promise<CreatorVideoDTO | null> {
  return videoForCreator(requireCreatorActor(a).creatorId, videoId);
}

/**
 * The creator's own video's step facts read now, or null (another creator's, missing, or not a uuid). Not cached: P11c's
 * composed Continue reads them again after its writes in the same request, where getVideoForCreator's cache() would
 * answer with the first read.
 */
export async function getVideoStepFacts(
  a: Actor,
  videoId: string,
): Promise<VideoStepState | null> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(videoId)) return null;
  const [row] = await db
    .select(stepFactColumns)
    .from(video)
    .where(ownedVideo(creatorId, videoId));
  return row ? stepFactsOf(row) : null;
}

/** 03 §7.4's counts of a video: requests waiting for approval, and licenses sold. */
const requestCounts = {
  pendingCount: db.$count(
    licenseRequest,
    and(
      eq(licenseRequest.videoId, video.id),
      eq(licenseRequest.status, "awaiting_approval"),
    ),
  ),
  licenseCount: db.$count(license, eq(license.videoId, video.id)),
};

/** The creator's video's 03 §7.4 counts (the video page's Requests line), or null when it isn't the creator's. */
export async function getRequestCounts(
  a: Actor,
  videoId: string,
): Promise<{ pendingCount: number; licenseCount: number } | null> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(videoId)) return null;
  const [row] = await db
    .select(requestCounts)
    .from(video)
    .where(ownedVideo(creatorId, videoId));
  return row ?? null;
}

/** One card on /dashboard/videos (04 §9.27; 03 §7.4): no object key, creator id or upload id reaches it. */
export type CreatorVideoCardDTO = {
  id: string;
  title: string;
  status: VideoStatus;
  posterSrc: string | null;
  width: number | null;
  height: number | null;
  /** The sm badge from the primary verified posting, else self-attested (07 D70, D89). */
  badge: BadgeInput;
  /** "From {price}" in `currency` (fromPriceCents), null when no combination can be bought (isUnlicensable). */
  fromPriceCents: number | null;
  currency: Currency;
  /** A draft's Continue: its first incomplete step. */
  continueHref: string | null;
  /** The link to share while the video is Live or Off (as on its page); none for a draft or a disabled video. */
  shareUrl: string | null;
  /** Requests awaiting approval and licenses (03 §7.4's list query); the cards don't show them yet. */
  pendingCount: number;
  licenseCount: number;
};

/**
 * The creator's videos as cards (S20; 03 §7.4): drafts first, then the most recently changed. The videos with their
 * counts, every posting of the creator's videos (for the badges), the handle and the rate card are read together, so a
 * card costs no query of its own.
 */
export async function listCreatorVideos(
  a: Actor,
): Promise<{ handle: string; videos: CreatorVideoCardDTO[] }> {
  const { creatorId } = requireCreatorActor(a);
  const [rows, postings, [creator], rateCard] = await Promise.all([
    db
      .select({
        ...stepFactColumns,
        id: video.id,
        title: video.title,
        slug: video.slug,
        posterObjectKey: video.posterObjectKey,
        width: video.width,
        height: video.height,
        disabledUses: video.disabledUses,
        basePriceOverrideCents: video.basePriceOverrideCents,
        ...requestCounts,
      })
      .from(video)
      .where(eq(video.creatorId, creatorId))
      .orderBy(
        desc(sql`${video.status} = 'draft'`),
        desc(video.updatedAt),
        asc(video.id),
      ),
    ownerPostingsByVideo(creatorId),
    db
      .select({ handle: creatorProfile.handle })
      .from(creatorProfile)
      .where(eq(creatorProfile.id, creatorId)),
    getRateCard(creatorId),
  ]);
  if (!creator) throw new Error(`Creator ${creatorId} has no profile`);
  const videos = rows.map(
    (row): CreatorVideoCardDTO => ({
      id: row.id,
      title: row.title,
      status: row.status,
      posterSrc: posterSrc(row),
      width: row.width,
      height: row.height,
      badge: ownerBadge(postings.get(row.id) ?? [], "sm"),
      ...videoFromPrice(rateCard, row),
      continueHref:
        row.status === "draft"
          ? videoStepHref(
              row.id,
              firstIncompleteStep(videoStepFacts(stepFactsOf(row))),
            )
          : null,
      shareUrl: offersShareLink(row.status)
        ? shareUrl(creator.handle, row.slug)
        : null,
      pendingCount: row.pendingCount,
      licenseCount: row.licenseCount,
    }),
  );
  return { handle: creator.handle, videos };
}
