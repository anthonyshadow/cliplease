// Resuming an original on the same device (07 D80, D103): the hint the browser keeps, which parts are left, and the
// server's view of an unfinished upload. Pure and client-safe; storage is passed in.
import { z } from "zod";
import type { UploadErrorCode } from "./codes";
import { planParts } from "./plan";

export type ResumeHint = {
  uploadId: string;
  name: string;
  size: number;
  lastModified: number;
};

export type HintStore = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> | null;

const hintSchema = z.strictObject({
  uploadId: z.string().min(1),
  name: z.string(),
  size: z.number().int().positive(),
  lastModified: z.number(),
});

/** `localStorage` key of a video's hint (07 D103). */
export const resumeHintKey = (videoId: string) => `cliplease.upload.${videoId}`;

/** The hint for `videoId`, or null; corrupt or foreign data is removed. Never throws. */
export function readResumeHint(
  store: HintStore,
  videoId: string,
): ResumeHint | null {
  if (!store) return null;
  const key = resumeHintKey(videoId);
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    const parsed = hintSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Unreadable storage or JSON: treated as no hint.
  }
  clearResumeHint(store, videoId);
  return null;
}

/** Saves the hint; a full or blocked storage only means no resume after a reload. Never throws. */
export function writeResumeHint(
  store: HintStore,
  videoId: string,
  hint: ResumeHint,
) {
  try {
    store?.setItem(resumeHintKey(videoId), JSON.stringify(hint));
  } catch {
    // Quota or a blocked storage.
  }
}

/** Removes the video's hint; with `uploadId`, only a hint naming that upload (a newer upload may have written its own). */
export function clearResumeHint(
  store: HintStore,
  videoId: string,
  uploadId?: string,
) {
  if (
    uploadId !== undefined &&
    readResumeHint(store, videoId)?.uploadId !== uploadId
  ) {
    return;
  }
  try {
    store?.removeItem(resumeHintKey(videoId));
  } catch {
    // Blocked storage.
  }
}

const RESUMABLE: readonly UploadErrorCode[] = [
  "paused",
  "canceled",
  "network",
  "unauthorized",
  "internal",
  "not_same_file",
];

/**
 * Whether the hint outlives an upload that ended with `code` (07 D80): after a pause, a Cancel's abort of the parts, a
 * dropped connection, a sign-out, a server error or a resume with another file, the open upload is still there and
 * choosing the file again resumes it; every other end (expired, a bad file, another upload in its place) leaves nothing
 * to resume.
 */
export const keepsResumeHint = (code: UploadErrorCode) =>
  RESUMABLE.includes(code);

/** The chosen file is the one the hint was written for (name, size and lastModified, 04 §9.26 Mismatch). */
export const matchesResumeHint = (
  hint: ResumeHint,
  file: { name: string; size: number; lastModified: number },
) =>
  hint.name === file.name &&
  hint.size === file.size &&
  hint.lastModified === file.lastModified;

/**
 * The parts a resume still sends and the bytes already stored, from start's `doneParts`: duplicates and part numbers
 * outside 1…partCount are ignored, and the short last part counts at its real size.
 */
export function planResume(i: {
  size: number;
  partSize: number;
  doneParts: readonly number[];
}): { missing: number[]; doneBytes: number } {
  const done = new Set(i.doneParts);
  let doneBytes = 0;
  const missing: number[] = [];
  for (const part of planParts(i.size, i.partSize)) {
    if (done.has(part.partNumber)) doneBytes += part.end - part.start;
    else missing.push(part.partNumber);
  }
  return { missing, doneBytes };
}

/** The server's view of an unfinished original (getOriginalUploadProgress): no key, part URL or ETag. */
export type OriginalUploadProgress =
  | { state: "resumable"; uploadId: string; size: number; doneBytes: number }
  | { state: "expired" }
  | null;
