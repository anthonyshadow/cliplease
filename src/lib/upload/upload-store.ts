// Uploads that outlive the File step (owner answer Q-42): one store per browser tab, so moving to another page of the app
// keeps the original and its cover uploading, the floating card follows them, and Open comes back to where it was. Parts
// retry, the upload pauses offline and goes on by itself, and Cancel ends it on the server (07 D80, P10c). A reload or a
// closed tab stops it (beforeunload warns while one runs); choosing the same file then resumes it. Browser only: the
// File step and the card are its only callers. Snapshots are immutable for useSyncExternalStore.
import { useSyncExternalStore } from "react";
import type { PosterOrigin } from "../domain/values";
import { encodeImageToJpeg } from "../media/encode-image";
import { readVideoMetadata } from "../media/read-video-metadata";
import type { UploadErrorCode } from "./codes";
import type { UploadResult } from "./http";
import type { OriginalMime } from "./limits";
import { clearResumeHint } from "./resume";
import { within } from "./retry";
import { announceUploads, onOtherTabUploads } from "./tab-presence";
import { uploadFile } from "./upload-file";
import {
  abortOriginalUpload,
  browserHints,
  browserNetwork,
  type OriginalMeta,
  uploadOriginal,
} from "./upload-original";
import { holdScreenWakeLock } from "./wake-lock";

export type OriginalEntry = {
  videoId: string;
  title: string;
  fileName: string;
  size: number;
  /**
   * retrying: a part waits to try again. paused: offline (it goes on by itself) or a part ran out of retries (Resume, or
   * by itself once the browser is back online). checking: every part is in and complete runs (no Cancel from here).
   * canceled: back to rest.
   */
  phase:
    | "uploading"
    | "retrying"
    | "paused"
    | "checking"
    | "done"
    | "error"
    | "canceled";
  pausedBy: "offline" | "retries" | null;
  /** The open upload, once start answered (the File step's resume and the card use only this). */
  uploadId: string | null;
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
  /** The last file started, for Try again and Resume. */
  last: { title: string; file: File; contentType: OriginalMime } | null;
  /** A file's hints, once read: a restart of that file that takes no frame uses them instead of reading it again. */
  read: { file: File; hints: Promise<OriginalMeta | null> } | null;
  original: AbortController | null;
  /**
   * The running uploadOriginal call, settling with the upload it opened or resumes, which a Cancel's abort names
   * (undefined when the Cancel came before its start went out: nothing was opened).
   */
  running: Promise<string | null | undefined> | null;
  /**
   * A Cancel still settling: the next start goes after the cancelled start's answer and after an unnamed abort, either
   * of which could otherwise end the upload it opens (STOP_WAIT_MS at most for each).
   */
  cancelled: Promise<unknown> | null;
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
      read: null,
      original: null,
      running: null,
      cancelled: null,
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
  announceUploads(
    Object.values(snapshot.originals)
      .filter((e) => isLive(e.phase))
      .map((e) => e.videoId),
  );
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

let wakeLock: { release: () => void } | null = null;

/** The original's parts (their retry waits included) or complete are in flight. */
export function isRunning(phase: OriginalEntry["phase"]): boolean {
  return phase === "uploading" || phase === "retrying" || phase === "checking";
}

/** Running or paused: what this tab tells the other tabs, and what stays when another tab uploads the same video. */
export function isLive(phase: OriginalEntry["phase"]): boolean {
  return isRunning(phase) || phase === "paused";
}

/**
 * beforeunload and the Screen Wake Lock are on only while an original's parts or complete are in flight (04 §9.26,
 * 07 D80): off when it pauses, ends or is cancelled.
 */
function syncLeaveGuard() {
  const running = Object.values(snapshot.originals).some((e) =>
    isRunning(e.phase),
  );
  if (running === (wakeLock !== null) || typeof window === "undefined") return;
  if (running) {
    window.addEventListener("beforeunload", warnBeforeUnload);
    wakeLock = holdScreenWakeLock({ nav: navigator, doc: document });
  } else {
    window.removeEventListener("beforeunload", warnBeforeUnload);
    wakeLock?.release();
    wakeLock = null;
  }
}

// --- Back online, and the other tabs ------------------------------------------------------------------------------------

let watching = false;

/**
 * From the first start: an upload that ran out of retries goes on by itself once the browser is back online (04 §9.26
 * Paused), and an upload that ended here goes once another tab uploads the same video, so the server's newer state
 * shows instead (Q-49).
 */
function watchBrowser() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  browserNetwork.onChange((online) => {
    if (!online) return;
    for (const entry of Object.values(snapshot.originals)) {
      if (entry.phase === "paused" && entry.pausedBy === "retries") {
        resumeOriginalUpload(entry.videoId);
      }
    }
  });
  onOtherTabUploads((videoIds) => {
    for (const videoId of videoIds) {
      const entry = snapshot.originals[videoId];
      if (entry && !isLive(entry.phase)) setOriginal(videoId, null);
    }
  });
}

