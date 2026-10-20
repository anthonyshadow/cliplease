import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { license, licenseRequest, video } from "../../db/schema";
import type { PosterOrigin } from "../../lib/domain/values";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { deriveSubkey } from "../crypto/token-cipher";
import { errorName, logEvent } from "../log";
import { contentDisposition } from "./content-disposition";
import { MultipartError } from "./errors";
import { storage } from "./index";
import { originalKey, posterKey, posterKeyVideoId } from "./keys";
import {
  expectedPartSize,
  GET_URL_TTL_S,
  ORIGINAL_EXTENSION,
  ORIGINAL_MAX_BYTES,
  ORIGINAL_MIME,
  type OriginalMime,
  PART_BYTES,
  PART_URL_BATCH,
  PART_URL_TTL_S,
  POSTER_MAX_BYTES,
  POSTER_MIME,
  PUT_URL_TTL_S,
  partCount,
  UPLOAD_RESUME_WINDOW_MS,
} from "./limits";
import {
  POSTER_TOKEN_SUBKEY,
  readPosterToken,
  signPosterToken,
} from "./poster-token";
import { checkPartList, verifyUploadedObject } from "./verify-object";

// The upload domain (02 §5.9, 07 D09, D80). Every original is a multipart upload on a server key: start opens it,
// parts signs UploadPart URLs, complete assembles it from the SERVER's part list and verifies it, abort ends it. Posters
// are one signed PUT whose key comes back in a sealed upload token (owner answer Q-34 a). Logs carry the video id and an
// error class only, never a key, an upload id or a URL.

export type StartUploadInput =
  | {
      kind: "original";
      videoId: string;
      fileName: string;
      size: number;
      contentType: OriginalMime;
      resume?: boolean;
    }
  | {
      kind: "poster";
      videoId: string;
      size: number;
      contentType: typeof POSTER_MIME;
      posterOrigin: PosterOrigin;
    };

export type StartUploadResult =
  | {
      mode: "multipart";
      key: string;
      uploadId: string;
      partSize: number;
      partCount: number;
      doneParts: number[];
    }
  | {
      mode: "single";
      key: string;
      url: string;
      headers: { "Content-Type": string };
      /** Sent back to complete: it names the video, the key, the size and the poster's origin (Q-34 a). */
      uploadToken: string;
    };

export type CompleteUploadInput =
  | {
      kind: "original";
      videoId: string;
      meta?: {
        durationMs: number | null;
        width: number | null;
        height: number | null;
      };
    }
  | { kind: "poster"; videoId: string; uploadToken: string };

/** The reasons a failed original keeps in `original_error`; complete answers them again. */
const STORED_FAILURES = [
  "size_mismatch",
  "bad_signature_bytes",
  "upload_expired",
] as const;
type StoredFailure = (typeof STORED_FAILURES)[number];
type CompleteCode = StoredFailure | "parts_incomplete" | "not_found";
const storedFailure = (error: string | null): StoredFailure =>
  STORED_FAILURES.find((code) => code === error) ?? "upload_expired";

type Fail<C extends string> = { ok: false; code: C };
const fail = <C extends string>(code: C): Fail<C> => ({ ok: false, code });

/** How long a poster's upload token outlives its PUT URL. */
const POSTER_TOKEN_GRACE_S = 15 * 60;
const WINDOW_S = UPLOAD_RESUME_WINDOW_MS / 1000;
const nowS = () => Math.floor(Date.now() / 1000);
const posterTokenKey = () => deriveSubkey(POSTER_TOKEN_SUBKEY);

type Exec = Pick<typeof db, "select">;

/** What the D09 lock reads besides the video's status: an open request, and any license. */
export const lockFlags = (exec: Exec) => ({
  openRequest: sql<boolean>`exists (${exec
    .select({ one: sql`1` })
    .from(licenseRequest)
    .where(
      and(
        eq(licenseRequest.videoId, video.id),
        inArray(licenseRequest.status, [
          "checkout_pending",
          "awaiting_approval",
        ]),
      ),
    )})`,
  licensed: sql<boolean>`exists (${exec
    .select({ one: sql`1` })
    .from(license)
    .where(eq(license.videoId, video.id))})`,
});

/** The D09 lock (isOriginalLocked) on a row selected with its status and lockFlags. */
export const lockedBy = (row: {
  status: string;
  openRequest: boolean;
  licensed: boolean;
}) =>
  !(row.status === "draft" || row.status === "unpublished") ||
  row.openRequest ||
  row.licensed;

