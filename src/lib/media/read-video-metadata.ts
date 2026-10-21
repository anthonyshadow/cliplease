// Display hints and a cover frame from the creator's own file (research/infra.md §3), read while the upload runs and never
// blocking it. Browser only: import it from client components. The hints are never trusted for pricing or security.
import { POSTER_MAX_BYTES } from "../upload/limits";
import { within } from "../upload/retry";
import { drawScaled, jpegWithin } from "./canvas";
import { isBlankFrame, samplePoints, seekTime } from "./frame";

export type VideoMeta = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  poster: Blob | null;
  posterError?:
    | "unsupported_codec"
    | "timeout"
    | "decode_error"
    | "blank_frame";
};

type Wait = "ok" | "error" | "timeout";

/** Resolves on `event` (ok), the element's `error`, or after `ms` (what is left of the shared deadline). */
function waitFor(video: HTMLVideoElement, event: string, ms: number) {
  return new Promise<Wait>((resolve) => {
    const done = (result: Wait) => {
      clearTimeout(timer);
      video.removeEventListener(event, onEvent);
      video.removeEventListener("error", onError);
      resolve(result);
    };
    const onEvent = () => done("ok");
    const onError = () => done("error");
    const timer = setTimeout(() => done("timeout"), ms);
    video.addEventListener(event, onEvent);
    video.addEventListener("error", onError);
  });
}

const failed = (w: Wait): VideoMeta["posterError"] =>
  w === "timeout" ? "timeout" : "decode_error";

/** The `samplePoints` of `canvas` copied 1:1 into a 4 × 4 canvas and read back at once (RGBA quads), or null. */
function samplePixels(canvas: HTMLCanvasElement): Uint8ClampedArray | null {
  const grid = document.createElement("canvas");
  grid.width = 4;
  grid.height = 4;
  const context = grid.getContext("2d");
  if (!context) return null;
  const points = samplePoints(canvas.width, canvas.height);
  for (const [i, { x, y }] of points.entries()) {
    context.drawImage(canvas, x, y, 1, 1, i % 4, Math.floor(i / 4), 1, 1);
  }
  return context.getImageData(0, 0, 4, 4).data;
}

/**
 * Reads the duration and the display size from a hidden, muted <video> on a blob: URL (the file is never loaded whole),
 * then draws the frame at min(1 s, 10 %) to a canvas, long edge ≤ 1080 px, as a JPEG at 0.82 (0.7 when that is over
 * 2 MB). Everything within `timeoutMs`; a failure returns what was read with `poster: null` and why. `onHints` gets the
 * duration and size once, as soon as they are known (nulls when the metadata can't be read); with `poster: false` the
 * read ends there.
 */
export async function readVideoMetadata(
  file: File,
  timeoutMs = 15_000,
  {
    poster = true,
    onHints,
  }: {
    poster?: boolean;
    onHints?: (
      hints: Pick<VideoMeta, "durationMs" | "width" | "height">,
    ) => void;
  } = {},
): Promise<VideoMeta> {
  const deadline = Date.now() + timeoutMs;
  const left = () => Math.max(0, deadline - Date.now());
  const meta: VideoMeta = {
    durationMs: null,
    width: null,
    height: null,
    poster: null,
  };
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  try {
    const loading = waitFor(video, "loadedmetadata", left());
    video.src = url;
    const loaded = await loading;
    if (loaded === "ok") {
      meta.durationMs = Number.isFinite(video.duration)
        ? Math.round(video.duration * 1000)
        : null;
      // No decodable video track (HEVC without a decoder) leaves the size unknown: the duration is all there is.
      if (video.videoWidth > 0) {
        meta.width = video.videoWidth;
        meta.height = video.videoHeight;
      }
    }
    onHints?.({
      durationMs: meta.durationMs,
      width: meta.width,
      height: meta.height,
    });
    if (loaded !== "ok") return { ...meta, posterError: failed(loaded) };
    if (!poster) return meta;
    if (meta.width === null) {
      return { ...meta, posterError: "unsupported_codec" };
    }

    video.preload = "auto";
    const target = seekTime(video.duration);
    if (video.currentTime !== target) {
      const seeking = waitFor(video, "seeked", left());
      video.currentTime = target;
      const seeked = await seeking;
      if (seeked !== "ok") return { ...meta, posterError: failed(seeked) };
    }
    // iOS Safari may not paint the frame until playback starts once; play() can hang on a frame it can't paint.
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        await within(video.play(), left(), undefined);
        video.pause();
      } catch {
        // Playback refused: draw what is there.
      }
    }

    const canvas = drawScaled(video, video.videoWidth, video.videoHeight);
    const pixels = canvas && samplePixels(canvas);
    if (!canvas || !pixels) return { ...meta, posterError: "decode_error" };
    if (isBlankFrame(pixels)) return { ...meta, posterError: "blank_frame" };
    const jpeg = await within(
      jpegWithin(canvas, POSTER_MAX_BYTES),
      left(),
      undefined,
    );
    if (jpeg === undefined) return { ...meta, posterError: "timeout" };
    return jpeg
      ? { ...meta, poster: jpeg }
      : { ...meta, posterError: "decode_error" };
  } catch {
    return { ...meta, posterError: "decode_error" };
  } finally {
    // Detach first: WebKit logs a failed load when the URL goes while the element still reads from it.
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
