import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { video } from "../../db/schema";
import { POSTINGS_EDITABLE } from "../../lib/postings/form";
import { isUuid } from "../../lib/validation/uuid";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { PostingsLockedError } from "../postings/errors";
import {
  NoVerifiedPostingError,
  OriginalNotReadyError,
  VideoNotFoundError,
} from "./errors";

// "These posts show this same video" on the Where posted step (02 §5.6, 07 D69; P11c moved it there from P11's File
// step): the tick is stored and taken back here, each under the video row lock, and only while the video's postings can
// change (POSTINGS_EDITABLE: `draft` or `unpublished`, as for saveVideoPostings).

/**
 * Locks the creator's video row (FOR UPDATE) and reads what the tick's writes check. Refusals: VideoNotFoundError (not
 * the creator's, or missing), PostingsLockedError (not `draft` or `unpublished`).
 */
async function lockForTick(
  tx: Pick<typeof db, "select">,
  creatorId: string,
  videoId: string,
) {
  const [row] = await tx
    .select({
      status: video.status,
      ownership: video.ownership,
      originalStatus: video.originalStatus,
      sameVideoConfirmedAt: video.sameVideoConfirmedAt,
    })
    .from(video)
    .where(and(eq(video.id, videoId), eq(video.creatorId, creatorId)))
    .for("update");
  if (!row) throw new VideoNotFoundError();
  if (!POSTINGS_EDITABLE.includes(row.status)) throw new PostingsLockedError();
  return row;
}

/**
 * Stores the tick: the owner's `draft` or `unpublished` video with a `ready` original and at least one verified posting,
 * any source, gets `same_video_confirmed_at`, once. Confirming again keeps the first time and writes nothing. Refusals,
 * in this order: VideoNotFoundError, PostingsLockedError, NoVerifiedPostingError, OriginalNotReadyError. "A verified
 * posting" is the locked row's `ownership = 'verified_owner'` (07 D66): every posting write refreshes it
 * (refreshVideoOwnership) under this same video lock, so a save or Check again that changes the verified set (and
 * clears the tick, D69) is either seen whole or waits.
 */
export async function confirmSameVideo(
  a: Actor,
  videoId: string,
): Promise<void> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(videoId)) throw new VideoNotFoundError();
  await db.transaction(async (tx) => {
    const row = await lockForTick(tx, creatorId, videoId);
    if (row.ownership !== "verified_owner") throw new NoVerifiedPostingError();
    if (row.originalStatus !== "ready") throw new OriginalNotReadyError();
    if (row.sameVideoConfirmedAt) return;
    await tx
      .update(video)
      .set({ sameVideoConfirmedAt: new Date() })
      .where(eq(video.id, videoId));
  });
}

/**
 * Takes the tick back (owner answer Q-83 a: the creator unticked a stored "These posts show this same video" and pressed
 * Continue): `same_video_confirmed_at` cleared, a no-op when it is already clear. Refusals, in this order:
 * VideoNotFoundError, PostingsLockedError.
 */
export async function withdrawSameVideo(
  a: Actor,
  videoId: string,
): Promise<void> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(videoId)) throw new VideoNotFoundError();
  await db.transaction(async (tx) => {
    const row = await lockForTick(tx, creatorId, videoId);
    if (row.sameVideoConfirmedAt === null) return;
    await tx
      .update(video)
      .set({ sameVideoConfirmedAt: null })
      .where(eq(video.id, videoId));
  });
}
