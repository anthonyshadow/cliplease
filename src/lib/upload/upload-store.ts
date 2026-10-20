// Uploads that outlive the File step (owner answer Q-42): one store per browser tab, so moving to another page of the app
// keeps the original and its cover uploading, the floating card follows them, and Open comes back to where it was.
// Browser only: the File step and the card are its only callers. A reload or a closed tab still ends the upload
// (beforeunload warns while one runs); P10c adds resume. Snapshots are immutable for useSyncExternalStore.
import { useSyncExternalStore } from "react";
import type { PosterOrigin } from "../domain/values";
import { encodeImageToJpeg } from "../media/encode-image";
import { readVideoMetadata } from "../media/read-video-metadata";
import type { UploadErrorCode } from "./codes";
import type { UploadResult } from "./http";
import type { OriginalMime } from "./limits";
import { uploadFile } from "./upload-file";
import { type OriginalMeta, uploadOriginal } from "./upload-original";

export type OriginalEntry = {
  videoId: string;
  title: string;
  fileName: string;
  size: number;
  /** checking: every part is in, complete is next or running (no Cancel from here). canceled: back to rest. */
  phase: "uploading" | "checking" | "done" | "error" | "canceled";
  sent: number;
  error: UploadErrorCode | null;
  /** What the browser read from the file, once known. */
  hints: OriginalMeta | null;
  /** The File step showed how it ended, so the floating card doesn't. */
  seen: boolean;
};

export type CoverEntry = {
  phase: "capturing" | "uploading" | "done" | "error";
  /** A blob: URL of the cover being stored or just stored; null while capturing. */
  preview: string | null;
  origin: PosterOrigin;
  error: "cant_preview" | "bad_type" | "too_large" | "upload_failed" | null;
};

export type UploadsSnapshot = {
  originals: Readonly<Record<string, OriginalEntry>>;
  covers: Readonly<Record<string, CoverEntry>>;
};

type Runtime = {
  /** The last file started, for Try again. */
  last: { title: string; file: File; contentType: OriginalMime } | null;
  original: AbortController | null;
  /** The cover's owner: the frame being read or the cover being stored. A newer one aborts it and takes its place. */
  cover: AbortController | null;
  /** Covers go one after another, so the last one chosen is the one stored (P10a keeps the last complete). */
  coverChain: Promise<void>;
  lastCover: { blob: Blob; origin: PosterOrigin } | null;
};

const EMPTY: UploadsSnapshot = { originals: {}, covers: {} };
let snapshot = EMPTY;
const listeners = new Set<() => void>();
const runtimes = new Map<string, Runtime>();

function runtimeOf(videoId: string): Runtime {
  let runtime = runtimes.get(videoId);
  if (!runtime) {
    runtime = {
      last: null,
      original: null,
      cover: null,
      coverChain: Promise.resolve(),
      lastCover: null,
    };
    runtimes.set(videoId, runtime);
  }
  return runtime;
}

function emit(next: UploadsSnapshot) {
  snapshot = next;
  syncLeaveGuard();
  for (const listener of listeners) listener();
}

function setOriginal(videoId: string, entry: OriginalEntry | null) {
  const { [videoId]: _, ...rest } = snapshot.originals;
  emit({
    ...snapshot,
    originals: entry ? { ...rest, [videoId]: entry } : rest,
  });
}

function patchOriginal(videoId: string, patch: Partial<OriginalEntry>) {
  const entry = snapshot.originals[videoId];
  if (entry) setOriginal(videoId, { ...entry, ...patch });
}

function setCover(videoId: string, entry: CoverEntry | null) {
  const previous = snapshot.covers[videoId]?.preview;
  if (previous && previous !== entry?.preview) URL.revokeObjectURL(previous);
  const { [videoId]: _, ...rest } = snapshot.covers;
  emit({ ...snapshot, covers: entry ? { ...rest, [videoId]: entry } : rest });
}

// --- Leaving the tab ----------------------------------------------------------------------------------------------------

function warnBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  // Older browsers show the dialog only when returnValue is set.
  event.returnValue = "";
}

let guarding = false;

