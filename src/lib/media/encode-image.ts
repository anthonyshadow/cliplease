// A picked cover image as the JPEG the poster upload takes (research/infra.md §3 "Graceful fallback"; 05 callout 19).
// Browser only: import it from client components. HEIC stills are refused: Chrome can't decode them.
import { POSTER_MAX_BYTES } from "../upload/limits";
import { drawScaled, jpegWithin } from "./canvas";

/** What the cover picker accepts (its `accept` attribute and the check). */
export const COVER_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type EncodedImage =
  | { ok: true; blob: Blob }
  | { ok: false; code: "bad_type" | "too_large" };

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * JPEG, PNG or WebP through a canvas to a JPEG with a long edge ≤ 1080 px: quality 0.82, once more at 0.7 when that
 * is over 2 MB, then "too_large". A file the browser can't decode counts as the wrong type.
 */
export async function encodeImageToJpeg(file: File): Promise<EncodedImage> {
  if (!COVER_IMAGE_TYPES.includes(file.type)) {
    return { ok: false, code: "bad_type" };
  }
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await decode(file);
  } catch {
    return { ok: false, code: "bad_type" };
  }
  try {
    const canvas = drawScaled(source, source.width, source.height);
    if (!canvas) return { ok: false, code: "bad_type" };
    const blob = await jpegWithin(canvas, POSTER_MAX_BYTES);
    return blob ? { ok: true, blob } : { ok: false, code: "too_large" };
  } finally {
    if ("close" in source) source.close();
  }
}