/**
 * 07 D09 (owner answer Q-39 a): the original can change only while the video is draft or unpublished, no request on it is
 * checkout_pending or awaiting_approval (an expired checkout still counts until its clean-up runs), and no license exists.
 * A missing video is locked. P10b hides Replace with it.
 */
export async function isOriginalLocked(
  videoId: string,
  exec: Exec = db,
): Promise<boolean> {
  const [row] = await exec
    .select({ status: video.status, ...lockFlags(exec) })
    .from(video)
    .where(eq(video.id, videoId));
  return !row || lockedBy(row);
}

/** The creator's video with its upload columns and lock flags; `uploadFresh` by the database's clock. */
async function ownVideo(creatorId: string, videoId: string) {
  const [row] = await db
    .select({
      id: video.id,
      status: video.status,
      originalStatus: video.originalStatus,
      originalObjectKey: video.originalObjectKey,
      originalUploadId: video.originalUploadId,
      originalPartBytes: video.originalPartBytes,
      originalBytes: video.originalBytes,
      originalMime: video.originalMime,
      originalError: video.originalError,
      posterObjectKey: video.posterObjectKey,
      ...lockFlags(db),
      uploadFresh: sql<boolean>`coalesce(${video.originalUploadStartedAt} > now() - make_interval(secs => ${WINDOW_S}), false)`,
    })
    .from(video)
    .where(and(eq(video.id, videoId), eq(video.creatorId, creatorId)));
  return row;
}
type OwnVideo = NonNullable<Awaited<ReturnType<typeof ownVideo>>>;

/** Best-effort clean-up after a commit: a failure is logged by video id and error class, never by key. */
async function quietly(
  event: string,
  videoId: string,
  task: () => Promise<void>,
) {
  try {
    await task();
  } catch (error) {
    logEvent("warn", event, { videoId, error: errorName(error) });
  }
}

const deleteQuietly = (videoId: string, key: string) =>
  quietly("storage.delete_failed", videoId, () => storage().delete(key));
const abortQuietly = (videoId: string, key: string, uploadId: string) =>
  quietly("uploads.abort_failed", videoId, () =>
    storage().abortMultipart({ key, uploadId }),
  );

/** The upload columns, all cleared (they are set together, 03 §3.6). */
const NO_UPLOAD = {
  originalUploadId: null,
  originalPartBytes: null,
  originalUploadStartedAt: null,
} as const;

/** What a complete answers once another call has ended the row: its outcome stands, otherwise the row moved on. */
async function settledAnswer(
  videoId: string,
  key: string,
): Promise<{ ok: true } | Fail<CompleteCode>> {
  const [now] = await db
    .select({
      status: video.originalStatus,
      key: video.originalObjectKey,
      error: video.originalError,
    })
    .from(video)
    .where(eq(video.id, videoId));
  if (now?.status === "ready" && now.key === key) return { ok: true };
  if (now?.status === "failed") return fail(storedFailure(now.error));
  return fail("not_found");
}

type OpenUpload = {
  videoId: string;
  key: string;
  uploadId: string;
  size: number;
  meta?: Extract<CompleteUploadInput, { kind: "original" }>["meta"];
};

/**
 * Ends the open upload with one write fenced on it (status uploading, its upload id and key): ready when the file at the
 * key checks out, failed with the reason otherwise; `expired` skips the check (07 D80's 24 h, or parts gone without a
 * file). A failure takes the parts and any file at the key with it. When the fence misses, another call (a parallel
 * complete, a new start, an abort) ended it first: that outcome stands, and a file no row points at goes.
 */
async function settle(
  u: OpenUpload,
  { expired }: { expired: boolean },
): Promise<{ ok: true } | Fail<CompleteCode>> {
  const check = expired
    ? "upload_expired"
    : await verifyUploadedObject(u.key, {
        kind: "original",
        declaredSize: u.size,
        maxBytes: ORIGINAL_MAX_BYTES,
      });
  // Nothing at the key: the parts went without a file (expired, aborted).
  const outcome = check === "not_found" ? "upload_expired" : check;
  const ended = await db
    .update(video)
    .set(
      outcome === "ok"
        ? {
            ...NO_UPLOAD,
            originalStatus: "ready",
            originalError: null,
            originalUpdatedAt: sql`now()`,
            durationMs: u.meta?.durationMs ?? null,
            width: u.meta?.width ?? null,
            height: u.meta?.height ?? null,
          }
        : {
            ...NO_UPLOAD,
            originalStatus: "failed",
            originalError: outcome,
            originalObjectKey: null,
            originalUpdatedAt: sql`now()`,
          },
    )
    .where(
      and(
        eq(video.id, u.videoId),
        eq(video.originalStatus, "uploading"),
        eq(video.originalUploadId, u.uploadId),
        eq(video.originalObjectKey, u.key),
      ),
    )
    .returning({ id: video.id });
  if (ended.length === 0) {
    const answer = await settledAnswer(u.videoId, u.key);
    if (!answer.ok) await deleteQuietly(u.videoId, u.key);
    return answer;
  }
  if (outcome === "ok") return { ok: true };
  await Promise.all([
    abortQuietly(u.videoId, u.key, u.uploadId),
    deleteQuietly(u.videoId, u.key),
  ]);
  return fail(outcome);
}