/** The original's parts or complete are in flight. */
export function isRunning(phase: OriginalEntry["phase"]): boolean {
  return phase === "uploading" || phase === "checking";
}

/** beforeunload is on only while an original's parts or complete are in flight (04 §9.26). */
function syncLeaveGuard() {
  const running = Object.values(snapshot.originals).some((e) =>
    isRunning(e.phase),
  );
  if (running === guarding || typeof window === "undefined") return;
  guarding = running;
  if (running) window.addEventListener("beforeunload", warnBeforeUnload);
  else window.removeEventListener("beforeunload", warnBeforeUnload);
}

// --- Progress, at most ten updates a second -----------------------------------------------------------------------------

const PROGRESS_EVERY_MS = 100;

/** One start's onProgress: its entry's `sent`, never going back, while that start still owns the entry. */
function throttledProgress(videoId: string, controller: AbortController) {
  let pending = 0;
  let waiting = false;
  return (sent: number) => {
    pending = sent;
    if (waiting) return;
    waiting = true;
    setTimeout(() => {
      waiting = false;
      const entry = snapshot.originals[videoId];
      if (
        entry?.phase === "uploading" &&
        runtimeOf(videoId).original === controller
      ) {
        patchOriginal(videoId, { sent: Math.max(entry.sent, pending) });
      }
    }, PROGRESS_EVERY_MS);
  };
}

// --- The original -------------------------------------------------------------------------------------------------------

/**
 * Starts (or restarts) the original's upload and, when `captureCover`, reads a frame for the cover alongside it (07 D19;
 * owner answer Q-41: the File step passes false when the creator chose the current cover). Any upload already running
 * for the video is cancelled first.
 */
export function startOriginalUpload(i: {
  videoId: string;
  title: string;
  file: File;
  contentType: OriginalMime;
  captureCover: boolean;
}) {
  const runtime = runtimeOf(i.videoId);
  runtime.original?.abort();
  const controller = new AbortController();
  runtime.original = controller;
  runtime.last = { title: i.title, file: i.file, contentType: i.contentType };
  setOriginal(i.videoId, {
    videoId: i.videoId,
    title: i.title,
    fileName: i.file.name,
    size: i.file.size,
    phase: "uploading",
    sent: 0,
    error: null,
    hints: null,
    seen: false,
  });

  // Complete waits for the hints only, never for the frame: the read tells them as soon as it has them, and its result
  // stands in if it ends without telling.
  let tellHints: (hints: OriginalMeta | null) => void = () => {};
  const hints = new Promise<OriginalMeta | null>((resolve) => {
    tellHints = resolve;
  });
  const read = readVideoMetadata(i.file, 15_000, {
    poster: i.captureCover,
    onHints: tellHints,
  }).catch(() => null);
  void read.then((meta) =>
    tellHints(
      meta && {
        durationMs: meta.durationMs,
        width: meta.width,
        height: meta.height,
      },
    ),
  );

  if (i.captureCover) {
    // The capture owns the cover from now (a frame of an older file still on its way is aborted) until a pick, a Cancel
    // or a newer start takes it.
    runtime.cover?.abort();
    const capture = new AbortController();
    runtime.cover = capture;
    setCover(i.videoId, {
      phase: "capturing",
      preview: null,
      origin: "frame_capture",
      error: null,
    });
    void read.then((meta) => {
      if (runtime.cover !== capture) return;
      if (meta?.poster) {
        uploadCover(i.videoId, meta.poster, "frame_capture");
      } else {
        runtime.cover = null;
        setCover(i.videoId, {
          phase: "error",
          preview: null,
          origin: "frame_capture",
          error: "cant_preview",
        });
      }
    });
  }

  void uploadOriginal({
    videoId: i.videoId,
    file: i.file,
    contentType: i.contentType,
    meta: hints,
    signal: controller.signal,
    onProgress: throttledProgress(i.videoId, controller),
    onPartsDone: () => {
      if (runtime.original === controller) {
        patchOriginal(i.videoId, { phase: "checking", sent: i.file.size });
      }
    },
  })
    .catch((): UploadResult => ({ ok: false, code: "internal" }))
    .then(async (result) => {
      // A newer start or a Cancel owns the entry now.
      if (runtime.original !== controller) return;
      runtime.original = null;
      if (result.ok) {
        patchOriginal(i.videoId, { phase: "done", hints: await hints });
      } else if (result.code === "canceled") {
        patchOriginal(i.videoId, { phase: "canceled", seen: true });
      } else {
        patchOriginal(i.videoId, { phase: "error", error: result.code });
      }
    });
}

