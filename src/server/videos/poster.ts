import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { creatorProfile, video } from "../../db/schema";
import { isUuid } from "../../lib/validation/uuid";
import { getSessionUser } from "../auth/session";
import { notFoundNoStore } from "../http";
import { errorName, logEvent } from "../log";
import { storage } from "../storage";
import { posterKeyVideoId } from "../storage/keys";

/**
 * GET /api/media/posters/[videoId], owner/admin branch (02 §4.2; P14a adds the public one): the signed-in owner or an
 * admin gets the stored JPEG, private and never cached; everyone else gets the same empty 404 (signed out, someone
 * else's video, a bad id or no poster). `?v=` is only a cache-buster.
 */
export async function posterResponse(videoId: string): Promise<Response> {
  if (!isUuid(videoId)) return notFoundNoStore();
  const user = await getSessionUser();
  if (!user) return notFoundNoStore();
  const [row] = await db
    .select({ ownerUserId: creatorProfile.userId, key: video.posterObjectKey })
    .from(video)
    .innerJoin(creatorProfile, eq(creatorProfile.id, video.creatorId))
    .where(eq(video.id, videoId));
  if (!row?.key || posterKeyVideoId(row.key) !== videoId) {
    return notFoundNoStore();
  }
  if (user.role !== "admin" && row.ownerUserId !== user.id) {
    return notFoundNoStore();
  }
  try {
    const object = await storage().getStream(row.key);
    if (!object) return notFoundNoStore();
    return new Response(object.body, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(object.size),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logEvent("warn", "posters.read_failed", {
      videoId,
      error: errorName(error),
    });
    return notFoundNoStore();
  }
}
