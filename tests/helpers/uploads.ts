// Upload [int] helpers (P10a; P10b and P10c reuse them): the browser's half of an upload against the local driver. Part and
// poster PUTs go through the dev storage route's real handlers with the signed URLs the server hands out, the four upload
// routes are called with `new Request()`, and the on-disk paths are read under .data/storage. `trackTestStorage` removes
// only what one test file made (the dev server shares the folder); newCreator, signedIn and newDraft record theirs in it.
import { createHash, randomFillSync } from "node:crypto";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import {
  GET as devStorageGET,
  PUT as devStoragePUT,
} from "../../src/app/api/dev/storage/[...key]/route";
import { POST as abortPOST } from "../../src/app/api/uploads/abort/route";
import { POST as completePOST } from "../../src/app/api/uploads/complete/route";
import { POST as partsPOST } from "../../src/app/api/uploads/parts/route";
import { POST as startPOST } from "../../src/app/api/uploads/start/route";
import { db } from "../../src/db/client";
import { video } from "../../src/db/schema";
import type { Video } from "../../src/db/schema/types";
import type { Actor } from "../../src/server/auth/actor";
import { env } from "../../src/server/env";
import { localDriver } from "../../src/server/storage/index";
import {
  PART_BYTES,
  PART_CONCURRENCY,
  partCount,
} from "../../src/server/storage/limits";
import { LOCAL_STORAGE_ROOT } from "../../src/server/storage/local";
import {
  type CompleteUploadInput,
  completeUpload,
  presignParts,
  presignUpload,
  type StartUploadInput,
  type StartUploadResult,
} from "../../src/server/storage/uploads";
import { createVideoFromUpload } from "../../src/server/videos/create";
import { creatorActor, type SignedInCreator, signedInCreator } from "./auth";
import { insertCreator } from "./factories";

export type Bytes = Uint8Array<ArrayBuffer>;

/** An MP4's first 12 bytes: an `ftyp` box of 32 bytes, brand `isom`. */
const FTYP_HEADER: readonly number[] = [
  0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
];

/** `size` random bytes that start with an `ftyp` box, so the magic-byte check takes them for a video. */
export function videoBytes(size: number): Bytes {
  const bytes = new Uint8Array(size);
  randomFillSync(bytes);
  bytes.set(FTYP_HEADER.slice(0, size));
  return bytes;
}

export const MiB = 1024 ** 2;
/** The 3-part original: 16 + 16 + 8 MiB. */
export const TOTAL = 40 * MiB;
/** A one-part original. */
export const SMALL = MiB + 3;

// One random 40 MiB video-looking file, made once; smaller originals are its prefixes (they keep the ftyp box).
let source: Bytes | undefined;
export const bytesOf = (size: number) => {
  source ??= videoBytes(TOTAL);
  return source.subarray(0, size);
};

