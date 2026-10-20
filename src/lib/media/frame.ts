// The pure half of the cover image work (research/infra.md §3): where to seek, how big to draw, when a frame is blank and
// how hard to compress. The DOM half is read-video-metadata.ts and encode-image.ts.

/** A cover's long edge, in pixels. */
export const POSTER_LONG_EDGE = 1080;

/** JPEG qualities tried in order: 0.82 first, 0.7 once when the first is over the size limit. */
export const JPEG_QUALITIES = [0.82, 0.7] as const;

/** The frame to capture: 1 s in, or 10 % of a shorter video; 0 when the duration isn't known. */
export function seekTime(durationSec: number): number {
  return Number.isFinite(durationSec) && durationSec > 0
    ? Math.min(1, durationSec * 0.1)
    : 0;
}

/** `width` × `height` scaled down (never up) so the long edge is at most `max`; each side at least 1. */
export function fitLongEdge(
  width: number,
  height: number,
  max = POSTER_LONG_EDGE,
): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Where to sample a frame: a 4 × 4 grid away from the edges (16 points). */
export function samplePoints(
  width: number,
  height: number,
): { x: number; y: number }[] {
  const at = (size: number, i: number) =>
    Math.min(size - 1, Math.floor(((i + 0.5) * size) / 4));
  return Array.from({ length: 16 }, (_, n) => ({
    x: at(width, n % 4),
    y: at(height, Math.floor(n / 4)),
  }));
}

// Darker than this on every channel counts as black (a fade-in's first frame is rarely exactly 0).
const BLACK_MAX = 8;

/** True when every sampled pixel (RGBA quads) is black or fully transparent. */
export function isBlankFrame(rgba: ArrayLike<number>): boolean {
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const transparent = rgba[i + 3] === 0;
    const black =
      (rgba[i] ?? 0) <= BLACK_MAX &&
      (rgba[i + 1] ?? 0) <= BLACK_MAX &&
      (rgba[i + 2] ?? 0) <= BLACK_MAX;
    if (!transparent && !black) return false;
  }
  return true;
}

/**
 * The first JPEG encoding at most `maxBytes` long, trying JPEG_QUALITIES in order; null when every one is over (or the
 * browser gave none).
 */
export async function encodeWithin(
  encode: (quality: number) => Promise<Blob | null>,
  maxBytes: number,
): Promise<Blob | null> {
  for (const quality of JPEG_QUALITIES) {
    const blob = await encode(quality);
    if (blob && blob.size <= maxBytes) return blob;
  }
  return null;
}
