import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { video, videoPosting } from "../../db/schema";
import type {
  PostingPlatform,
  SocialProviderId,
  VideoStatus,
} from "../../lib/domain/values";
import { videoUrl } from "../../lib/urls";
import { env } from "../env";

// Who may see a video and how its media is addressed (02 §4.2, §4.3; 03 §7.5; 07 D03, D19, D51, D72): the public poster
// route, the creator's public grid and the license page (P15) ask isPubliclyAvailable; every poster URL is posterSrc's.

/**
 * A video anyone may see (07 D03, D72): `published`, and no `mock` posting unless mock is enabled (D51). Only `mock`
 * gates: a Facebook or Other posting never hides a video. Pure.
 */
export function isPubliclyAvailable(
  video: { status: VideoStatus; postingPlatforms: readonly PostingPlatform[] },
  enabledPlatforms: readonly SocialProviderId[],
): boolean {
  return (
    video.status === "published" &&
    (!video.postingPlatforms.includes("mock") ||
      enabledPlatforms.includes("mock"))
  );
}

/**
 * A select column for a query over `video`: the platforms of every posting of the row's video (verified or not), as
 * isPubliclyAvailable reads them. Text, so node-postgres parses the array (it has no parser for an enum array).
 */
export const postingPlatformsColumn = sql<
  PostingPlatform[]
>`array(select ${videoPosting.platform}::text from ${videoPosting} where ${videoPosting.videoId} = ${video.id})`;

/**
 * The poster's URL (07 D19): `/api/media/posters/<id>?v=<first 8 hex of sha256(key)>`, the `?v=` changing with the
 * stored poster; null without one. The key itself never reaches a page. The only place a poster URL is built.
 */
export function posterSrc({
  id,
  posterObjectKey,
}: {
  id: string;
  posterObjectKey: string | null;
}): string | null {
  if (!posterObjectKey) return null;
  const v = createHash("sha256").update(posterObjectKey).digest("hex");
  return `/api/media/posters/${id}?v=${v.slice(0, 8)}`;
}

/** The link a creator shares (01 J6): `{APP_URL}/@{handle}/{slug}`. Built here, on the server, and passed down. */
export const shareUrl = (handle: string, slug: string) =>
  `${env.APP_URL}${videoUrl(handle, slug)}`;