/**
 * Starts an upload (02 §5.9). Original: a new multipart upload on a server key (the open one and the previous object go
 * once the row points at the new one), or `resume` the open one with the parts already stored. Poster: a signed PUT for a
 * new key and its upload token; no row changes until complete.
 */
export async function presignUpload(
  a: Actor,
  i: StartUploadInput,
): Promise<
  | { ok: true; upload: StartUploadResult }
  | Fail<
      | "not_found"
      | "original_locked"
      | "too_large"
      | "bad_type"
      | "upload_expired"
      | "not_same_file"
    >
> {
  const { creatorId } = requireCreatorActor(a);
  const row = await ownVideo(creatorId, i.videoId);
  if (!row) return fail("not_found");
  if (i.kind === "poster") return startPoster(creatorId, row, i);
  if (!ORIGINAL_MIME.includes(i.contentType)) return fail("bad_type");
  if (i.size < 1 || i.size > ORIGINAL_MAX_BYTES) return fail("too_large");
  if (lockedBy(row)) return fail("original_locked");
  return i.resume ? resumeOriginal(row, i) : startOriginal(creatorId, row, i);
}

async function startOriginal(
  creatorId: string,
  row: OwnVideo,
  i: Extract<StartUploadInput, { kind: "original" }>,
) {
  const key = originalKey(creatorId, row.id, ORIGINAL_EXTENSION[i.contentType]);
  const { uploadId } = await storage().createMultipart({
    key,
    contentType: i.contentType,
  });
  // The row lock serializes this with a publish or another start; the lock rule is read again under it.
  const previous = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        key: video.originalObjectKey,
        uploadId: video.originalUploadId,
      })
      .from(video)
      .where(eq(video.id, row.id))
      .for("update");
    if (!locked || (await isOriginalLocked(row.id, tx))) return null;
    await tx
      .update(video)
      .set({
        originalStatus: "uploading",
        originalObjectKey: key,
        originalUploadId: uploadId,
        originalPartBytes: PART_BYTES,
        originalUploadStartedAt: sql`now()`,
        originalBytes: i.size,
        originalMime: i.contentType,
        originalFilename: i.fileName,
        originalError: null,
        originalUpdatedAt: sql`now()`,
        // The hints belong to the file: the new one brings its own at complete.
        durationMs: null,
        width: null,
        height: null,
      })
      .where(eq(video.id, row.id));
    return locked;
  });
  if (!previous) {
    await abortQuietly(row.id, key, uploadId);
    return fail("original_locked");
  }
  const { key: oldKey, uploadId: oldUpload } = previous;
  if (oldKey) {
    await Promise.all([
      oldUpload ? abortQuietly(row.id, oldKey, oldUpload) : undefined,
      deleteQuietly(row.id, oldKey),
    ]);
  }
  return {
    ok: true as const,
    upload: {
      mode: "multipart" as const,
      key,
      uploadId,
      partSize: PART_BYTES,
      partCount: partCount(i.size, PART_BYTES),
      doneParts: [],
    },
  };
}

/** Same device, same file, within 24 h: the open upload with the parts already stored (07 D80). */
async function resumeOriginal(
  row: OwnVideo,
  i: Extract<StartUploadInput, { kind: "original" }>,
) {
  const key = row.originalObjectKey;
  const uploadId = row.originalUploadId;
  if (row.originalStatus !== "uploading" || !key || !uploadId) {
    return fail("upload_expired");
  }
  if (row.originalBytes !== i.size || row.originalMime !== i.contentType) {
    return fail("not_same_file");
  }
  const partSize = row.originalPartBytes ?? PART_BYTES;
  const count = partCount(i.size, partSize);
  const upload = {
    mode: "multipart" as const,
    key,
    uploadId,
    partSize,
    partCount: count,
  };
  const open = { videoId: row.id, key, uploadId, size: i.size };
  if (!row.uploadFresh) {
    await settle(open, { expired: true });
    return fail("upload_expired");
  }
  const parts = await storage().listParts({ key, uploadId });
  if (parts === "no_such_upload") {
    // Already assembled (a complete is running, or died after assembling): every part is in, and the client's complete
    // finishes it as a retried complete would.
    if (await storage().head(key)) {
      const doneParts = Array.from({ length: count }, (_, n) => n + 1);
      return { ok: true as const, upload: { ...upload, doneParts } };
    }
    await settle(open, { expired: true });
    return fail("upload_expired");
  }
  // Only whole parts count: a short part is sent again.
  const doneParts = parts
    .filter(
      (p) =>
        p.partNumber <= count &&
        p.size === expectedPartSize(p.partNumber, { size: i.size, partSize }),
    )
    .map((p) => p.partNumber);
  return { ok: true as const, upload: { ...upload, doneParts } };
}

