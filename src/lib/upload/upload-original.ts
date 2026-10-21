// The browser's multipart upload of an original (02 §5.9 "Browser side", 07 D80): start (or resume) → part URLs in
// batches → PART_CONCURRENCY part PUTs at once, each retried with backoff and one re-sign → complete with no ETags (the
// server lists the parts itself). It pauses while the browser is offline and goes on when it's back. Browser only.
import type { StartUploadResult } from "../../server/storage/uploads";
import type { UploadErrorCode } from "./codes";
import {
  type ApiResult,
  postUploadRoute,
  putWithProgress,
  type UploadResult,
} from "./http";
import { type OriginalMime, PART_CONCURRENCY, PART_URL_BATCH } from "./limits";
import { type PlannedPart, planParts } from "./plan";
import {
  clearResumeHint,
  type HintStore,
  keepsResumeHint,
  planResume,
  type ResumeHint,
  writeResumeHint,
} from "./resume";
import {
  abortError,
  isAbort,
  type PartOutcome,
  type SendFailure,
  sendPartWithRetry,
  withRetries,
} from "./retry";

/** The display hints complete takes (P10a's strict schema: nothing else). */
export type OriginalMeta = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

type UploadStatus = "uploading" | "retrying" | "paused" | "checking";

/** The browser's connection, injectable for tests. */
export type NetworkWatch = {
  isOnline: () => boolean;
  /** Calls `listener` on every change; returns the unsubscribe. */
  onChange: (listener: (online: boolean) => void) => () => void;
};

export type UploadOriginalInput = {
  videoId: string;
  file: File;
  contentType: OriginalMime;
  /** Awaited before complete, never before the parts; the caller bounds it (readVideoMetadata's 15 s). */
  meta: Promise<OriginalMeta | null>;
  /** Resume the video's open upload: start with `resume: true` and send only the parts it lacks (07 D80). */
  resume?: boolean;
  /** When resuming, the upload this device started: if start hands back another, nothing is sent (`stale_upload`). */
  expectedUploadId?: string;
  /**
   * With `resume` and `expectedUploadId`: every part went before, and complete's answer was lost. Complete is asked
   * again first (07 D80: idempotent); only when it finds a part missing does the resume go on.
   */
  completeFirst?: boolean;
  /** Bytes stored so far: the server's stored parts, plus finished and in-flight parts. Never past the size. */
  onProgress?: (sent: number, total: number) => void;
  onStatus?: (status: UploadStatus) => void;
  /** Start answered with this upload id: told even when a Cancel came meanwhile, so its abort can name the upload. */
  onStarted?: (uploadId: string) => void;
  /** Aborts the parts and every wait (Cancel, or a newer start). Start and complete run to their answers. */
  signal?: AbortSignal;
  /** Where the resume hint lives (localStorage by default; null for none). */
  hints?: HintStore;
  network?: NetworkWatch;
  random?: () => number;
};

// The browser picks no key, ETag or part size: they come from start.
type Multipart = Extract<StartUploadResult, { mode: "multipart" }>;
type Failed = Extract<UploadResult, { ok: false }>;
const fail = (code: UploadErrorCode): Failed => ({ ok: false, code });

/** The tab's localStorage, or null where it can't be reached (a private window, blocked site data). */
export function browserHints(): HintStore {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** `navigator.onLine` and the window's online/offline events. */
export const browserNetwork: NetworkWatch = {
  isOnline: () =>
    typeof navigator === "undefined" || navigator.onLine !== false,
  onChange: (listener) => {
    const online = () => listener(true);
    const offline = () => listener(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  },
};

/** Resolves when the browser is online; rejects with an AbortError on `signal`. */
function onlineAgain(network: NetworkWatch, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    if (network.isOnline()) {
      resolve();
      return;
    }
    const done = () => {
      unsubscribe();
      signal.removeEventListener("abort", aborted);
    };
    const aborted = () => {
      done();
      reject(abortError());
    };
    const unsubscribe = network.onChange((online) => {
      if (!online) return;
      done();
      resolve();
    });
    signal.addEventListener("abort", aborted, { once: true });
  });
}

