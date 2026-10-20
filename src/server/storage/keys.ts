import "server-only";
import { randomUUID } from "node:crypto";

// Object keys (02 §5.9, 07 D61): made on the server from ids and a random uuid. No PII and never the creator's file name;
// the extension comes from the validated type.

/** `originals/{creatorId}/{videoId}/{uuid}.{mp4|mov}`. */
export const originalKey = (
  creatorId: string,
  videoId: string,
  ext: "mp4" | "mov",
) => `originals/${creatorId}/${videoId}/${randomUUID()}.${ext}`;

/** `posters/{videoId}/{uuid}.jpg`. */
export const posterKey = (videoId: string) =>
  `posters/${videoId}/${randomUUID()}.jpg`;

const POSTER_KEY = /^posters\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.jpg$/;

/** The video a poster key belongs to, or null for anything posterKey didn't make. */
export const posterKeyVideoId = (key: string) =>
  POSTER_KEY.exec(key)?.[1] ?? null;
