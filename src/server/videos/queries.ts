import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "../../db/client";
import { socialPost, video, videoPosting } from "../../db/schema";
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

/** The creator's own video as the Make licensable pages show it: no object key, upload id or creator id (02 §5.10). */
export type CreatorVideoDTO = {
  id: string;
  title: string;
  status: VideoStatus;
  originalStatus: OriginalFileStatus;
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
  rightsAnswered: boolean;
  /** P11: 'library' videos need the same-video tick on the File step (07 D39). */
  source: VideoSource;
  /** same_video_confirmed_at is set ("This file is the same video as the post"). */
  sameVideoConfirmed: boolean;
  /** The source posting (`is_source`): a Library video's one, null for an upload. */
  sourcePost: CreatorSourcePostDTO | null;
};

/** `/api/media/posters/<id>?v=<first 8 hex of sha256(key)>` (P14a moves this to `posterSrc` in visibility.ts). */
function ownerPosterSrc(id: string, posterObjectKey: string | null) {
  if (!posterObjectKey) return null;
  const v = createHash("sha256").update(posterObjectKey).digest("hex");
  return `/api/media/posters/${id}?v=${v.slice(0, 8)}`;
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
        id: video.id,
        title: video.title,
        status: video.status,
        originalStatus: video.originalStatus,
        originalError: video.originalError,
        originalFilename: video.originalFilename,
        durationMs: video.durationMs,
        width: video.width,
        height: video.height,
        posterObjectKey: video.posterObjectKey,
        posterOrigin: video.posterOrigin,
        rightsAttestedAt: video.rightsAttestedAt,
        source: video.source,
        sameVideoConfirmedAt: video.sameVideoConfirmedAt,
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
      id: row.id,
      title: row.title,
      status: row.status,
      originalStatus: row.originalStatus,
      originalError: row.originalError,
      originalFilename: row.originalFilename,
      durationMs: row.durationMs,
      width: row.width,
      height: row.height,
      posterSrc: ownerPosterSrc(row.id, row.posterObjectKey),
      posterOrigin: row.posterOrigin,
      originalLocked: lockedBy(row),
      rightsAnswered: row.rightsAttestedAt !== null,
      source: row.source,
      sameVideoConfirmed: row.sameVideoConfirmedAt !== null,
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
