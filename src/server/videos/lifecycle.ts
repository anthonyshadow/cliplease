import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { video, videoPosting } from "../../db/schema";
import { isUuid } from "../../lib/validation/uuid";
import { writeAudit } from "../audit";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { removeVideoObjects } from "../storage/uploads";
import { VideoNotDraftError, VideoNotFoundError } from "./errors";

// Turn off and Delete draft (02 §5.6; 03 §5.2; 01 J5.20, J5.21). Turn on is publishVideo (P14a), which runs every
// blocker again. Neither touches a license_request: a request waiting for approval stays approvable (J5.20), and a
// draft never has one (license_request_video_fk is restrict).

const own = (creatorId: string, videoId: string) =>
  and(eq(video.id, videoId), eq(video.creatorId, creatorId));

/**
 * Turn off (01 J5.20): the creator's `published` video becomes `unpublished`, with `video.unpublished` in the same
 * transaction; any other status is a no-op. `published_at` and the slug stay (07 D09). The conditional update waits for
 * a publish, a postings save or a rights answer holding the row lock, then re-checks the status (READ COMMITTED).
 * VideoNotFoundError when the video isn't the creator's.
 */
export async function unpublishVideo(a: Actor, videoId: string): Promise<void> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(videoId)) throw new VideoNotFoundError();
  await db.transaction(async (tx) => {
    const [turnedOff] = await tx
      .update(video)
      .set({ status: "unpublished" })
      .where(and(own(creatorId, videoId), eq(video.status, "published")))
      .returning({ id: video.id });
    if (turnedOff) {
      await writeAudit(tx, a, {
        action: "video.unpublished",
        entityType: "video",
        entityId: videoId,
      });
      return;
    }
    const [row] = await tx
      .select({ id: video.id })
      .from(video)
      .where(own(creatorId, videoId));
    if (!row) throw new VideoNotFoundError();
  });
}

/**
 * Delete draft (01 J5.21; 03 §5.2): under the row lock, the creator's `draft` is deleted with
 * `video.draft_deleted { postings }` (its postings go by cascade), then its stored objects after the commit
 * (removeVideoObjects), so a publish from another tab can never leave a live video without its files (owner answer
 * Q-103 a). A video that is gone, or isn't the creator's, is already done: nothing happens. VideoNotDraftError for a
 * video past its draft (a disabled draft too).
 */
export async function deleteDraftVideo(
  a: Actor,
  videoId: string,
): Promise<void> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(videoId)) return;
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: video.status,
        originalObjectKey: video.originalObjectKey,
        originalUploadId: video.originalUploadId,
        posterObjectKey: video.posterObjectKey,
      })
      .from(video)
      .where(own(creatorId, videoId))
      .for("update");
    if (!row) return null;
    if (row.status !== "draft") throw new VideoNotDraftError();
    // Counted in a statement after the lock (lockFlags' rule), before the cascade removes them.
    const postings = await tx.$count(
      videoPosting,
      eq(videoPosting.videoId, videoId),
    );
    await tx.delete(video).where(eq(video.id, videoId));
    await writeAudit(tx, a, {
      action: "video.draft_deleted",
      entityType: "video",
      entityId: videoId,
      data: { postings },
    });
    return row;
  });
  if (deleted) await removeVideoObjects(creatorId, videoId, deleted);
}
