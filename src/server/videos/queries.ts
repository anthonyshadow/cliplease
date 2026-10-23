import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "../../db/client";
import { socialPost, video, videoPosting } from "../../db/schema";
import type { Video } from "../../db/schema/types";
import type {
  OriginalFileStatus,
  PosterOrigin,
  PostingVerification,
  SocialProviderId,
  VideoSource,
  VideoStatus,
} from "../../lib/domain/values";
import type { LibraryPostDTO } from "../../lib/library/post";
import { isUuid } from "../../lib/validation/uuid";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { postThumbnail } from "../library/queries";
import { lockedBy, lockFlags } from "../storage/uploads";

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
 * VideoStepFacts from it. Part of CreatorVideoDTO, and read alone, uncached, by getVideoStepFacts. `hasVerifiedPosting`
 * is `video.ownership = 'verified_owner'`, the summary refreshVideoOwnership keeps in step with the postings in every
 * posting write (07 D66).
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
  originalError: string | null;
  originalFilename: string | null;
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

/** `/api/media/posters/<id>?v=<first 8 hex of sha256(key)>` (P14a moves this to `posterSrc` in visibility.ts). */
function ownerPosterSrc(id: string, posterObjectKey: string | null) {
  if (!posterObjectKey) return null;
  const v = createHash("sha256").update(posterObjectKey).digest("hex");
  return `/api/media/posters/${id}?v=${v.slice(0, 8)}`;
}

/** The step facts' columns, read by both readers below. */
const stepFactColumns = {
  status: video.status,
  originalStatus: video.originalStatus,
  source: video.source,
  postingsConfirmedAt: video.postingsConfirmedAt,
  sameVideoConfirmedAt: video.sameVideoConfirmedAt,
  ownership: video.ownership,
  rightsAttestedAt: video.rightsAttestedAt,
};

function stepFactsOf(
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
        originalError: video.originalError,
        originalFilename: video.originalFilename,
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
      .where(and(eq(video.id, videoId), eq(video.creatorId, creatorId)));
    if (!row) return null;
    return {
      ...stepFactsOf(row),
      id: row.id,
      title: row.title,
      originalError: row.originalError,
      originalFilename: row.originalFilename,
      durationMs: row.durationMs,
      width: row.width,
      height: row.height,
      posterSrc: ownerPosterSrc(row.id, row.posterObjectKey),
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
    .where(and(eq(video.id, videoId), eq(video.creatorId, creatorId)));
  return row ? stepFactsOf(row) : null;
}
