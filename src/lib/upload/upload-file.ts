// The browser's single-PUT upload of a cover image (02 §5.9, owner answer Q-34 a): start → one PUT with exactly the
// signed headers → complete with the sealed upload token start returned. Browser only.

import type { StartUploadResult } from "../../server/storage/uploads";
import type { PosterOrigin } from "../domain/values";
import {
  completeUpload,
  postUploadRoute,
  putWithProgress,
  type UploadResult,
} from "./http";
import { POSTER_MIME } from "./limits";

export type UploadFileInput = {
  videoId: string;
  kind: "poster";
  /** A JPEG of at most POSTER_MAX_BYTES (the frame capture's or encodeImageToJpeg's). */
  body: Blob;
  posterOrigin: PosterOrigin;
  onProgress?: (sent: number, total: number) => void;
  /** Aborts start and the PUT. Once complete is sent it runs to its answer. */
  signal?: AbortSignal;
};

export async function uploadFile(i: UploadFileInput): Promise<UploadResult> {
  const started = await postUploadRoute<StartUploadResult>(
    "start",
    {
      kind: i.kind,
      videoId: i.videoId,
      size: i.body.size,
      contentType: POSTER_MIME,
      posterOrigin: i.posterOrigin,
    },
    i.signal,
  );
  if (!started.ok) return started;
  const upload = started.data;
  if (upload.mode !== "single") return { ok: false, code: "internal" };
  const put = await putWithProgress(upload.url, i.body, {
    headers: upload.headers,
    signal: i.signal,
    onProgress: (loaded) => i.onProgress?.(loaded, i.body.size),
  });
  if (!put.ok) return put;
  // 412: the object is already there (a repeated PUT of the same key), so complete can still check it.
  if (put.status !== 200 && put.status !== 412) {
    return { ok: false, code: "internal" };
  }
  return completeUpload(
    { kind: i.kind, videoId: i.videoId, uploadToken: upload.uploadToken },
    i.signal,
  );
}