/**
 * Cancel (04 §9.26): stops the part PUTs and returns the dropzone to rest; the row stays 'uploading' until the next start
 * (P10c adds the abort call), so a reload shows "Upload didn't finish".
 */
export function cancelOriginalUpload(videoId: string) {
  const runtime = runtimeOf(videoId);
  if (snapshot.originals[videoId]?.phase !== "uploading") return;
  runtime.original?.abort();
  runtime.original = null;
  // A frame from the cancelled file goes with it (still being read, or on its way); a chosen image stays.
  const cover = snapshot.covers[videoId];
  if (
    cover?.phase === "capturing" ||
    (cover?.phase === "uploading" && cover.origin === "frame_capture")
  ) {
    runtime.cover?.abort();
    runtime.cover = null;
    setCover(videoId, null);
  }
  patchOriginal(videoId, { phase: "canceled", seen: true });
}

/** Try again with the file already chosen, if the tab still holds it. A cover already stored came from that file. */
export function retryOriginalUpload(
  videoId: string,
  captureCover: boolean,
): boolean {
  const { last } = runtimeOf(videoId);
  if (!last) return false;
  startOriginalUpload({
    videoId,
    ...last,
    captureCover: captureCover && snapshot.covers[videoId]?.phase !== "done",
  });
  return true;
}

/** The card's ×, or the File step showing how the upload ended: the card stops showing it. */
export function markOriginalSeen(videoId: string) {
  const entry = snapshot.originals[videoId];
  if (entry && !entry.seen && !isRunning(entry.phase)) {
    patchOriginal(videoId, { seen: true });
  }
}

// --- The cover ----------------------------------------------------------------------------------------------------------

function uploadCover(videoId: string, blob: Blob, origin: PosterOrigin) {
  const runtime = runtimeOf(videoId);
  runtime.cover?.abort();
  const controller = new AbortController();
  runtime.cover = controller;
  runtime.lastCover = { blob, origin };
  setCover(videoId, {
    phase: "uploading",
    preview: URL.createObjectURL(blob),
    origin,
    error: null,
  });
  runtime.coverChain = runtime.coverChain.then(async () => {
    if (controller.signal.aborted) return;
    const result = await uploadFile({
      videoId,
      kind: "poster",
      body: blob,
      posterOrigin: origin,
      signal: controller.signal,
    }).catch((): UploadResult => ({ ok: false, code: "internal" }));
    const entry = snapshot.covers[videoId];
    if (runtime.cover !== controller || !entry) return;
    runtime.cover = null;
    if (result.ok) {
      setCover(videoId, { ...entry, phase: "done" });
    } else if (result.code !== "canceled") {
      setCover(videoId, { ...entry, phase: "error", error: "upload_failed" });
    }
  });
}

/**
 * "Choose an image" / "Use a different image": the creator's own cover replaces any frame still being read. An image
 * that can't be used only adds its error line: the cover already stored or on its way stays as it is.
 */
export async function pickCover(videoId: string, file: File) {
  const encoded = await encodeImageToJpeg(file);
  if (!encoded.ok) {
    const current = snapshot.covers[videoId];
    setCover(
      videoId,
      current
        ? { ...current, error: encoded.code }
        : {
            phase: "error",
            preview: null,
            origin: "creator_image",
            error: encoded.code,
          },
    );
    return;
  }
  uploadCover(videoId, encoded.blob, "creator_image");
}

/** Try again after a failed cover upload. */
export function retryCover(videoId: string) {
  const last = runtimeOf(videoId).lastCover;
  if (last) uploadCover(videoId, last.blob, last.origin);
}

// --- React --------------------------------------------------------------------------------------------------------------

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Every upload this tab knows about; empty on the server. */
export function useUploads(): UploadsSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
}
