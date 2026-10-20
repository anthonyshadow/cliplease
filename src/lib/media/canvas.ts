// Canvas helpers shared by the frame capture and the image picker. Browser only: import them from client components.
import { encodeWithin, fitLongEdge } from "./frame";

/** `canvas.toBlob` as a promise; null when the browser gives no blob (MDN: the callback may receive null). */
export function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    } catch {
      // A tainted canvas throws SecurityError; a picked file's blob: URL never taints, but nothing must escape here.
      resolve(null);
    }
  });
}

/** Draws `source` scaled to a long edge ≤ 1080 px and returns the canvas, or null without a 2D context. */
export function drawScaled(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  const size = fitLongEdge(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

/** The canvas as a JPEG of at most `maxBytes` (0.82, then 0.7), or null. */
export function jpegWithin(
  canvas: HTMLCanvasElement,
  maxBytes: number,
): Promise<Blob | null> {
  return encodeWithin((quality) => canvasToJpeg(canvas, quality), maxBytes);
}
