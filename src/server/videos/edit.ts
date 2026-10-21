import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client";
import { video } from "../../db/schema";
import { isUuid } from "../../lib/validation/uuid";
import { type Actor, requireCreatorActor } from "../auth/actor";
import {
  NotFromLibraryError,
  OriginalNotReadyError,
  VideoNotFoundError,
} from "./errors";

/**
 * The File step's "This file is the same video as the post" (07 D39; P11 stages it there, P11c moves it to Where posted
 * and widens it to any video with a verified posting, D69): the owner's Library video with a `ready` original gets
 * `same_video_confirmed_at`, once. Confirming again keeps the first time and writes nothing. Refusals, in this order:
 * VideoNotFoundError, NotFromLibraryError, OriginalNotReadyError.
 */
export async function confirmSameVideo(
  a: Actor,
  videoId: string,
): Promise<void> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(videoId)) throw new VideoNotFoundError();
  const mine = and(eq(video.id, videoId), eq(video.creatorId, creatorId));
  const [confirmed] = await db
    .update(video)
    .set({ sameVideoConfirmedAt: new Date() })
    .where(
      and(
        mine,
        eq(video.source, "library"),
        eq(video.originalStatus, "ready"),
        isNull(video.sameVideoConfirmedAt),
      ),
    )
    .returning({ id: video.id });
  if (confirmed) return;
  // Nothing changed: already confirmed, or refused. Say which.
  const [row] = await db
    .select({ source: video.source, originalStatus: video.originalStatus })
    .from(video)
    .where(mine);
  if (!row) throw new VideoNotFoundError();
  if (row.source !== "library") throw new NotFromLibraryError();
  if (row.originalStatus !== "ready") throw new OriginalNotReadyError();
}
