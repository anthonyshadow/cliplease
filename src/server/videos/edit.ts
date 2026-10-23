import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { video } from "../../db/schema";
import { isUuid } from "../../lib/validation/uuid";
import { type Actor, requireCreatorActor } from "../auth/actor";
import {
  NoVerifiedPostingError,
  OriginalNotReadyError,
  VideoNotFoundError,
} from "./errors";

/**
 * "These posts show this same video" on the Where posted step (02 §5.6, 07 D69; P11c moved it there from P11's File
 * step): the owner's video with a `ready` original and at least one verified posting, any source, gets
 * `same_video_confirmed_at`, once. Confirming again keeps the first time and writes nothing. Refusals, in this order:
 * VideoNotFoundError, NoVerifiedPostingError, OriginalNotReadyError. "A verified posting" is the locked row's
 * `ownership = 'verified_owner'` (07 D66): every posting write refreshes it (refreshVideoOwnership) under this same video
 * lock, so a save or Check again that changes the verified set (and clears the tick, D69) is either seen whole or waits.
 */
export async function confirmSameVideo(
  a: Actor,
  videoId: string,
): Promise<void> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(videoId)) throw new VideoNotFoundError();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        ownership: video.ownership,
        originalStatus: video.originalStatus,
        sameVideoConfirmedAt: video.sameVideoConfirmedAt,
      })
      .from(video)
      .where(and(eq(video.id, videoId), eq(video.creatorId, creatorId)))
      .for("update");
    if (!row) throw new VideoNotFoundError();
    if (row.ownership !== "verified_owner") throw new NoVerifiedPostingError();
    if (row.originalStatus !== "ready") throw new OriginalNotReadyError();
    if (row.sameVideoConfirmedAt) return;
    await tx
      .update(video)
      .set({ sameVideoConfirmedAt: new Date() })
      .where(eq(video.id, videoId));
  });
}