/** The retry loops' view of the connection (retry.ts), their waits ended by `signal`. */
const retryWatch = (i: RunInput, signal: AbortSignal) => ({
  signal,
  random: i.random,
  isOnline: i.network.isOnline,
  waitForOnline: (s: AbortSignal) => onlineAgain(i.network, s),
});

/**
 * Cancel (04 §9.26): ends `uploadId` on the server (`original_status 'none'`); the caller has already forgotten its hint.
 * Named (owner answer Q-50), so an abort that lands after a newer start can't end that one; with no id known (a start
 * that never answered), whatever upload the video has open. keepalive, so it still goes out while the page closes.
 * Never throws; false when the server didn't confirm it.
 */
export async function abortOriginalUpload(
  videoId: string,
  uploadId: string | null,
): Promise<boolean> {
  try {
    const response = await fetch("/api/uploads/abort", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoId, uploadId: uploadId ?? undefined }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Uploads (or resumes) the original. The resume hint (07 D80) is written once start answers, unless a Cancel came first,
 * and removed when the upload is done or ends with nothing left to resume (keepsResumeHint).
 */
export async function uploadOriginal(
  i: UploadOriginalInput,
): Promise<UploadResult> {
  const hints = i.hints === undefined ? browserHints() : i.hints;
  const network = i.network ?? browserNetwork;
  // Only this run's own hint goes: a newer upload's may be there by now, and a run that never heard back from start
  // wrote none.
  let own = i.expectedUploadId;
  const result = await run(
    {
      ...i,
      hints,
      network,
      onStarted: (uploadId) => {
        own = uploadId;
        i.onStarted?.(uploadId);
      },
    },
    false,
  );
  if (own !== undefined && (result.ok || !keepsResumeHint(result.code))) {
    clearResumeHint(hints, i.videoId, own);
  }
  return result;
}

type RunInput = UploadOriginalInput & {
  hints: HintStore;
  network: NetworkWatch;
};

async function run(i: RunInput, repairing: boolean): Promise<UploadResult> {
  const { videoId, file } = i;
  const signal = i.signal ?? new AbortController().signal;
  if (i.completeFirst && i.expectedUploadId) {
    const completed = await complete(i, i.expectedUploadId);
    if (completed.ok || completed.code !== "parts_incomplete") return completed;
    // A part changed or went missing: the one resume pass sends what's missing.
    return run({ ...i, completeFirst: false }, true);
  }
  // Start is never aborted: a Cancel waits for its answer, so the upload it opened is the one the abort then ends. A
  // resume's start is safe to repeat: a dropped connection is tried again, and still no answer pauses the upload (it
  // goes on by itself once back online). A fresh one isn't: landing after a Cancel's abort, it would open an upload
  // nobody ends.
  const start = () =>
    postUploadRoute<StartUploadResult>("start", {
      kind: "original",
      videoId,
      fileName: file.name.slice(0, 255),
      size: file.size,
      contentType: i.contentType,
      ...(i.resume ? { resume: true } : {}),
    });
  const started = i.resume
    ? await resumeStart(i, start, signal)
    : await start();
  if (!started.ok) {
    return i.resume && started.code === "network" ? fail("paused") : started;
  }
  const upload = started.data;
  if (upload.mode !== "multipart") return fail("internal");
  if (
    i.resume &&
    i.expectedUploadId &&
    upload.uploadId !== i.expectedUploadId
  ) {
    return fail("stale_upload");
  }
  i.onStarted?.(upload.uploadId);
  // Cancel during start has already cleared the hint: writing it now would bring it back.
  if (signal.aborted) return fail("canceled");
  const hint: ResumeHint = {
    uploadId: upload.uploadId,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
  };
  writeResumeHint(i.hints, videoId, hint);

  const all = planParts(file.size, upload.partSize);
  if (all.length !== upload.partCount) return fail("internal");
  const { missing, doneBytes } = planResume({
    size: file.size,
    partSize: upload.partSize,
    doneParts: upload.doneParts,
  });
  const todo = all.filter((p) => missing.includes(p.partNumber));
  const failed = await sendParts(i, upload, todo, doneBytes, signal);
  if (failed) return failed;

  const completed = await complete(i, upload.uploadId);
  // A part changed or went missing after the list (owner answer Q-35): one resume pass sends what's missing.
  if (
    !completed.ok &&
    completed.code === "parts_incomplete" &&
    !repairing &&
    !signal.aborted
  ) {
    return run({ ...i, resume: true, expectedUploadId: upload.uploadId }, true);
  }
  return completed;
}

/**
 * A resume's start, tried again after a dropped connection. While it waits for the browser to be back online the upload
 * shows as paused (offline), with Cancel, as a part's wait does; the parts then say uploading.
 */
async function resumeStart(
  i: RunInput,
  start: () => Promise<ApiResult<StartUploadResult>>,
  signal: AbortSignal,
): Promise<ApiResult<StartUploadResult>> {
  const offline = (online: boolean) => {
    if (!online) i.onStatus?.("paused");
  };
  const unsubscribe = i.network.onChange(offline);
  offline(i.network.isOnline());
  try {
    return await withRetries(start, retryWatch(i, signal));
  } finally {
    unsubscribe();
  }
}

/**
 * Every part of `uploadId` is in: complete assembles it, named so that it finishes this upload only (owner decision,
 * like abort's Q-50). Idempotent and never aborted; it says what became of the upload (assembled → ok, past 24 h →
 * upload_expired, another upload in its place → not_found).
 */
async function complete(i: RunInput, uploadId: string): Promise<UploadResult> {
  i.onStatus?.("checking");
  const meta = await i.meta;
  const completed = await withRetries(
    () =>
      postUploadRoute<{ ok: true }>("complete", {
        kind: "original",
        videoId: i.videoId,
        uploadId,
        ...(meta ? { meta } : {}),
      }),
    retryWatch(i, new AbortController().signal),
  );
  return completed.ok ? { ok: true } : completed;
}

/**
 * The parts, PART_CONCURRENCY at a time, each through sendPartWithRetry. No new part starts while the browser is
 * offline; a part that runs out of retries stops the rest and the upload pauses. URLs are signed PART_URL_BATCH at a
 * time; a re-sign asks for one part. Null when every part is in and complete goes next. An upload that isn't open any
 * more (a 404) ends the run as stale_upload with no complete (owner decision): there is nothing of this file to finish.
 */
async function sendParts(
  i: RunInput,
  upload: Multipart,
  parts: PlannedPart[],
  doneBytes: number,
  outer: AbortSignal,
): Promise<Failed | null> {
  // Cancel, or the end of this run (a paused or gone part), aborts every part in flight and every wait.
  const stop = new AbortController();
  const { signal } = stop;
  const watch = retryWatch(i, signal);
  const cancel = () => stop.abort();
  outer.addEventListener("abort", cancel, { once: true });
  if (outer.aborted) cancel();

  const total = i.file.size;
  const inFlight = new Map<number, number>();
  let finished = doneBytes;
  let outcome: Failed | null = null;
  const end = (o: Failed) => {
    outcome ??= o;
    stop.abort();
  };
  const report = () => {
    let sent = finished;
    for (const loaded of inFlight.values()) sent += loaded;
    i.onProgress?.(Math.min(sent, total), total);
  };

  // uploading, retrying (a part waits to try again) or paused (offline), reported when it changes.
  const retrying = new Set<number>();
  let status: UploadStatus | null = null;
  const sync = () => {
    if (outcome !== null) return;
    const next: UploadStatus = !i.network.isOnline()
      ? "paused"
      : retrying.size > 0
        ? "retrying"
        : "uploading";
    if (next !== status) {
      status = next;
      i.onStatus?.(next);
    }
  };
  const unsubscribe = i.network.onChange(sync);
  // This pass's bytes first, so a status change (a repair pass's uploading, a pause) shows them and not the last pass's.
  report();
  sync();

  const postParts = (partNumbers: number[]) =>
    postUploadRoute<{ urls: Record<string, string> }>(
      "parts",
      { videoId: i.videoId, uploadId: upload.uploadId, partNumbers },
      signal,
    );

  // One request per batch of part numbers, shared by the workers that need it.
  const batches = new Map<number, Promise<Record<string, string> | null>>();
  const urlFor = async (index: number): Promise<string | null> => {
    const batch = Math.floor(index / PART_URL_BATCH);
    let urls = batches.get(batch);
    if (!urls) {
      const partNumbers = parts
        .slice(batch * PART_URL_BATCH, (batch + 1) * PART_URL_BATCH)
        .map((p) => p.partNumber);
      urls = withRetries(() => postParts(partNumbers), watch).then((r) => {
        if (r.ok) return r.data.urls;
        if (r.code === "not_found") end(fail("stale_upload"));
        else if (r.code === "network") end(fail("paused"));
        else end(r);
        return null;
      });
      batches.set(batch, urls);
    }
    return (await urls)?.[String(parts[index]?.partNumber)] ?? null;
  };

  const sendOne = (part: PlannedPart, url: string): Promise<PartOutcome> => {
    const size = part.end - part.start;
    return sendPartWithRetry({
      ...watch,
      url,
      onRetrying: () => {
        retrying.add(part.partNumber);
        sync();
      },
      resign: async () => {
        const r = await postParts([part.partNumber]);
        if (r.ok) return r.data.urls[String(part.partNumber)] ?? null;
        // Past its 24 hours: the run ends as expired, as a URL batch's 410 does, and no URL will come.
        if (r.code === "upload_expired") {
          end(r);
          return null;
        }
        // Not open any more: no URL will come.
        if (r.code === "not_found") return null;
        if (r.code === "canceled") throw abortError();
        throw { kind: "network" } satisfies SendFailure;
      },
      send: async (target) => {
        inFlight.set(part.partNumber, 0);
        const put = await putWithProgress(
          target,
          i.file.slice(part.start, part.end),
          {
            signal,
            onProgress: (loaded) => {
              inFlight.set(part.partNumber, Math.min(loaded, size));
              report();
            },
          },
        );
        // A failed try's bytes drop out of the progress.
        inFlight.delete(part.partNumber);
        if (!put.ok) {
          report();
          if (put.code === "canceled") throw abortError();
          throw { kind: "network" } satisfies SendFailure;
        }
        if (put.status < 200 || put.status >= 300) {
          report();
          throw { kind: "http", status: put.status } satisfies SendFailure;
        }
      },
    });
  };

  let next = 0;
  const worker = async () => {
    while (outcome === null && next < parts.length) {
      // No new part starts while offline (07 D80).
      if (!i.network.isOnline()) {
        try {
          await onlineAgain(i.network, signal);
        } catch {
          return;
        }
        continue;
      }
      const index = next++;
      const part = parts[index];
      if (!part) return;
      const url = await urlFor(index);
      if (outcome !== null) return;
      if (url === null) {
        end(fail("internal"));
        return;
      }
      let result: PartOutcome;
      try {
        result = await sendOne(part, url);
      } catch (error) {
        if (!isAbort(error)) end(fail("internal"));
        return;
      }
      retrying.delete(part.partNumber);
      if (result === "done") {
        finished += part.end - part.start;
        report();
        sync();
      } else if (result === "failed") {
        end(fail("internal"));
      } else {
        end(fail(result === "paused" ? "paused" : "stale_upload"));
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: Math.min(PART_CONCURRENCY, parts.length) }, worker),
    );
  } finally {
    unsubscribe();
    outer.removeEventListener("abort", cancel);
  }
  if (outer.aborted) return fail("canceled");
  return outcome;
}
