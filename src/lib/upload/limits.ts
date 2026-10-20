// Upload limits (07 D80, 07 §7.2; 02 §5.9). Client-safe: the P10b dropzone and the server share them, so the size and type
// rules can't drift. src/server/storage/limits.ts re-exports them with the server's URL lifetimes.

export const ORIGINAL_MAX_BYTES = 2 * 1024 ** 3; // 2 GiB, shown "2 GB" (OQ-10)
export const PART_BYTES = 16 * 1024 ** 2; // fixed 16 MiB parts; 2 GiB = 128 parts
export const PART_CONCURRENCY = 4;
export const PART_URL_BATCH = 20; // ≤ 20 part URLs per /api/uploads/parts call
export const PART_MAX_ATTEMPTS = 5; // backoff 1/2/4/8/16 s + jitter (P10c)
export const UPLOAD_RESUME_WINDOW_MS = 86_400_000; // 24 h

export const POSTER_MAX_BYTES = 2 * 1024 ** 2; // JPEG ≤ 2 MB
export const ORIGINAL_MIME = ["video/mp4", "video/quicktime"] as const;
export type OriginalMime = (typeof ORIGINAL_MIME)[number];
export const POSTER_MIME = "image/jpeg";

/** Each original type's extension: the key's (07 D61) and the one a file name is read by. */
export const ORIGINAL_EXTENSION = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
} as const satisfies Record<OriginalMime, string>;

/** The original's type from its name when the browser gives none (iPhone's "IMG_0001.MOV" often has an empty type). */
export function mimeFromFileName(name: string): OriginalMime | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase();
  return ORIGINAL_MIME.find((mime) => ORIGINAL_EXTENSION[mime] === ext) ?? null;
}

/** How many parts a file of `size` bytes takes at `partSize` (07 D80). */
export const partCount = (size: number, partSize: number) =>
  Math.ceil(size / partSize);

/** Part `n`'s size under R2's rule: every part `partSize` but the last, which holds the remainder. */
export function expectedPartSize(
  n: number,
  { size, partSize }: { size: number; partSize: number },
): number {
  const count = partCount(size, partSize);
  return n === count ? size - partSize * (count - 1) : partSize;
}