// --- Progress, at most ten updates a second -----------------------------------------------------------------------------

const PROGRESS_EVERY_MS = 100;

/**
 * One start's onProgress: its entry's `sent` while that start still owns the entry. The run's first report replaces it
 * (a resume starts from the server's stored bytes); after that the bar never goes back while parts retry. `latest()` is
 * the run's newest report (the entry's bytes before the first), which a pause shows at once: the server's stored bytes
 * once the parts in flight stopped.
 */
function throttledProgress(videoId: string, owns: () => boolean) {
  let pending: number | null = null;
  let first = true;
  let waiting = false;
  const apply = () => {
    waiting = false;
    const entry = snapshot.originals[videoId];
    if (
      pending === null ||
      (entry?.phase !== "uploading" && entry?.phase !== "retrying") ||
      !owns()
    ) {
      return;
    }
    patchOriginal(videoId, {
      sent: first ? pending : Math.max(entry.sent, pending),
    });
    first = false;
  };
  return {
    report: (sent: number) => {
      pending = sent;
      if (waiting) return;
      waiting = true;
      setTimeout(apply, PROGRESS_EVERY_MS);
    },
    latest: () => pending ?? snapshot.originals[videoId]?.sent ?? 0,
  };
}

// --- The original -------------------------------------------------------------------------------------------------------

// How long a Cancel's abort, and a start right after it, wait for the cancelled call to stop (a start still answering).
const STOP_WAIT_MS = 15_000;

/**
 * Reads the file's hints and, when `poster`, a frame. Complete waits for `hints` only, never for the frame: the read
 * tells them as soon as it has them, and its result stands in if it ends without telling.
 */
