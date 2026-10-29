import "server-only";
import { and, eq } from "drizzle-orm";
import { video } from "../../db/schema";

/**
 * The video `videoId` only when `creatorId` owns it (02 §9.2): the WHERE of every creator read or write of one video,
 * so another creator's id finds nothing, exactly like a missing one.
 */
export const ownedVideo = (creatorId: string, videoId: string) =>
  and(eq(video.id, videoId), eq(video.creatorId, creatorId));
