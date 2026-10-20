import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "../../db/client";
import { video } from "../../db/schema";
import type {
  OriginalFileStatus,
  PosterOrigin,
  VideoStatus,
} from "../../lib/domain/values";
import { isUuid } from "../../lib/validation/uuid";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { lockedBy, lockFlags } from "../storage/uploads";

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
};

/** `/api/media/posters/<id>?v=<first 8 hex of sha256(key)>` (P14a moves this to `posterSrc` in visibility.ts). */
function ownerPosterSrc(id: string, posterObjectKey: string | null) {
  if (!posterObjectKey) return null;
  const v = createHash("sha256").update(posterObjectKey).digest("hex");
  return `/api/media/posters/${id}?v=${v.slice(0, 8)}`;
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
        ...lockFlags(db),
      })
      .from(video)
      .where(and(eq(video.id, videoId), eq(video.creatorId, creatorId)));
    if (!row) return null;
    const {
      posterObjectKey,
      rightsAttestedAt,
      openRequest,
      licensed,
      ...rest
    } = row;
    return {
      ...rest,
      posterSrc: ownerPosterSrc(row.id, posterObjectKey),
      originalLocked: lockedBy(row),
      rightsAnswered: rightsAttestedAt !== null,
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