async function startPoster(
  creatorId: string,
  row: OwnVideo,
  i: Extract<StartUploadInput, { kind: "poster" }>,
) {
  // 02 §6.2: a poster can change on a live video, but not on a disabled one.
  if (row.status === "disabled") return fail("not_found");
  if (i.contentType !== POSTER_MIME) return fail("bad_type");
  if (i.size < 1 || i.size > POSTER_MAX_BYTES) return fail("too_large");
  const key = posterKey(row.id);
  const { url } = await storage().presignPut({
    key,
    contentType: POSTER_MIME,
    contentLength: i.size,
    expiresIn: PUT_URL_TTL_S,
  });
  const uploadToken = signPosterToken(posterTokenKey(), {
    videoId: row.id,
    creatorId,
    key,
    size: i.size,
    posterOrigin: i.posterOrigin,
    exp: nowS() + PUT_URL_TTL_S + POSTER_TOKEN_GRACE_S,
  });
  return {
    ok: true as const,
    upload: {
      mode: "single" as const,
      key,
      url,
      headers: { "Content-Type": POSTER_MIME },
      uploadToken,
    },
  };
}

/** Signs UploadPart URLs for the video's open upload: at most PART_URL_BATCH, each 1…partCount. Changes nothing. */
export async function presignParts(
  a: Actor,
  i: { videoId: string; uploadId: string; partNumbers: number[] },
): Promise<
  | { ok: true; urls: Record<number, string> }
  | Fail<"not_found" | "too_many" | "bad_part">
> {
  const { creatorId } = requireCreatorActor(a);
  const row = await ownVideo(creatorId, i.videoId);
  const key = row?.originalObjectKey;
  // Owner answer Q-38 a: a disabled video's upload can't go on.
  if (
    !row ||
    !key ||
    row.status === "disabled" ||
    row.originalStatus !== "uploading" ||
    row.originalUploadId !== i.uploadId ||
    !row.originalBytes
  ) {
    return fail("not_found");
  }
  if (i.partNumbers.length > PART_URL_BATCH) return fail("too_many");
  const count = partCount(
    row.originalBytes,
    row.originalPartBytes ?? PART_BYTES,
  );
  if (i.partNumbers.some((n) => !Number.isInteger(n) || n < 1 || n > count)) {
    return fail("bad_part");
  }
  const numbers = [...new Set(i.partNumbers)];
  const urls = await Promise.all(
    numbers.map(
      async (partNumber) =>
        [
          partNumber,
          await storage().presignPart({
            key,
            uploadId: i.uploadId,
            partNumber,
            expiresIn: PART_URL_TTL_S,
          }),
        ] as const,
    ),
  );
  return { ok: true, urls: Object.fromEntries(urls) };
}

/**
 * Finishes an upload (02 §5.9). Original: the server lists the stored parts, checks them, assembles them with its own
 * ETags (never the client's), then checks the size and the first bytes; the row ends ready or failed, fenced on the
 * upload it started from. A missing or short part leaves the upload open for the client to send again (owner answer Q-35
 * a). Calling it again on a ready row is ok. Poster: the upload token names the key; once checked, it replaces the poster.
 */
export async function completeUpload(
  a: Actor,
  i: CompleteUploadInput,
): Promise<{ ok: true } | Fail<CompleteCode>> {
  const { creatorId } = requireCreatorActor(a);
  return i.kind === "poster"
    ? completePoster(creatorId, i)
    : completeOriginal(creatorId, i);
}

