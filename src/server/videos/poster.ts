import "server-only";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { creatorProfile, video } from "../../db/schema";
import type { SocialProviderId } from "../../lib/domain/values";
import { isUuid } from "../../lib/validation/uuid";
import { getSessionUser } from "../auth/session";
import { notFoundNoStore } from "../http";
import { errorName, logEvent } from "../log";
import { enabledPlatforms } from "../social/registry";
import { storage } from "../storage";
import { posterKeyVideoId } from "../storage/keys";
import { isPubliclyAvailable, postingPlatformsColumn } from "./visibility";

const PUBLIC =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
const PRIVATE = "private, no-store";

/**
 * The poster route's read (02 §4.2, §6.2; 03 §7.5): a video anyone may see (isPubliclyAvailable: published, and no
 * Demo posting unless Demo is enabled, 07 D72) gets its poster cached publicly, decided from the row with no session
 * read (a stale session cookie would otherwise be cleared on a cached response). Otherwise the signed-in owner or an
 * admin gets it private and never cached; everyone else gets the same empty 404 (a bad id, no poster, a draft, someone
 * else's video). `?v=` is only a cache-buster.
 */
export async function posterResponse(
  videoId: string,
  platforms: readonly SocialProviderId[] = enabledPlatforms(),
): Promise<Response> {
  if (!isUuid(videoId)) return notFoundNoStore();
  const [row] = await db
    .select({
      ownerUserId: creatorProfile.userId,
      key: video.posterObjectKey,
      status: video.status,
      postingPlatforms: postingPlatformsColumn,
    })
    .from(video)
    .innerJoin(creatorProfile, eq(creatorProfile.id, video.creatorId))
    .where(eq(video.id, videoId));
  if (!row?.key || posterKeyVideoId(row.key) !== videoId) {
    return notFoundNoStore();
  }
  if (isPubliclyAvailable(row, platforms)) {
    return posterBody(videoId, row.key, PUBLIC);
  }
  const user = await getSessionUser();
  if (!user || (user.role !== "admin" && row.ownerUserId !== user.id)) {
    return notFoundNoStore();
  }
  return posterBody(videoId, row.key, PRIVATE);
}

/** The stored JPEG with `cacheControl`; a missing or unreadable object is the same 404. */
async function posterBody(
  videoId: string,
  key: string,
  cacheControl: string,
): Promise<Response> {
  try {
    const object = await storage().getStream(key);
    if (!object) return notFoundNoStore();
    return new Response(object.body, {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(object.size),
        "Cache-Control": cacheControl,
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
