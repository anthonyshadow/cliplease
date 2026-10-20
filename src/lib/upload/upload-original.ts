// The browser's multipart upload of an original (02 §5.9 "Browser side", 07 D80): start → part URLs in batches →
// PART_CONCURRENCY part PUTs at once → complete with no ETags (the server lists the parts itself). Browser only. Per-part
// retry, offline pause and resume are P10c's: here a failed part fails the upload with `network`.
import type { StartUploadResult } from "../../server/storage/uploads";
import {
  completeUpload,
  postUploadRoute,
  putWithProgress,
  type UploadResult,
} from "./http";
import { type OriginalMime, PART_CONCURRENCY, PART_URL_BATCH } from "./limits";
import { type PlannedPart, planParts } from "./plan";

/** The display hints complete takes (P10a's strict schema: nothing else). */
export type OriginalMeta = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

export type UploadOriginalInput = {
  videoId: string;
  file: File;
  contentType: OriginalMime;
  /** Awaited before complete, never before the parts; the caller bounds it (readVideoMetadata's 15 s). */
  meta: Promise<OriginalMeta | null>;
  /** Bytes sent so far: finished parts plus the parts in flight. */
  onProgress?: (sent: number, total: number) => void;
  /** Every part is in: complete is next (the File step's "Checking the file…"). */
  onPartsDone?: () => void;
  /** Aborts every part PUT (Cancel). Once complete is sent it runs to its answer. */
  signal?: AbortSignal;
};

// The browser picks no key, ETag or part size: they come from start.
type Multipart = Extract<StartUploadResult, { mode: "multipart" }>;

export async function uploadOriginal(
  i: UploadOriginalInput,
): Promise<UploadResult> {
  const { videoId, file, signal } = i;
  const started = await postUploadRoute<StartUploadResult>(
    "start",
    {
      kind: "original",
      videoId,
      fileName: file.name.slice(0, 255),
      size: file.size,
      contentType: i.contentType,
    },
    signal,
  );
  if (!started.ok) return started;
  const upload = started.data;
  if (upload.mode !== "multipart") return { ok: false, code: "internal" };
  const parts = planParts(file.size, upload.partSize);
  if (parts.length !== upload.partCount) return { ok: false, code: "internal" };

  const sent = await sendParts(i, upload, parts);
  if (!sent.ok) return sent;
  i.onPartsDone?.();
  const meta = await i.meta;
  return completeUpload(
    { kind: "original", videoId, ...(meta ? { meta } : {}) },
    signal,
  );
}

/** The parts, PART_CONCURRENCY at a time; the first failure stops the rest. URLs are signed PART_URL_BATCH at a time. */
async function sendParts(
  i: UploadOriginalInput,
  upload: Multipart,
  parts: PlannedPart[],
): Promise<UploadResult> {
  // Cancel, or the first failure, aborts every part in flight.
  const stop = new AbortController();
  const { signal } = stop;
  const cancel = () => stop.abort();
  i.signal?.addEventListener("abort", cancel, { once: true });
  if (i.signal?.aborted) cancel();
  const total = i.file.size;
  const inFlight = new Map<number, number>();
  let finished = 0;
  let failed: Extract<UploadResult, { ok: false }> | null = null;
  const fail = (result: Extract<UploadResult, { ok: false }>) => {
    failed ??= result;
    stop.abort();
  };
  const report = () => {
    let sent = finished;
    for (const loaded of inFlight.values()) sent += loaded;
    i.onProgress?.(sent, total);
  };

  // One request per batch of part numbers, shared by the workers that need it.
  const batches = new Map<number, Promise<Record<string, string> | null>>();
  const urlFor = async (index: number) => {
    const batch = Math.floor(index / PART_URL_BATCH);
    let urls = batches.get(batch);
    if (!urls) {
      const partNumbers = parts
        .slice(batch * PART_URL_BATCH, (batch + 1) * PART_URL_BATCH)
        .map((p) => p.partNumber);
      urls = postUploadRoute<{ urls: Record<string, string> }>(
        "parts",
        { videoId: i.videoId, uploadId: upload.uploadId, partNumbers },
        signal,
      ).then((r) => {
        if (r.ok) return r.data.urls;
        fail(r);
        return null;
      });
      batches.set(batch, urls);
    }
    return (await urls)?.[String(parts[index]?.partNumber)] ?? null;
  };

  let next = 0;
  const worker = async () => {
    while (failed === null && next < parts.length) {
      const index = next++;
      const part = parts[index];
      if (!part) return;
      const url = await urlFor(index);
      if (failed !== null) return;
      if (url === null) {
        fail({ ok: false, code: "internal" });
        return;
      }
      const size = part.end - part.start;
      inFlight.set(part.partNumber, 0);
      const put = await putWithProgress(
        url,
        i.file.slice(part.start, part.end),
        {
          signal,
          onProgress: (loaded) => {
            inFlight.set(part.partNumber, Math.min(loaded, size));
            report();
          },
        },
      );
      inFlight.delete(part.partNumber);
      if (!put.ok) {
        fail(put);
        return;
      }
      if (put.status < 200 || put.status >= 300) {
        fail({ ok: false, code: "network" });
        return;
      }
      finished += size;
      report();
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PART_CONCURRENCY, parts.length) }, worker),
  );
  i.signal?.removeEventListener("abort", cancel);
  if (i.signal?.aborted) return { ok: false, code: "canceled" };
  return failed ?? { ok: true };
}