function readFile(file: File, poster: boolean) {
  let tellHints: (hints: OriginalMeta | null) => void = () => {};
  const hints = new Promise<OriginalMeta | null>((resolve) => {
    tellHints = resolve;
  });
  const read = readVideoMetadata(file, 15_000, {
    poster,
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
  return { hints, read };
}

/**
 * Starts (or restarts, or resumes) the original's upload and, when `captureCover`, reads a frame for the cover alongside
 * it (07 D19; owner answer Q-41: the File step passes false when the creator chose the current cover). Any upload already
 * running for the video is stopped first. A resume sends only the parts the server lacks of the upload this device
 * started (its hint), from the `sent` bytes.
 */
export function startOriginalUpload(i: {
  videoId: string;
  title: string;
  file: File;
  contentType: OriginalMime;
  captureCover: boolean;
  resume?: { uploadId: string | null; sent: number };
}) {
  watchBrowser();
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
    pausedBy: null,
    uploadId: i.resume?.uploadId ?? null,
    sent: Math.min(i.resume?.sent ?? 0, i.file.size),
    error: null,
    hints: null,
    seen: false,
  });

  // A restart of a file already read takes its hints. A frame needs the file read again, and so does a read that failed
  // (it may work this time).
  const known =
    !i.captureCover && runtime.read?.file === i.file
      ? runtime.read.hints
      : null;
  const { hints, read } = known
    ? { hints: known, read: null }
    : readFile(i.file, i.captureCover);
  void hints.then((meta) => {
    if (meta && meta.width !== null) runtime.read = { file: i.file, hints };
  });

  if (i.captureCover && read) {
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

  const owns = () => runtime.original === controller;
  const progress = throttledProgress(i.videoId, owns);
  // Runtime.running: the upload a Cancel's abort names; undefined until a fresh run's start goes out.
  let opened: string | null | undefined = i.resume?.uploadId;
  const cancelled = runtime.cancelled;
  const go = async (): Promise<UploadResult> => {
    if (cancelled) {
      await cancelled;
      if (!owns()) return { ok: false, code: "canceled" };
    }
    // The start goes out now.
    opened ??= null;
    return uploadOriginal({
      videoId: i.videoId,
      file: i.file,
      contentType: i.contentType,
      meta: hints,
      resume: i.resume ? true : undefined,
      expectedUploadId: i.resume?.uploadId ?? undefined,
      signal: controller.signal,
      onProgress: progress.report,
      onStarted: (uploadId) => {
        opened = uploadId;
        if (owns()) patchOriginal(i.videoId, { uploadId });
      },
      onStatus: (status) => {
        if (!owns()) return;
        if (status === "checking") {
          patchOriginal(i.videoId, { phase: "checking", sent: i.file.size });
        } else if (status === "paused") {
          patchOriginal(i.videoId, {
            phase: "paused",
            pausedBy: "offline",
            sent: progress.latest(),
          });
        } else {
          // Going again after a pause shows on the card again, even after its ×.
          const was = snapshot.originals[i.videoId]?.phase;
          patchOriginal(i.videoId, {
            phase: status,
            pausedBy: null,
            ...(was === "paused" ? { seen: false } : {}),
          });
        }
      },
    });
  };
  const running = go().catch(
    (): UploadResult => ({ ok: false, code: "internal" }),
  );
  runtime.running = running.then(() => opened);

  void running.then(async (result) => {
    // A newer start or a Cancel owns the entry now.
    if (!owns()) return;
    runtime.original = null;
    runtime.running = null;
    if (result.ok) {
      patchOriginal(i.videoId, { phase: "done", hints: await hints });
    } else if (result.code === "paused") {
      patchOriginal(i.videoId, {
        phase: "paused",
        pausedBy: "retries",
        sent: progress.latest(),
      });
    } else if (result.code === "canceled") {
      patchOriginal(i.videoId, { phase: "canceled", seen: true });
    } else {
      patchOriginal(i.videoId, { phase: "error", error: result.code });
    }
  });
}

/** Resume (the same-tab Paused box, or back online): the file this tab still holds, from where the server is. */
export function resumeOriginalUpload(videoId: string): boolean {
  const { last } = runtimeOf(videoId);
  const entry = snapshot.originals[videoId];
  if (!last || entry?.phase !== "paused") return false;
  startOriginalUpload({
    videoId,
    ...last,
    captureCover: false,
    resume: { uploadId: entry.uploadId, sent: entry.sent },
  });
  return true;
}

/**
 * Cancel (04 §9.26) while uploading, retrying or paused, or on `uploadId` a reload left paused: the dropzone goes back
 * to rest at once and the hint goes; the parts stop, and once any start in flight has answered, the server ends that
 * upload (`original_status 'none'`). Resolves with whether the server confirmed it (the UI has reset either way).
 */
export function cancelOriginalUpload(
  videoId: string,
  uploadId: string | null = null,
): Promise<boolean> {
  const runtime = runtimeOf(videoId);
  const entry = snapshot.originals[videoId];
  if (entry && (entry.phase === "checking" || entry.phase === "done")) {
    return Promise.resolve(false);
  }
  const running = runtime.running;
  runtime.original?.abort();
  runtime.original = null;
  runtime.running = null;
  clearResumeHint(browserHints(), videoId);
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
  if (entry) patchOriginal(videoId, { phase: "canceled", seen: true });
  // Once, now, and named (owner answer Q-50): it ends this upload only, never a newer one. Nothing when the start never
  // went out; unnamed only when this tab's start never answered; the page's paused upload only when this tab has none of
  // its own. An abort that didn't reach the server leaves the upload to the next start or its 24 hours.
  const named = (
    running ? within(running, STOP_WAIT_MS) : Promise.resolve(null)
  ).then((opened) =>
    opened === undefined
      ? undefined
      : (opened ?? (entry ? entry.uploadId : uploadId)),
  );
  const aborted = named.then((id) =>
    id === undefined ? true : abortOriginalUpload(videoId, id),
  );
  const settled = named.then((id) =>
    id === null ? within(aborted, STOP_WAIT_MS) : undefined,
  );
  runtime.cancelled = settled;
  void settled.then(() => {
    if (runtime.cancelled === settled) runtime.cancelled = null;
  });
  return aborted;
}

// The failures after which the server may still hold the upload's parts: Try again resumes it.
const RESUMES_ON_RETRY: readonly (UploadErrorCode | null)[] = [
  "network",
  "internal",
  "unauthorized",
];

/**
 * Try again with the file already chosen, if the tab still holds it: a resume of the open upload when the failure left
 * it on the server (a gone upload then answers upload_expired), else from zero. A cover already stored came from that
 * file.
 */
export function retryOriginalUpload(
  videoId: string,
  captureCover: boolean,
): boolean {
  const { last } = runtimeOf(videoId);
  if (!last) return false;
  const entry = snapshot.originals[videoId];
  const resumes =
    entry?.phase === "error" &&
    entry.uploadId !== null &&
    RESUMES_ON_RETRY.includes(entry.error);
  startOriginalUpload({
    videoId,
    ...last,
    captureCover: captureCover && snapshot.covers[videoId]?.phase !== "done",
    resume: resumes
      ? { uploadId: entry.uploadId, sent: entry.sent }
      : undefined,
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
