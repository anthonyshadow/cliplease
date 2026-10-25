import "server-only";
import { randomUUID } from "node:crypto";

// Object keys (02 §5.9, 07 D61): made on the server from ids and a random uuid. No PII and never the creator's file name;
// the extension comes from the validated type.

/** `originals/{creatorId}/{videoId}/`: the folder every original of the video goes in (Delete draft sweeps it). */
export const originalPrefix = (creatorId: string, videoId: string) =>
  `originals/${creatorId}/${videoId}/`;

/** `originals/{creatorId}/{videoId}/{uuid}.{mp4|mov}`. */
export const originalKey = (
  creatorId: string,
  videoId: string,
  ext: "mp4" | "mov",
) => `${originalPrefix(creatorId, videoId)}${randomUUID()}.${ext}`;

/** `posters/{videoId}/`: the folder every poster of the video goes in (the stray sweep lists it). */
export const posterPrefix = (videoId: string) => `posters/${videoId}/`;

/** `posters/{videoId}/{uuid}.jpg`. */
export const posterKey = (videoId: string) =>
  `${posterPrefix(videoId)}${randomUUID()}.jpg`;

const POSTER_KEY = /^posters\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.jpg$/;

/** The video a poster key belongs to, or null for anything posterKey didn't make. */
export const posterKeyVideoId = (key: string) =>
  POSTER_KEY.exec(key)?.[1] ?? null;