/** A PNG's 8-byte signature followed by random bytes: `size` bytes in all. */
export function pngBytes(size: number): Bytes {
  const bytes = new Uint8Array(size);
  randomFillSync(bytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

export const md5Hex = (bytes: Uint8Array) =>
  createHash("md5").update(bytes).digest("hex");

/** A file under tests/fixtures (sample.mp4, poster.jpg). */
export const fixture = async (name: string): Promise<Bytes> =>
  new Uint8Array(
    await readFile(path.join(process.cwd(), "tests/fixtures", name)),
  );

const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** A lowercase uuid, the whole string. */
export const UUID = new RegExp(`^${UUID_SOURCE}$`);

/** An original's whole key: originals/<creatorId>/<videoId>/<uuid>.<ext>. */
export const originalKeyOf = (
  creatorId: string,
  videoId: string,
  ext = "mp4",
) => new RegExp(`^originals/${creatorId}/${videoId}/${UUID_SOURCE}\\.${ext}$`);

/** A poster's whole key: posters/<videoId>/<uuid>.jpg. */
export const posterKeyOf = (videoId: string) =>
  new RegExp(`^posters/${videoId}/${UUID_SOURCE}\\.jpg$`);

/** Part `partNumber` (1-based) of `bytes` cut into `partSize` parts; the last part is the remainder. */
export const partOf = (
  bytes: Bytes,
  partNumber: number,
  partSize = PART_BYTES,
): Bytes => bytes.subarray((partNumber - 1) * partSize, partNumber * partSize);

/** The part numbers 1…n of a file of `size` bytes. */
const allParts = (size: number, partSize: number) =>
  Array.from({ length: partCount(size, partSize) }, (_, i) => i + 1);

// --- The dev storage route, as the browser reaches it -------------------------------------------------------------------

const DEV_STORAGE_PATH = "/api/dev/storage/";

/** The `[...key]` segments the route receives for a signed URL: the path after /api/dev/storage/, decoded. */
export function devStorageSegments(url: string): string[] {
  const { pathname } = new URL(url);
  if (!pathname.startsWith(DEV_STORAGE_PATH)) {
    throw new Error("not a dev storage URL");
  }
  return pathname
    .slice(DEV_STORAGE_PATH.length)
    .split("/")
    .map(decodeURIComponent);
}

const devContext = (url: string) => ({
  params: Promise.resolve({ key: devStorageSegments(url) }),
});

/** A browser PUT of `body` to a signed object or part URL, through the route's PUT handler. */
export function putSigned(
  url: string,
  body: Bytes,
  headers: Record<string, string> = {},
): Promise<Response> {
  return devStoragePUT(
    new NextRequest(url, { method: "PUT", body, headers }),
    devContext(url),
  );
}

/** A browser GET of a signed download URL, through the route's GET handler. */
export function getSigned(url: string): Promise<Response> {
  return devStorageGET(new NextRequest(url), devContext(url));
}

// --- The upload domain, driven the way the browser client drives it --------------------------------------------------

type OriginalStart = Extract<StartUploadInput, { kind: "original" }>;

/** The start input for an original of `size` bytes (an .mp4 unless `overrides` say otherwise). */
export const originalStart = (
  videoId: string,
  size: number,
  overrides: Partial<OriginalStart> = {},
): OriginalStart => ({
  kind: "original",
  videoId,
  fileName: "clip.mp4",
  size,
  contentType: "video/mp4",
  ...overrides,
});

/** Opens an original's multipart upload (or resumes it), failing the setup on a refusal. */
export async function startOriginal(
  actor: Actor,
  videoId: string,
  size: number,
  overrides: Partial<OriginalStart> = {},
): Promise<Extract<StartUploadResult, { mode: "multipart" }>> {
  const result = await presignUpload(
    actor,
    originalStart(videoId, size, overrides),
  );
  if (!result.ok) throw new Error(`start refused: ${result.code}`);
  if (result.upload.mode !== "multipart") throw new Error("not multipart");
  return result.upload;
}

/**
 * Signs `partNumbers` (all of `bytes`'s parts by default) and PUTs them through the dev route PART_CONCURRENCY at a time,
 * as the browser client does; fails the setup unless every PUT answers 200. Returns each part's ETag header.
 */
export async function sendParts(
  actor: Actor,
  i: {
    videoId: string;
    uploadId: string;
    bytes: Bytes;
    partNumbers?: number[];
    partSize?: number;
  },
): Promise<Record<number, string>> {
  const partSize = i.partSize ?? PART_BYTES;
  const partNumbers = i.partNumbers ?? allParts(i.bytes.length, partSize);
  const signed = await presignParts(actor, {
    videoId: i.videoId,
    uploadId: i.uploadId,
    partNumbers,
  });
  if (!signed.ok) throw new Error(`parts refused: ${signed.code}`);
  const etags: Record<number, string> = {};
  const send = async (n: number) => {
    const url = signed.urls[n];
    if (!url) throw new Error(`no URL for part ${n}`);
    const response = await putSigned(url, partOf(i.bytes, n, partSize));
    if (response.status !== 200) {
      throw new Error(`part ${n} PUT answered ${response.status}`);
    }
    etags[n] = response.headers.get("etag") ?? "";
  };
  for (let at = 0; at < partNumbers.length; at += PART_CONCURRENCY) {
    await Promise.all(partNumbers.slice(at, at + PART_CONCURRENCY).map(send));
  }
  return etags;
}

/** What a complete that died after assembling leaves: the driver's completeMultipart ran, the row still says uploading. */
export async function assembleOnly(upload: { key: string; uploadId: string }) {
  const parts = await localDriver().listParts(upload);
  if (parts === "no_such_upload") throw new Error("no upload");
  await localDriver().completeMultipart({
    key: upload.key,
    uploadId: upload.uploadId,
    parts: parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
  });
}

/** start → every part → complete; returns the upload and complete's answer. */
export async function uploadOriginal(
  actor: Actor,
  videoId: string,
  bytes: Bytes,
  opts: {
    start?: Partial<OriginalStart>;
    meta?: Extract<CompleteUploadInput, { kind: "original" }>["meta"];
  } = {},
) {
  const upload = await startOriginal(actor, videoId, bytes.length, opts.start);
  await sendParts(actor, { videoId, uploadId: upload.uploadId, bytes });
  const result = await completeUpload(actor, {
    kind: "original",
    videoId,
    uploadId: upload.uploadId,
    meta: opts.meta,
  });
  return { upload, result };
}

/** Signs a poster PUT (a JPEG frame unless `posterOrigin` says otherwise), failing the setup on a refusal. */
export async function startPoster(
  actor: Actor,
  videoId: string,
  size: number,
  posterOrigin: "frame_capture" | "creator_image" = "frame_capture",
) {
  const result = await presignUpload(actor, {
    kind: "poster",
    videoId,
    size,
    contentType: "image/jpeg",
    posterOrigin,
  });
  if (!result.ok) throw new Error(`poster start refused: ${result.code}`);
  if (result.upload.mode !== "single") throw new Error("not a single PUT");
  return result.upload;
}

/** start → the signed PUT → complete for a poster; returns its key and complete's answer. */
export async function uploadPoster(
  actor: Actor,
  videoId: string,
  bytes: Bytes,
  posterOrigin: "frame_capture" | "creator_image" = "frame_capture",
) {
  const upload = await startPoster(actor, videoId, bytes.length, posterOrigin);
  const put = await putSigned(upload.url, bytes, upload.headers);
  if (put.status !== 200) throw new Error(`poster PUT answered ${put.status}`);
  const result = await completeUpload(actor, {
    kind: "poster",
    videoId,
    uploadToken: upload.uploadToken,
  });
  return { upload, result };
}

// --- The four upload routes ---------------------------------------------------------------------------------------------

const UPLOAD_ROUTES = {
  start: startPOST,
  parts: partsPOST,
  complete: completePOST,
  abort: abortPOST,
} as const;
type UploadRouteName = keyof typeof UPLOAD_ROUTES;
export const UPLOAD_ROUTE_NAMES = Object.keys(
  UPLOAD_ROUTES,
) as UploadRouteName[];

/**
 * POSTs `body` to /api/uploads/<name> through its handler, with the session the mocked next/headers holds. A string
 * body is sent as is; anything else as JSON. The Content-Type is application/json unless given; `headers` adds others.
 */
export function callUploadRoute(
  name: UploadRouteName,
  body: unknown,
  contentType = "application/json",
  headers: Record<string, string> = {},
): Promise<Response> {
  const request = new Request(new URL(`/api/uploads/${name}`, env.APP_URL), {
    method: "POST",
    headers: { ...headers, "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return UPLOAD_ROUTES[name](request);
}

// --- Creators and videos -----------------------------------------------------------------------------------------------

/** A creator (no session) and the actor the session gate would build for it. */
export async function newCreator(disk: TestStorage) {
  const c = await insertCreator();
  disk.creator(c.id);
  const ids = { creatorId: c.id, userId: c.userId };
  return { ...ids, actor: creatorActor(ids) };
}

/** A signed-in creator: the mocked next/headers now carries its session. */
export async function signedIn(disk: TestStorage): Promise<SignedInCreator> {
  const me = await signedInCreator();
  disk.creator(me.creatorId);
  return me;
}

/** A plain-upload draft (createVideoFromUpload) of `c`'s; returns its id. */
export async function newDraft(
  disk: TestStorage,
  c: { actor: Actor },
  title = "Beach day",
): Promise<string> {
  const { videoId } = await createVideoFromUpload(c.actor, { title });
  disk.video(videoId);
  return videoId;
}

/** The video's row, failing the setup when there is none. */
export async function rowOf(id: string): Promise<Video> {
  const [row] = await db.select().from(video).where(eq(video.id, id));
  if (!row) throw new Error("no video");
  return row;
}

/** Moves the upload's start back by `hours`, by the database's clock. */
export const startedHoursAgo = (id: string, hours: number) =>
  db
    .update(video)
    .set({
      originalUploadStartedAt: sql`now() - make_interval(hours => ${hours})`,
    })
    .where(eq(video.id, id));

// --- The disk -----------------------------------------------------------------------------------------------------------

/** Where the local driver keeps `key`. */
export const objectPath = (key: string) => path.join(LOCAL_STORAGE_ROOT, key);

/** The local driver's directory for an open multipart upload. */
export const uploadDirPath = (uploadId: string) =>
  path.join(LOCAL_STORAGE_ROOT, ".multipart", uploadId);

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Every file under `dir` as a sorted relative path ("a/b.mp4"); [] when `dir` doesn't exist. */
export async function listFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir, { recursive: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if ((await stat(path.join(dir, entry))).isFile()) files.push(entry);
  }
  return files.sort();
}

/** The open multipart uploads (by id) whose manifest names a key starting with one of `prefixes`. */
export async function uploadsUnder(...prefixes: string[]): Promise<string[]> {
  const root = path.join(LOCAL_STORAGE_ROOT, ".multipart");
  let ids: string[];
  try {
    ids = await readdir(root);
  } catch {
    return [];
  }
  const keyOf = async (id: string) => {
    try {
      const manifest = JSON.parse(
        await readFile(path.join(root, id, "manifest.json"), "utf8"),
      ) as { key?: unknown };
      return typeof manifest.key === "string" ? manifest.key : null;
    } catch {
      // Not a manifest this file can read (another run's, or mid-write): never this file's to touch.
      return null;
    }
  };
  const keys = await Promise.all(ids.map(keyOf));
  return ids
    .filter((_, n) => prefixes.some((p) => keys[n]?.startsWith(p)))
    .sort();
}

/**
 * What one test file wrote under .data/storage: originals/<creatorId>/ and posters/<videoId>/ for the ids it records, plus
 * any open upload whose manifest names one of its creators' keys. `clean` removes exactly those, never the whole folder
 * (the dev server shares it).
 */
export type TestStorage = ReturnType<typeof trackTestStorage>;

export function trackTestStorage() {
  const creators = new Set<string>();
  const videos = new Set<string>();
  // Only uuids: an empty or odd id would widen a path to a whole prefix.
  const add = (set: Set<string>) => (id: string) => {
    if (!UUID.test(id)) throw new Error("trackTestStorage takes uuids only");
    set.add(id);
  };
  return {
    creator: add(creators),
    video: add(videos),
    async clean() {
      const open = await uploadsUnder(
        ...[...creators].map((id) => `originals/${id}/`),
      );
      const paths = [
        ...[...creators].map((id) => objectPath(`originals/${id}`)),
        ...[...videos].map((id) => objectPath(`posters/${id}`)),
        ...open.map(uploadDirPath),
      ];
      await Promise.all(
        paths.map((p) => rm(p, { recursive: true, force: true })),
      );
    },
  };
}