async function completeOriginal(
  creatorId: string,
  i: Extract<CompleteUploadInput, { kind: "original" }>,
): Promise<{ ok: true } | Fail<CompleteCode>> {
  const row = await ownVideo(creatorId, i.videoId);
  if (!row || row.status === "disabled") return fail("not_found");
  if (row.originalStatus === "ready") return { ok: true };
  if (row.originalStatus === "failed") {
    return fail(storedFailure(row.originalError));
  }
  const key = row.originalObjectKey;
  const uploadId = row.originalUploadId;
  const size = row.originalBytes;
  if (row.originalStatus !== "uploading" || !key || !uploadId || !size) {
    return fail("not_found");
  }
  const open = { videoId: row.id, key, uploadId, size, meta: i.meta };
  if (!row.uploadFresh) return settle(open, { expired: true });

  // Parts gone (a parallel complete, or one that died after assembling): settle checks what is at the key.
  const parts = await storage().listParts({ key, uploadId });
  if (parts === "no_such_upload") return settle(open, { expired: false });
  const partSize = row.originalPartBytes ?? PART_BYTES;
  if (checkPartList(parts, { size, partSize }) !== "ok") {
    return fail("parts_incomplete");
  }
  try {
    await storage().completeMultipart({
      key,
      uploadId,
      parts: parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
    });
  } catch (error) {
    if (!(error instanceof MultipartError)) throw error;
    // A part changed after the list (re-sent meanwhile): still open, send it again.
    if (error.reason === "invalid_part") return fail("parts_incomplete");
  }
  return settle(open, { expired: false });
}

async function completePoster(
  creatorId: string,
  i: Extract<CompleteUploadInput, { kind: "poster" }>,
): Promise<{ ok: true } | Fail<CompleteCode>> {
  const token = readPosterToken(posterTokenKey(), i.uploadToken, nowS());
  if (
    !token ||
    token.videoId !== i.videoId ||
    token.creatorId !== creatorId ||
    posterKeyVideoId(token.key) !== i.videoId
  ) {
    return fail("not_found");
  }
  const row = await ownVideo(creatorId, i.videoId);
  if (!row || row.status === "disabled") return fail("not_found");
  if (row.posterObjectKey === token.key) return { ok: true };
  const check = await verifyUploadedObject(token.key, {
    kind: "poster",
    declaredSize: token.size,
    maxBytes: POSTER_MAX_BYTES,
  });
  if (check !== "ok") {
    if (check !== "not_found") await deleteQuietly(row.id, token.key);
    return fail(check);
  }
  const previous = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ key: video.posterObjectKey })
      .from(video)
      .where(and(eq(video.id, row.id), eq(video.creatorId, creatorId)))
      .for("update");
    if (!locked) return null;
    await tx
      .update(video)
      .set({ posterObjectKey: token.key, posterOrigin: token.posterOrigin })
      .where(eq(video.id, row.id));
    return locked;
  });
  if (!previous) return fail("not_found");
  if (previous.key && previous.key !== token.key) {
    await deleteQuietly(row.id, previous.key);
  }
  return { ok: true };
}

/**
 * Cancel on the File step (P10c): ends an open or failed upload and clears the file columns. A ready or empty original is
 * left as it is. Allowed on a disabled video, so nothing is left behind (owner answer Q-38 a).
 */
export async function abortUpload(
  a: Actor,
  i: { videoId: string },
): Promise<{ ok: true } | Fail<"not_found">> {
  const { creatorId } = requireCreatorActor(a);
  const ended = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        status: video.originalStatus,
        key: video.originalObjectKey,
        uploadId: video.originalUploadId,
      })
      .from(video)
      .where(and(eq(video.id, i.videoId), eq(video.creatorId, creatorId)))
      .for("update");
    if (!locked) return null;
    if (locked.status !== "uploading" && locked.status !== "failed") {
      return { key: null, uploadId: null };
    }
    await tx
      .update(video)
      .set({
        ...NO_UPLOAD,
        originalStatus: "none",
        originalObjectKey: null,
        originalError: null,
        originalBytes: null,
        originalMime: null,
        originalFilename: null,
        originalUpdatedAt: sql`now()`,
      })
      .where(eq(video.id, i.videoId));
    return locked;
  });
  if (!ended) return fail("not_found");
  if (ended.key && ended.uploadId) {
    // A file a failed complete assembled at the key is no one's once the row lets go of it.
    await Promise.all([
      abortQuietly(i.videoId, ended.key, ended.uploadId),
      deleteQuietly(i.videoId, ended.key),
    ]);
  }
  return { ok: true };
}

/** A signed, 5-minute download URL with the file's name (07 D61; P20's downloads). */
export async function presignDownload(i: {
  key: string;
  filename: string;
  disposition: "attachment" | "inline";
  contentType?: string;
}): Promise<string> {
  return storage().presignGet({
    key: i.key,
    expiresIn: GET_URL_TTL_S,
    disposition: contentDisposition(i.disposition, i.filename),
    contentType: i.contentType,
  });
}
