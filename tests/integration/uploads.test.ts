import { randomUUID } from "node:crypto";
import { readFile, rm, utimes } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db } from "../../src/db/client";
import { video } from "../../src/db/schema";
import type { NewVideo, Video } from "../../src/db/schema/types";
import { HOUR_MS } from "../../src/lib/time";
import type { Actor } from "../../src/server/auth/actor";
import { deriveSubkey } from "../../src/server/crypto/token-cipher";
import { env } from "../../src/server/env";
import { contentDisposition } from "../../src/server/storage/content-disposition";
import { handleDevStorage } from "../../src/server/storage/dev-route";
import { localDriver } from "../../src/server/storage/index";
import {
  ORIGINAL_MAX_BYTES,
  PART_BYTES,
  PART_URL_BATCH,
  POSTER_MAX_BYTES,
} from "../../src/server/storage/limits";
import {
  type PosterTokenPayload,
  signPosterToken,
} from "../../src/server/storage/poster-token";
import {
  abortUpload,
  completeUpload,
  isOriginalLocked,
  presignDownload,
  presignParts,
  presignUpload,
  type StartUploadInput,
} from "../../src/server/storage/uploads";
import { mockNextHeaders } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import {
  insertLicense,
  insertLicenseRequest,
  insertUploadVideo,
  publishVideo,
} from "../helpers/factories";
import { captureLogEvents } from "../helpers/logs";
import {
  assembleOnly,
  type Bytes,
  bytesOf,
  callUploadRoute,
  devStorageSegments,
  fixture,
  getSigned,
  listFiles,
  MiB,
  md5Hex,
  newCreator,
  objectPath,
  originalKeyOf,
  originalStart,
  partOf,
  pathExists,
  pngBytes,
  posterKeyOf,
  putSigned,
  rowOf,
  SMALL,
  sendParts,
  signedIn,
  startedHoursAgo,
  startOriginal,
  startPoster,
  TOTAL,
  trackTestStorage,
  UPLOAD_ROUTE_NAMES,
  UUID,
  uploadDirPath,
  uploadOriginal,
  uploadPoster,
  uploadsUnder,
} from "../helpers/uploads";

// The upload API against the local driver and the test database (P10a; 02 §5.9, §6.2; 07 D09, D51, D61, D80). The
// browser's PUTs go through the dev storage route's real handlers with the signed URLs the server hands out; owner answers
// Q-34 a (poster upload token), Q-35 a (a missing or short part keeps the upload open), Q-36 a (the poster URL signs its
// type and length; write-once), Q-38 a (a disabled video's upload can only be aborted), Q-39 a (D09 lock taken literally).
vi.mock("next/headers", () => import("../helpers/next-headers"));

const disk = trackTestStorage();

afterAll(async () => {
  await disk.clean();
  await resetDb();
});
beforeEach(() => mockNextHeaders(null));
afterEach(() => vi.restoreAllMocks());

/** A two-part original: 16 MiB + 1 MiB. */
const TWO_PARTS = PART_BYTES + MiB;

const basename = (key: string) => key.slice(key.lastIndexOf("/") + 1);

async function newVideo(creatorId: string, overrides: Partial<NewVideo> = {}) {
  const v = await insertUploadVideo({ id: creatorId }, overrides);
  disk.video(v.id);
  return v;
}

const DISABLED = {
  status: "disabled",
  disabledAt: new Date(),
  disabledReason: "other",
} as const;
const disable = (id: string) =>
  db.update(video).set(DISABLED).where(eq(video.id, id));

/** The upload columns all cleared (03 §3.6). */
const NO_UPLOAD = {
  originalUploadId: null,
  originalPartBytes: null,
  originalUploadStartedAt: null,
};

/** The original's file columns all empty: what a new draft and an abort leave. */
const NO_ORIGINAL = {
  ...NO_UPLOAD,
  originalStatus: "none",
  originalObjectKey: null,
  originalBytes: null,
  originalMime: null,
  originalFilename: null,
  originalError: null,
};

async function expectJson(response: Response, status: number, body: unknown) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(body);
}

describe("a 3-part original (16 + 16 + 8 MiB) through the routes and the dev storage route", () => {
  it("lands exactly one object at originals/<creatorId>/<videoId>/<uuid>.mp4 and ends ready with the meta", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    const bytes = bytesOf(TOTAL);

    const start = await callUploadRoute(
      "start",
      originalStart(v.id, TOTAL, { fileName: "Beach day.mp4" }),
    );
    expect(start.status).toBe(200);
    expect(start.headers.get("cache-control")).toBe("no-store");
    const upload = (await start.json()) as {
      key: string;
      uploadId: string;
    };
    expect(upload).toEqual({
      mode: "multipart",
      key: expect.stringMatching(originalKeyOf(me.creatorId, v.id)),
      uploadId: expect.stringMatching(UUID),
      partSize: PART_BYTES,
      partCount: 3,
      doneParts: [],
    });
    expect(upload.key).not.toContain("Beach");
    expect(await listFiles(uploadDirPath(upload.uploadId))).toEqual([
      "manifest.json",
    ]);
    expect(await rowOf(v.id)).toMatchObject({
      originalStatus: "uploading",
      originalObjectKey: upload.key,
      originalUploadId: upload.uploadId,
      originalPartBytes: PART_BYTES,
      originalUploadStartedAt: expect.any(Date),
      originalBytes: TOTAL,
      originalMime: "video/mp4",
      originalFilename: "Beach day.mp4",
      originalError: null,
    });

    const parts = await callUploadRoute("parts", {
      videoId: v.id,
      uploadId: upload.uploadId,
      partNumbers: [1, 2, 3],
    });
    expect(parts.status).toBe(200);
    const { urls } = (await parts.json()) as { urls: Record<string, string> };
    expect(Object.keys(urls)).toEqual(["1", "2", "3"]);
    const nowS = Math.floor(Date.now() / 1000);
    for (const [n, url] of Object.entries(urls)) {
      const signed = new URL(url);
      expect(signed.origin).toBe(env.APP_URL);
      expect(signed.pathname).toBe(`/api/dev/storage/${upload.key}`);
      // No checksum and no type on an UploadPart URL (07 D80).
      expect([...signed.searchParams.keys()].sort()).toEqual([
        "exp",
        "partNumber",
        "sig",
        "uploadId",
      ]);
      expect(signed.searchParams.get("uploadId")).toBe(upload.uploadId);
      expect(signed.searchParams.get("partNumber")).toBe(n);
      const exp = Number(signed.searchParams.get("exp"));
      expect(exp).toBeGreaterThanOrEqual(nowS + 3600 - 5);
      expect(exp).toBeLessThanOrEqual(nowS + 3600 + 5);
    }

    for (const n of [1, 2, 3]) {
      const part = partOf(bytes, n);
      const put = await putSigned(urls[n] ?? "", part);
      expect(put.status, `part ${n}`).toBe(200);
      expect(put.headers.get("etag")).toBe(`"${md5Hex(part)}"`);
    }

    await expectJson(
      await callUploadRoute("complete", {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
        meta: { durationMs: 14_000, width: 720, height: 1280 },
      }),
      200,
      { ok: true },
    );
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "ready",
      originalObjectKey: upload.key,
      originalBytes: 41_943_040,
      originalMime: "video/mp4",
      originalFilename: "Beach day.mp4",
      originalError: null,
      durationMs: 14_000,
      width: 720,
      height: 1280,
    });
    expect(await listFiles(objectPath(`originals/${me.creatorId}`))).toEqual([
      `${v.id}/${basename(upload.key)}`,
    ]);
    const stored = await readFile(objectPath(upload.key));
    expect(stored.length).toBe(TOTAL);
    expect(stored.equals(bytes)).toBe(true);
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
  });
});

describe("completeUpload (original)", () => {
  it("refuses a body carrying ETags or parts (400 invalid) and completes with the server's own ETags", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    const bytes = bytesOf(TWO_PARTS);
    const upload = await startOriginal(me.actor, v.id, TWO_PARTS);
    const etags = await sendParts(me.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes,
    });

    for (const body of [
      {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
        etag: '"0"',
      },
      {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
        parts: [
          { partNumber: 1, etag: etags[1] },
          { partNumber: 2, etag: etags[2] },
        ],
      },
      {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
        meta: { durationMs: 1, width: 1, height: 1, etag: '"0"' },
      },
    ]) {
      await expectJson(await callUploadRoute("complete", body), 400, {
        code: "invalid",
      });
    }
    expect((await rowOf(v.id)).originalStatus).toBe("uploading");

    const assemble = vi.spyOn(localDriver(), "completeMultipart");
    await expectJson(
      await callUploadRoute("complete", {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      }),
      200,
      { ok: true },
    );
    expect(assemble).toHaveBeenCalledTimes(1);
    expect(assemble).toHaveBeenCalledWith({
      key: upload.key,
      uploadId: upload.uploadId,
      parts: [
        { partNumber: 1, etag: `"${md5Hex(partOf(bytes, 1))}"` },
        { partNumber: 2, etag: `"${md5Hex(partOf(bytes, 2))}"` },
      ],
    });
    expect((await rowOf(v.id)).originalStatus).toBe("ready");
  });

  it("answers parts_incomplete to a missing or short middle part and keeps the upload open to send it again (Q-35 a)", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const bytes = bytesOf(TOTAL);
    const upload = await startOriginal(c.actor, v.id, TOTAL);
    const complete = () =>
      completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      });
    const stillOpen = async () => {
      expect(await rowOf(v.id)).toMatchObject({
        originalStatus: "uploading",
        originalObjectKey: upload.key,
        originalUploadId: upload.uploadId,
        originalError: null,
      });
      expect(await pathExists(objectPath(upload.key))).toBe(false);
    };

    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes,
      partNumbers: [1, 3],
    });
    expect(await complete()).toEqual({ ok: false, code: "parts_incomplete" });
    await stillOpen();

    // Part 2 arrives short: half of it.
    const signed = await presignParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      partNumbers: [2],
    });
    if (!signed.ok) throw new Error(signed.code);
    const url = signed.urls[2] ?? "";
    expect(
      (await putSigned(url, partOf(bytes, 2).subarray(0, 8 * MiB))).status,
    ).toBe(200);
    expect(await complete()).toEqual({ ok: false, code: "parts_incomplete" });
    await stillOpen();
    const kept = await listFiles(uploadDirPath(upload.uploadId));
    expect(kept.filter((f) => f.endsWith(".part"))).toEqual([
      "1.part",
      "2.part",
      "3.part",
    ]);
    // A resume counts only whole parts.
    expect(
      await presignUpload(
        c.actor,
        originalStart(v.id, TOTAL, { resume: true }),
      ),
    ).toMatchObject({ ok: true, upload: { doneParts: [1, 3] } });

    expect((await putSigned(url, partOf(bytes, 2))).status).toBe(200);
    expect(await complete()).toEqual({ ok: true });
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "ready",
      originalBytes: TOTAL,
    });
    expect((await readFile(objectPath(upload.key))).equals(bytes)).toBe(true);
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
  });

  it("ends failed / size_mismatch and deletes the object when the assembled size differs", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const upload = await startOriginal(c.actor, v.id, SMALL);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: bytesOf(SMALL),
    });
    const driver = localDriver();
    const realHead = driver.head;
    vi.spyOn(driver, "head").mockImplementation(async (key) => {
      const head = await realHead(key);
      return head && { ...head, size: head.size + 1 };
    });

    const complete = () =>
      completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      });
    expect(await complete()).toEqual({ ok: false, code: "size_mismatch" });
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "failed",
      originalError: "size_mismatch",
      originalObjectKey: null,
    });
    expect(await pathExists(objectPath(upload.key))).toBe(false);
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
    expect(await complete()).toEqual({ ok: false, code: "size_mismatch" });
  });

  it("ends failed / bad_signature_bytes and deletes the object for zero-filled parts; abort then clears it", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const zeros = new Uint8Array(TWO_PARTS);
    const upload = await startOriginal(c.actor, v.id, TWO_PARTS);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: zeros,
    });

    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      }),
    ).toEqual({ ok: false, code: "bad_signature_bytes" });
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "failed",
      originalError: "bad_signature_bytes",
      originalObjectKey: null,
    });
    expect(await pathExists(objectPath(upload.key))).toBe(false);
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
    expect(await listFiles(objectPath(`originals/${c.creatorId}`))).toEqual([]);

    expect(await abortUpload(c.actor, { videoId: v.id })).toEqual({ ok: true });
    expect(await rowOf(v.id)).toMatchObject(NO_ORIGINAL);
  });

  it("answers ok to a second complete on a ready original and changes nothing", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const { upload, result } = await uploadOriginal(
      c.actor,
      v.id,
      bytesOf(SMALL),
      { meta: { durationMs: 1000, width: 10, height: 20 } },
    );
    expect(result).toEqual({ ok: true });
    const ready = await rowOf(v.id);

    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
        meta: { durationMs: 5, width: 5, height: 5 },
      }),
    ).toEqual({ ok: true });
    expect(await rowOf(v.id)).toEqual(ready);
    expect(await listFiles(objectPath(`originals/${c.creatorId}`))).toEqual([
      `${v.id}/${basename(upload.key)}`,
    ]);
  });

  it("answers 400 invalid to an original complete without its upload id, or with an empty or overlong one", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    const upload = await startOriginal(me.actor, v.id, SMALL);
    await sendParts(me.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: bytesOf(SMALL),
    });
    const open = await rowOf(v.id);

    for (const uploadId of [undefined, "", "u".repeat(1025)]) {
      await expectJson(
        await callUploadRoute("complete", {
          kind: "original",
          videoId: v.id,
          uploadId,
        }),
        400,
        { code: "invalid" },
      );
    }
    expect(await rowOf(v.id)).toEqual(open);
  });

  it.each([
    ["two completes of the 3-part original", TOTAL, 2],
    ["three completes of a 2-part original", TWO_PARTS, 3],
  ])(
    "ends ready with exactly one object after %s in parallel",
    async (_, size, calls) => {
      const c = await newCreator(disk);
      const v = await newVideo(c.creatorId);
      const bytes = bytesOf(size);
      const upload = await startOriginal(c.actor, v.id, size);
      await sendParts(c.actor, {
        videoId: v.id,
        uploadId: upload.uploadId,
        bytes,
      });

      const results = await Promise.all(
        Array.from({ length: calls }, () =>
          completeUpload(c.actor, {
            kind: "original",
            videoId: v.id,
            uploadId: upload.uploadId,
          }),
        ),
      );
      // Completes of one upload settle one after another (as on R2): the later ones find it done and answer ok too.
      expect(results).toEqual(results.map(() => ({ ok: true })));
      expect(await rowOf(v.id)).toMatchObject({
        ...NO_UPLOAD,
        originalStatus: "ready",
        originalObjectKey: upload.key,
        originalBytes: size,
        originalError: null,
      });
      expect(await listFiles(objectPath(`originals/${c.creatorId}`))).toEqual([
        `${v.id}/${basename(upload.key)}`,
      ]);
      expect((await readFile(objectPath(upload.key))).equals(bytes)).toBe(true);
      expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
    },
  );

  it("keeps the new upload when a start lands between assembly and finish, and the old file goes (fence)", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const old = await startOriginal(c.actor, v.id, SMALL);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: old.uploadId,
      bytes: bytesOf(SMALL),
    });
    const driver = localDriver();
    const realHead = driver.head;
    let next: Awaited<ReturnType<typeof startOriginal>> | undefined;
    vi.spyOn(driver, "head").mockImplementationOnce(async (key) => {
      // The parts are assembled: the old object is on disk and its upload directory is gone.
      expect(await pathExists(objectPath(old.key))).toBe(true);
      next = await startOriginal(c.actor, v.id, TWO_PARTS);
      return realHead(key);
    });

    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: old.uploadId,
      }),
    ).toEqual({ ok: false, code: "not_found" });
    if (!next) throw new Error("the new start didn't run");
    expect(next.key).not.toBe(old.key);
    expect(await rowOf(v.id)).toMatchObject({
      originalStatus: "uploading",
      originalObjectKey: next.key,
      originalUploadId: next.uploadId,
      originalBytes: TWO_PARTS,
    });
    expect(await pathExists(objectPath(old.key))).toBe(false);
    expect(await pathExists(uploadDirPath(old.uploadId))).toBe(false);
    expect(await pathExists(uploadDirPath(next.uploadId))).toBe(true);

    vi.restoreAllMocks();
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: next.uploadId,
      bytes: bytesOf(TWO_PARTS),
    });
    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: next.uploadId,
      }),
    ).toEqual({ ok: true });
    expect(await listFiles(objectPath(`originals/${c.creatorId}`))).toEqual([
      `${v.id}/${basename(next.key)}`,
    ]);
  });

  it("deletes the assembled file when an abort lands between assembly and finish (fence)", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const upload = await startOriginal(c.actor, v.id, SMALL);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: bytesOf(SMALL),
    });
    const driver = localDriver();
    const realHead = driver.head;
    vi.spyOn(driver, "head").mockImplementationOnce(async (key) => {
      expect(await abortUpload(c.actor, { videoId: v.id })).toEqual({
        ok: true,
      });
      return realHead(key);
    });

    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(await rowOf(v.id)).toMatchObject(NO_ORIGINAL);
    expect(await pathExists(objectPath(upload.key))).toBe(false);
  });
});

describe("completeUpload (original): races", () => {
  it("answers bad_signature_bytes to both of two parallel completes of a zero-filled original and leaves no object", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const upload = await startOriginal(c.actor, v.id, TWO_PARTS);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: new Uint8Array(TWO_PARTS),
    });

    const complete = () =>
      completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      });
    expect(await Promise.all([complete(), complete()])).toEqual([
      { ok: false, code: "bad_signature_bytes" },
      { ok: false, code: "bad_signature_bytes" },
    ]);
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "failed",
      originalError: "bad_signature_bytes",
      originalObjectKey: null,
    });
    expect(await pathExists(objectPath(upload.key))).toBe(false);
    expect(await listFiles(objectPath(`originals/${c.creatorId}`))).toEqual([]);
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
  });

  it("answers bad_signature_bytes to a complete that finds the parts gone just before the other one fails the file", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const upload = await startOriginal(c.actor, v.id, TWO_PARTS);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: new Uint8Array(TWO_PARTS),
    });
    const driver = localDriver();
    const realHead = driver.head;
    const realReadRange = driver.readRange;
    let reachHead = () => {};
    const laterAtHead = new Promise<void>((resolve) => {
      reachHead = resolve;
    });
    const complete = () =>
      completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      });
    const calls: Promise<unknown>[] = [];
    // The call that assembles reads the bytes only once the other one, finding the parts gone and the row still
    // 'uploading', is about to HEAD the file; that HEAD runs once the first call has failed the file and deleted it.
    vi.spyOn(driver, "readRange").mockImplementationOnce(
      async (key, start, end) => {
        await Promise.race([
          laterAtHead,
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
        return realReadRange(key, start, end);
      },
    );
    vi.spyOn(driver, "head")
      .mockImplementationOnce(realHead)
      .mockImplementationOnce(async (key) => {
        reachHead();
        await Promise.race(calls);
        return realHead(key);
      });
    calls.push(complete(), complete());

    expect(await Promise.all(calls)).toEqual([
      { ok: false, code: "bad_signature_bytes" },
      { ok: false, code: "bad_signature_bytes" },
    ]);
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "failed",
      originalError: "bad_signature_bytes",
      originalObjectKey: null,
    });
    expect(await pathExists(objectPath(upload.key))).toBe(false);
  });

  it("reports every part done to a resume that lands while a complete verifies, and the complete still ends ready", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const bytes = bytesOf(TOTAL);
    const upload = await startOriginal(c.actor, v.id, TOTAL);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes,
    });
    const driver = localDriver();
    const realReadRange = driver.readRange;
    let resumed: Awaited<ReturnType<typeof presignUpload>> | undefined;
    vi.spyOn(driver, "readRange").mockImplementationOnce(
      async (key, start, end) => {
        resumed = await presignUpload(
          c.actor,
          originalStart(v.id, TOTAL, { resume: true }),
        );
        return realReadRange(key, start, end);
      },
    );

    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      }),
    ).toEqual({ ok: true });
    expect(resumed).toEqual({
      ok: true,
      upload: {
        mode: "multipart",
        key: upload.key,
        uploadId: upload.uploadId,
        partSize: PART_BYTES,
        partCount: 3,
        doneParts: [1, 2, 3],
      },
    });
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "ready",
      originalObjectKey: upload.key,
    });
    // The resumed client's own complete is the no-op on a ready row.
    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      }),
    ).toEqual({ ok: true });
    expect(await listFiles(objectPath(`originals/${c.creatorId}`))).toEqual([
      `${v.id}/${basename(upload.key)}`,
    ]);
    expect((await readFile(objectPath(upload.key))).equals(bytes)).toBe(true);
  });
});

describe("completeUpload (original): the upload it names", () => {
  it("answers not_found to a late complete naming an upload a new start replaced, and leaves the new one and its hints alone", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const first = await startOriginal(c.actor, v.id, SMALL);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: first.uploadId,
      bytes: bytesOf(SMALL),
    });
    // Another tab or device starts again and sends every part of its file before the first one's complete lands.
    const second = await startOriginal(c.actor, v.id, TWO_PARTS);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: second.uploadId,
      bytes: bytesOf(TWO_PARTS),
    });
    const open = await rowOf(v.id);

    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: first.uploadId,
        meta: { durationMs: 1000, width: 10, height: 20 },
      }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(await rowOf(v.id)).toEqual(open);
    expect(open).toMatchObject({
      originalStatus: "uploading",
      originalUploadId: second.uploadId,
      durationMs: null,
      width: null,
      height: null,
    });
    expect(
      (await listFiles(uploadDirPath(second.uploadId))).filter((f) =>
        f.endsWith(".part"),
      ),
    ).toEqual(["1.part", "2.part"]);

    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: second.uploadId,
        meta: { durationMs: 2000, width: 30, height: 40 },
      }),
    ).toEqual({ ok: true });
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "ready",
      originalObjectKey: second.key,
      originalBytes: TWO_PARTS,
      durationMs: 2000,
      width: 30,
      height: 40,
    });
    expect(
      (await readFile(objectPath(second.key))).equals(bytesOf(TWO_PARTS)),
    ).toBe(true);
  });

  it("answers ok to a complete naming a replaced upload once the new one is ready, and keeps the new one's hints", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const first = await startOriginal(c.actor, v.id, SMALL);
    const second = await uploadOriginal(c.actor, v.id, bytesOf(TWO_PARTS), {
      meta: { durationMs: 2000, width: 30, height: 40 },
    });
    expect(second.result).toEqual({ ok: true });
    const ready = await rowOf(v.id);

    // A ready row keeps no upload id to compare (03 §3.6): a retried complete of either upload is the no-op.
    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: first.uploadId,
        meta: { durationMs: 1000, width: 10, height: 20 },
      }),
    ).toEqual({ ok: true });
    expect(await rowOf(v.id)).toEqual(ready);
  });

  it("leaves an original uploading, never ready, when its video is disabled while complete checks it (Q-38 a)", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const upload = await startOriginal(c.actor, v.id, SMALL);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: bytesOf(SMALL),
    });
    const driver = localDriver();
    const realHead = driver.head;
    vi.spyOn(driver, "head").mockImplementationOnce(async (key) => {
      await disable(v.id);
      return realHead(key);
    });

    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
        meta: { durationMs: 1000, width: 10, height: 20 },
      }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(await rowOf(v.id)).toMatchObject({
      status: "disabled",
      originalStatus: "uploading",
      originalUploadId: upload.uploadId,
      durationMs: null,
      width: null,
      height: null,
    });
    expect(await pathExists(objectPath(upload.key))).toBe(false);

    // Abort, still allowed on a disabled video, lets go of it.
    expect(await abortUpload(c.actor, { videoId: v.id })).toEqual({ ok: true });
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_ORIGINAL,
      status: "disabled",
    });
    expect(await listFiles(objectPath(`originals/${c.creatorId}`))).toEqual([]);
  });
});

describe("a resume that finds its parts gone", () => {
  it("answers the failure a parallel complete just stored (422 bad_signature_bytes), not upload_expired", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    const upload = await startOriginal(me.actor, v.id, TWO_PARTS);
    await sendParts(me.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: new Uint8Array(TWO_PARTS),
    });
    const driver = localDriver();
    const realListParts = driver.listParts;
    let completed: Awaited<ReturnType<typeof completeUpload>> | undefined;
    // The resume read the row while it was uploading; the complete fails the zero-filled file before the resume lists.
    vi.spyOn(driver, "listParts").mockImplementationOnce(async (i) => {
      completed = await completeUpload(me.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      });
      return realListParts(i);
    });

    await expectJson(
      await callUploadRoute(
        "start",
        originalStart(v.id, TWO_PARTS, { resume: true }),
      ),
      422,
      { code: "bad_signature_bytes" },
    );
    expect(completed).toEqual({ ok: false, code: "bad_signature_bytes" });
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "failed",
      originalError: "bad_signature_bytes",
      originalObjectKey: null,
    });
  });

  it("still answers 410 upload_expired when a new start replaced the upload, and leaves the new one open", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    await startOriginal(me.actor, v.id, TWO_PARTS);
    const driver = localDriver();
    const realListParts = driver.listParts;
    let next: Awaited<ReturnType<typeof startOriginal>> | undefined;
    vi.spyOn(driver, "listParts").mockImplementationOnce(async (i) => {
      next = await startOriginal(me.actor, v.id, TWO_PARTS);
      return realListParts(i);
    });

    await expectJson(
      await callUploadRoute(
        "start",
        originalStart(v.id, TWO_PARTS, { resume: true }),
      ),
      410,
      { code: "upload_expired" },
    );
    if (!next) throw new Error("the new start didn't run");
    expect(await rowOf(v.id)).toMatchObject({
      originalStatus: "uploading",
      originalObjectKey: next.key,
      originalUploadId: next.uploadId,
      originalError: null,
    });
    expect(await pathExists(uploadDirPath(next.uploadId))).toBe(true);
  });
});

describe("a complete that died after assembling, before its database write", () => {
  /** An original (3 parts by default) whose parts the driver assembled, with the row still 'uploading' (the complete crashed). */
  async function crashedAfterAssembly(
    c: { actor: Actor },
    videoId: string,
    size = TOTAL,
  ) {
    const bytes = bytesOf(size);
    const upload = await startOriginal(c.actor, videoId, size);
    await sendParts(c.actor, { videoId, uploadId: upload.uploadId, bytes });
    await assembleOnly(upload);
    expect(await pathExists(objectPath(upload.key))).toBe(true);
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
    expect(await rowOf(videoId)).toMatchObject({
      originalStatus: "uploading",
      originalUploadId: upload.uploadId,
    });
    return { upload, bytes };
  }

  it("resume reports every part done on the same upload; complete then ends ready", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const { upload, bytes } = await crashedAfterAssembly(c, v.id);
    const open = await rowOf(v.id);

    expect(
      await presignUpload(
        c.actor,
        originalStart(v.id, TOTAL, { resume: true }),
      ),
    ).toEqual({
      ok: true,
      upload: {
        mode: "multipart",
        key: upload.key,
        uploadId: upload.uploadId,
        partSize: PART_BYTES,
        partCount: 3,
        doneParts: [1, 2, 3],
      },
    });
    expect(await rowOf(v.id)).toEqual(open);
    expect(await pathExists(objectPath(upload.key))).toBe(true);

    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      }),
    ).toEqual({ ok: true });
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "ready",
      originalObjectKey: upload.key,
      originalBytes: TOTAL,
    });
    expect((await readFile(objectPath(upload.key))).equals(bytes)).toBe(true);
  });

  it("abort answers 204, empties the row and leaves no object at the key", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    const { upload } = await crashedAfterAssembly(me, v.id, SMALL);

    const response = await callUploadRoute("abort", { videoId: v.id });
    expect(response.status).toBe(204);
    expect(await rowOf(v.id)).toMatchObject(NO_ORIGINAL);
    expect(await pathExists(objectPath(upload.key))).toBe(false);
    expect(await listFiles(objectPath(`originals/${me.creatorId}`))).toEqual(
      [],
    );
  });

  it("a resume 25 h later answers 410 upload_expired and leaves no object at the key", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    const { upload } = await crashedAfterAssembly(me, v.id, SMALL);
    await startedHoursAgo(v.id, 25);

    await expectJson(
      await callUploadRoute(
        "start",
        originalStart(v.id, SMALL, { resume: true }),
      ),
      410,
      { code: "upload_expired" },
    );
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "failed",
      originalError: "upload_expired",
      originalObjectKey: null,
    });
    expect(await pathExists(objectPath(upload.key))).toBe(false);
    expect(await listFiles(objectPath(`originals/${me.creatorId}`))).toEqual(
      [],
    );
  });
});

describe("resume and expiry (07 D80)", () => {
  it("resumes the open upload with the parts already stored; another size or type is not_same_file", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const bytes = bytesOf(TOTAL);
    const upload = await startOriginal(c.actor, v.id, TOTAL);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes,
      partNumbers: [1, 2],
    });
    const resume = (overrides: Parameters<typeof originalStart>[2] = {}) =>
      presignUpload(
        c.actor,
        originalStart(v.id, TOTAL, { resume: true, ...overrides }),
      );

    expect(await resume()).toEqual({
      ok: true,
      upload: {
        mode: "multipart",
        key: upload.key,
        uploadId: upload.uploadId,
        partSize: PART_BYTES,
        partCount: 3,
        doneParts: [1, 2],
      },
    });
    const open = await rowOf(v.id);
    expect(await resume({ size: TOTAL - 1 })).toEqual({
      ok: false,
      code: "not_same_file",
    });
    expect(await resume({ contentType: "video/quicktime" })).toEqual({
      ok: false,
      code: "not_same_file",
    });
    expect(await rowOf(v.id)).toEqual(open);

    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes,
      partNumbers: [3],
    });
    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      }),
    ).toEqual({ ok: true });
    expect((await readFile(objectPath(upload.key))).equals(bytes)).toBe(true);
  });

  it("has nothing to resume on a video without an open upload (upload_expired)", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    expect(
      await presignUpload(
        c.actor,
        originalStart(v.id, SMALL, { resume: true }),
      ),
    ).toEqual({ ok: false, code: "upload_expired" });
    expect(await rowOf(v.id)).toMatchObject(NO_ORIGINAL);
  });

  it("expires an upload started 25 h ago on resume: failed / upload_expired, upload columns cleared, parts gone", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const upload = await startOriginal(c.actor, v.id, SMALL);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: bytesOf(SMALL),
    });
    await startedHoursAgo(v.id, 25);

    expect(
      await presignUpload(
        c.actor,
        originalStart(v.id, SMALL, { resume: true }),
      ),
    ).toEqual({ ok: false, code: "upload_expired" });
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "failed",
      originalError: "upload_expired",
      originalObjectKey: null,
    });
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
    // Complete on the expired row says so too.
    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      }),
    ).toEqual({ ok: false, code: "upload_expired" });
  });

  it("expires an upload started 25 h ago on complete, even with every part stored", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const upload = await startOriginal(c.actor, v.id, SMALL);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: bytesOf(SMALL),
    });
    await startedHoursAgo(v.id, 25);

    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      }),
    ).toEqual({ ok: false, code: "upload_expired" });
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_UPLOAD,
      originalStatus: "failed",
      originalError: "upload_expired",
      originalObjectKey: null,
    });
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
    expect(await pathExists(objectPath(upload.key))).toBe(false);
  });

  it("expires an upload whose parts are gone from storage, on resume and on complete", async () => {
    const c = await newCreator(disk);
    for (const call of ["resume", "complete"] as const) {
      const v = await newVideo(c.creatorId);
      const upload = await startOriginal(c.actor, v.id, SMALL);
      await rm(uploadDirPath(upload.uploadId), { recursive: true });
      const result =
        call === "resume"
          ? await presignUpload(
              c.actor,
              originalStart(v.id, SMALL, { resume: true }),
            )
          : await completeUpload(c.actor, {
              kind: "original",
              videoId: v.id,
              uploadId: upload.uploadId,
            });
      expect(result, call).toEqual({ ok: false, code: "upload_expired" });
      expect(await rowOf(v.id), call).toMatchObject({
        ...NO_UPLOAD,
        originalStatus: "failed",
        originalError: "upload_expired",
      });
    }
  });
});

describe("abortUpload", () => {
  it("answers 204, empties the row and removes the upload directory; a second abort is a no-op", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    const upload = await startOriginal(me.actor, v.id, TWO_PARTS);
    await sendParts(me.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: bytesOf(TWO_PARTS),
      partNumbers: [1],
    });

    for (const round of [1, 2]) {
      const response = await callUploadRoute("abort", { videoId: v.id });
      expect(response.status, `abort ${round}`).toBe(204);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("");
      expect(await rowOf(v.id)).toMatchObject(NO_ORIGINAL);
      expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
    }
    expect(await pathExists(objectPath(upload.key))).toBe(false);
  });

  it("named (owner answer Q-50): ends that upload, and leaves a newer one a later start opened in its place", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    const old = await startOriginal(me.actor, v.id, TWO_PARTS);
    const newer = await startOriginal(me.actor, v.id, TWO_PARTS);
    await sendParts(me.actor, {
      videoId: v.id,
      uploadId: newer.uploadId,
      bytes: bytesOf(TWO_PARTS),
      partNumbers: [1],
    });
    const open = await rowOf(v.id);

    const late = await callUploadRoute("abort", {
      videoId: v.id,
      uploadId: old.uploadId,
    });
    expect(late.status).toBe(204);
    expect(await rowOf(v.id)).toEqual(open);
    expect(open).toMatchObject({
      originalStatus: "uploading",
      originalUploadId: newer.uploadId,
    });
    expect(await pathExists(uploadDirPath(newer.uploadId))).toBe(true);

    const named = await callUploadRoute("abort", {
      videoId: v.id,
      uploadId: newer.uploadId,
    });
    expect(named.status).toBe(204);
    expect(await rowOf(v.id)).toMatchObject(NO_ORIGINAL);
    expect(await pathExists(uploadDirPath(newer.uploadId))).toBe(false);
  });

  it("answers 400 invalid to an empty or overlong upload id", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    await startOriginal(me.actor, v.id, SMALL);
    const open = await rowOf(v.id);

    for (const uploadId of ["", "u".repeat(1025)]) {
      await expectJson(
        await callUploadRoute("abort", { videoId: v.id, uploadId }),
        400,
        { code: "invalid" },
      );
    }
    expect(await rowOf(v.id)).toEqual(open);
  });

  it("never touches a ready original", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const { upload } = await uploadOriginal(c.actor, v.id, bytesOf(SMALL));
    const ready = await rowOf(v.id);

    expect(await abortUpload(c.actor, { videoId: v.id })).toEqual({ ok: true });
    expect(await rowOf(v.id)).toEqual(ready);
    expect(ready).toMatchObject({
      originalStatus: "ready",
      originalObjectKey: upload.key,
    });
    expect(await pathExists(objectPath(upload.key))).toBe(true);
  });

  it("still works on a disabled video (Q-38 a)", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const upload = await startOriginal(c.actor, v.id, SMALL);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: bytesOf(SMALL),
    });
    await disable(v.id);

    expect(await abortUpload(c.actor, { videoId: v.id })).toEqual({ ok: true });
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_ORIGINAL,
      status: "disabled",
    });
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
  });
});

describe("the original lock (07 D09, Q-39 a)", () => {
  type Setup = (creatorId: string) => Promise<Video>;
  const unpublishedWith =
    (request: Parameters<typeof insertLicenseRequest>[1]): Setup =>
    async (creatorId) => {
      const v = await newVideo(creatorId, { status: "unpublished" });
      await insertLicenseRequest(v, request);
      return v;
    };

  const LOCKED: [string, Setup][] = [
    [
      "a published video",
      async (creatorId) => publishVideo(await newVideo(creatorId)),
    ],
    [
      "an unpublished video with a checkout_pending request",
      unpublishedWith({}),
    ],
    [
      "an unpublished video with an expired checkout_pending request",
      unpublishedWith({ checkoutExpiresAt: new Date(Date.now() - HOUR_MS) }),
    ],
    [
      "an unpublished video with an awaiting_approval request",
      unpublishedWith({ status: "awaiting_approval" }),
    ],
    [
      "a draft with an awaiting_approval request",
      async (creatorId) => {
        const v = await newVideo(creatorId);
        await insertLicenseRequest(v, { status: "awaiting_approval" });
        return v;
      },
    ],
    [
      "an unpublished video with a license",
      async (creatorId) => {
        const v = await newVideo(creatorId, { status: "unpublished" });
        await insertLicense(
          await insertLicenseRequest(v, { status: "approved" }),
        );
        return v;
      },
    ],
    [
      "a disabled video",
      async (creatorId) => newVideo(creatorId, { ...DISABLED }),
    ],
  ];

  it.each(LOCKED)("is original_locked for %s", async (_, setup) => {
    const c = await newCreator(disk);
    const v = await setup(c.creatorId);
    const before = await rowOf(v.id);

    expect(await isOriginalLocked(v.id)).toBe(true);
    for (const resume of [false, true]) {
      expect(
        await presignUpload(c.actor, originalStart(v.id, SMALL, { resume })),
      ).toEqual({ ok: false, code: "original_locked" });
    }
    expect(await rowOf(v.id)).toEqual(before);
    expect(await uploadsUnder(`originals/${c.creatorId}/${v.id}/`)).toEqual([]);
  });

  const ALLOWED: [string, Setup][] = [
    [
      "an unpublished video with no request",
      (creatorId) => newVideo(creatorId, { status: "unpublished" }),
    ],
    [
      "an unpublished video whose requests are all closed",
      async (creatorId) => {
        const v = await newVideo(creatorId, { status: "unpublished" });
        for (const status of ["declined", "expired", "abandoned"] as const) {
          await insertLicenseRequest(v, { status });
        }
        return v;
      },
    ],
    ["a draft with no request", (creatorId) => newVideo(creatorId)],
  ];

  it.each(ALLOWED)("allows a new original for %s", async (_, setup) => {
    const c = await newCreator(disk);
    const v = await setup(c.creatorId);

    expect(await isOriginalLocked(v.id)).toBe(false);
    const upload = await startOriginal(c.actor, v.id, SMALL);
    expect(upload.key).toMatch(originalKeyOf(c.creatorId, v.id));
    expect((await rowOf(v.id)).originalStatus).toBe("uploading");
  });
});

describe("presignUpload (original): the lock read again under the row lock (07 D09)", () => {
  /** The next createMultipart runs for real, then a buyer opens a checkout on `v` before the start's transaction. */
  function checkoutDuringStart(v: Video) {
    const driver = localDriver();
    const realCreate = driver.createMultipart;
    return vi
      .spyOn(driver, "createMultipart")
      .mockImplementationOnce(async (i) => {
        const created = await realCreate(i);
        await insertLicenseRequest(v);
        return created;
      });
  }

  it("answers original_locked and aborts the new multipart upload", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId, { status: "unpublished" });
    const before = await rowOf(v.id);
    const created = checkoutDuringStart(v);

    expect(await presignUpload(c.actor, originalStart(v.id, SMALL))).toEqual({
      ok: false,
      code: "original_locked",
    });
    expect(created).toHaveBeenCalledTimes(1);
    expect(await rowOf(v.id)).toEqual(before);
    expect(await uploadsUnder(`originals/${c.creatorId}/${v.id}/`)).toEqual([]);
    expect(await listFiles(objectPath(`originals/${c.creatorId}`))).toEqual([]);
  });

  it("keeps an open first upload when the second start is locked", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const first = await startOriginal(c.actor, v.id, TWO_PARTS);
    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: first.uploadId,
      bytes: bytesOf(TWO_PARTS),
      partNumbers: [1],
    });
    const open = await rowOf(v.id);
    checkoutDuringStart(v);

    expect(await presignUpload(c.actor, originalStart(v.id, SMALL))).toEqual({
      ok: false,
      code: "original_locked",
    });
    expect(await rowOf(v.id)).toEqual(open);
    expect(await uploadsUnder(`originals/${c.creatorId}/${v.id}/`)).toEqual([
      first.uploadId,
    ]);
    expect(
      (await listFiles(uploadDirPath(first.uploadId))).filter((f) =>
        f.endsWith(".part"),
      ),
    ).toEqual(["1.part"]);
  });
});

describe("presignUpload (original): a new start", () => {
  it("deletes a ready draft original's previous object and drops an open upload's parts", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const first = await uploadOriginal(c.actor, v.id, bytesOf(SMALL));
    expect(first.result).toEqual({ ok: true });
    expect(await pathExists(objectPath(first.upload.key))).toBe(true);

    const second = await startOriginal(c.actor, v.id, TWO_PARTS, {
      fileName: "second.mov",
      contentType: "video/quicktime",
    });
    expect(second.key).toMatch(originalKeyOf(c.creatorId, v.id, "mov"));
    expect(await pathExists(objectPath(first.upload.key))).toBe(false);
    expect(await rowOf(v.id)).toMatchObject({
      originalStatus: "uploading",
      originalObjectKey: second.key,
      originalUploadId: second.uploadId,
      originalBytes: TWO_PARTS,
      originalMime: "video/quicktime",
      originalFilename: "second.mov",
      durationMs: null,
    });

    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: second.uploadId,
      bytes: bytesOf(TWO_PARTS),
      partNumbers: [1],
    });
    const third = await startOriginal(c.actor, v.id, SMALL);
    expect(await pathExists(uploadDirPath(second.uploadId))).toBe(false);
    expect((await rowOf(v.id)).originalUploadId).toBe(third.uploadId);

    await sendParts(c.actor, {
      videoId: v.id,
      uploadId: third.uploadId,
      bytes: bytesOf(SMALL),
    });
    expect(
      await completeUpload(c.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: third.uploadId,
      }),
    ).toEqual({ ok: true });
    expect(await listFiles(objectPath(`originals/${c.creatorId}`))).toEqual([
      `${v.id}/${basename(third.key)}`,
    ]);
  });
});

describe("presignUpload (original): a start whose transaction throws", () => {
  it("aborts the new multipart upload and leaves the row as it was", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const before = await rowOf(v.id);
    const driver = localDriver();
    const realCreate = driver.createMultipart;
    let created: string | undefined;
    vi.spyOn(driver, "createMultipart").mockImplementationOnce(async (i) => {
      const upload = await realCreate(i);
      created = upload.uploadId;
      return upload;
    });
    vi.spyOn(db, "transaction").mockRejectedValueOnce(
      new Error("connection reset"),
    );

    await expect(
      presignUpload(c.actor, originalStart(v.id, SMALL)),
    ).rejects.toThrow("connection reset");
    if (!created) throw new Error("no multipart upload was created");
    expect(await pathExists(uploadDirPath(created))).toBe(false);
    expect(await rowOf(v.id)).toEqual(before);
    expect(await uploadsUnder(`originals/${c.creatorId}/${v.id}/`)).toEqual([]);
  });
});

describe("presignUpload: the type and size checks behind the route's Zod", () => {
  /** An input the route's schema would refuse, for the domain's own checks. */
  const unchecked = (input: Record<string, unknown>) =>
    input as unknown as StartUploadInput;

  it("answers bad_type and too_large for an original or a poster, and opens or signs nothing", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const before = await rowOf(v.id);
    const poster = {
      kind: "poster",
      videoId: v.id,
      size: 1000,
      contentType: "image/jpeg",
      posterOrigin: "frame_capture",
    };
    const created = vi.spyOn(localDriver(), "createMultipart");
    const signed = vi.spyOn(localDriver(), "presignPut");

    for (const [input, code] of [
      [
        { ...originalStart(v.id, SMALL), contentType: "video/x-msvideo" },
        "bad_type",
      ],
      [originalStart(v.id, ORIGINAL_MAX_BYTES + 1), "too_large"],
      [originalStart(v.id, 0), "too_large"],
      [{ ...poster, contentType: "image/png" }, "bad_type"],
      [{ ...poster, size: POSTER_MAX_BYTES + 1 }, "too_large"],
      [{ ...poster, size: 0 }, "too_large"],
    ] as const) {
      expect(
        await presignUpload(c.actor, unchecked(input)),
        JSON.stringify(input),
      ).toEqual({ ok: false, code });
    }
    expect(created).not.toHaveBeenCalled();
    expect(signed).not.toHaveBeenCalled();
    expect(await rowOf(v.id)).toEqual(before);
  });
});

describe("presignParts", () => {
  it("refuses another upload id, part 0, a part beyond partCount, 21 numbers and a disabled video", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    const upload = await startOriginal(me.actor, v.id, TOTAL);
    const parts = (uploadId: string, partNumbers: number[]) =>
      callUploadRoute("parts", { videoId: v.id, uploadId, partNumbers });
    const many = Array.from({ length: PART_URL_BATCH + 1 }, () => 1);

    await expectJson(await parts(randomUUID(), [1]), 404, {
      code: "not_found",
    });
    for (const numbers of [[0], [4], [1, 2, 4], [-1]]) {
      await expectJson(await parts(upload.uploadId, numbers), 400, {
        code: "bad_part",
      });
    }
    await expectJson(await parts(upload.uploadId, many), 400, {
      code: "too_many",
    });
    const call = (partNumbers: number[]) =>
      presignParts(me.actor, {
        videoId: v.id,
        uploadId: upload.uploadId,
        partNumbers,
      });
    expect(await call([0])).toEqual({ ok: false, code: "bad_part" });
    expect(await call([4])).toEqual({ ok: false, code: "bad_part" });
    expect(await call(many)).toEqual({ ok: false, code: "too_many" });

    const ok = await parts(upload.uploadId, [1, 2, 3]);
    expect(ok.status).toBe(200);

    await disable(v.id);
    await expectJson(await parts(upload.uploadId, [1]), 404, {
      code: "not_found",
    });
    await expectJson(
      await callUploadRoute("complete", {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      }),
      404,
      { code: "not_found" },
    );
    expect((await rowOf(v.id)).originalStatus).toBe("uploading");
  });

  it("answers upload_expired for its open upload once the 24 h window is over, and changes nothing (07 D80)", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const upload = await startOriginal(c.actor, v.id, TOTAL);
    await startedHoursAgo(v.id, 25);
    const open = await rowOf(v.id);
    const call = (uploadId: string) =>
      presignParts(c.actor, { videoId: v.id, uploadId, partNumbers: [1] });

    expect(await call(upload.uploadId)).toEqual({
      ok: false,
      code: "upload_expired",
    });
    // Any other upload id is still not_found.
    expect(await call(randomUUID())).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(await rowOf(v.id)).toEqual(open);
  });

  it("refuses a video whose original isn't uploading", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const { upload } = await uploadOriginal(c.actor, v.id, bytesOf(SMALL));
    expect(
      await presignParts(c.actor, {
        videoId: v.id,
        uploadId: upload.uploadId,
        partNumbers: [1],
      }),
    ).toEqual({ ok: false, code: "not_found" });
  });
});

describe("another creator's video", () => {
  it("is not_found on start, parts, complete and abort, and the owner's upload goes on", async () => {
    const owner = await newCreator(disk);
    const other = await newCreator(disk);
    const v = await newVideo(owner.creatorId);
    const upload = await startOriginal(owner.actor, v.id, SMALL);
    await sendParts(owner.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      bytes: bytesOf(SMALL),
    });
    const open = await rowOf(v.id);
    const notFound = { ok: false, code: "not_found" };

    expect(
      await presignUpload(other.actor, originalStart(v.id, SMALL)),
    ).toEqual(notFound);
    expect(
      await presignUpload(
        other.actor,
        originalStart(v.id, SMALL, { resume: true }),
      ),
    ).toEqual(notFound);
    expect(
      await presignUpload(other.actor, {
        kind: "poster",
        videoId: v.id,
        size: 100,
        contentType: "image/jpeg",
        posterOrigin: "frame_capture",
      }),
    ).toEqual(notFound);
    expect(
      await presignParts(other.actor, {
        videoId: v.id,
        uploadId: upload.uploadId,
        partNumbers: [1],
      }),
    ).toEqual(notFound);
    expect(
      await completeUpload(other.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      }),
    ).toEqual(notFound);
    expect(await abortUpload(other.actor, { videoId: v.id })).toEqual(notFound);

    expect(await rowOf(v.id)).toEqual(open);
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(true);
    expect(
      await completeUpload(owner.actor, {
        kind: "original",
        videoId: v.id,
        uploadId: upload.uploadId,
      }),
    ).toEqual({ ok: true });
  });
});

describe("posters (Q-34 a, Q-36 a)", () => {
  it("start → signed PUT → complete sets the key and origin; again is ok; a new poster replaces and deletes the old one", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const jpeg = await fixture("poster.jpg");

    const start = await presignUpload(c.actor, {
      kind: "poster",
      videoId: v.id,
      size: jpeg.length,
      contentType: "image/jpeg",
      posterOrigin: "frame_capture",
    });
    expect(start).toEqual({
      ok: true,
      upload: {
        mode: "single",
        key: expect.stringMatching(posterKeyOf(v.id)),
        url: expect.any(String),
        headers: { "Content-Type": "image/jpeg" },
        uploadToken: expect.stringMatching(/^v1\./),
      },
    });
    if (!start.ok || start.upload.mode !== "single") throw new Error("start");
    const first = start.upload;
    const url = new URL(first.url);
    expect(url.origin).toBe(env.APP_URL);
    expect(url.pathname).toBe(`/api/dev/storage/${first.key}`);
    expect(url.searchParams.get("ct")).toBe("image/jpeg");
    expect(url.searchParams.get("len")).toBe(String(jpeg.length));
    // Nothing changes on the row until complete.
    expect((await rowOf(v.id)).posterObjectKey).toBeNull();

    expect((await putSigned(first.url, jpeg, first.headers)).status).toBe(200);
    expect((await readFile(objectPath(first.key))).equals(jpeg)).toBe(true);
    const completeFirst = () =>
      completeUpload(c.actor, {
        kind: "poster",
        videoId: v.id,
        uploadToken: first.uploadToken,
      });
    expect(await completeFirst()).toEqual({ ok: true });
    expect(await rowOf(v.id)).toMatchObject({
      posterObjectKey: first.key,
      posterOrigin: "frame_capture",
    });
    expect(await completeFirst()).toEqual({ ok: true });
    expect((await rowOf(v.id)).posterObjectKey).toBe(first.key);

    const second = await uploadPoster(c.actor, v.id, jpeg, "creator_image");
    expect(second.result).toEqual({ ok: true });
    expect(await rowOf(v.id)).toMatchObject({
      posterObjectKey: second.upload.key,
      posterOrigin: "creator_image",
    });
    expect(await listFiles(objectPath(`posters/${v.id}`))).toEqual([
      basename(second.upload.key),
    ]);
  });

  it("refuses a PNG or a JPEG-sized file without the JPEG bytes (bad_signature_bytes) and deletes it; the poster stays", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const jpeg = await fixture("poster.jpg");
    const current = await uploadPoster(c.actor, v.id, jpeg);
    expect(current.result).toEqual({ ok: true });

    for (const bytes of [pngBytes(4096), new Uint8Array(jpeg.length)]) {
      const bad = await uploadPoster(c.actor, v.id, bytes, "creator_image");
      expect(bad.result).toEqual({ ok: false, code: "bad_signature_bytes" });
      expect(await pathExists(objectPath(bad.upload.key))).toBe(false);
    }
    expect(await rowOf(v.id)).toMatchObject({
      posterObjectKey: current.upload.key,
      posterOrigin: "frame_capture",
    });
    expect(await listFiles(objectPath(`posters/${v.id}`))).toEqual([
      basename(current.upload.key),
    ]);
  });

  it("refuses a tampered, expired or other video's upload token (not_found)", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const otherVideo = await newVideo(c.creatorId);
    const jpeg = await fixture("poster.jpg");
    const upload = await startPoster(c.actor, v.id, jpeg.length);
    expect((await putSigned(upload.url, jpeg, upload.headers)).status).toBe(
      200,
    );
    const elsewhere = await startPoster(c.actor, otherVideo.id, jpeg.length);
    expect(
      (await putSigned(elsewhere.url, jpeg, elsewhere.headers)).status,
    ).toBe(200);

    const [, body = "", sig = ""] = upload.uploadToken.split(".");
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as PosterTokenPayload;
    const reencoded = (p: object) =>
      Buffer.from(JSON.stringify(p)).toString("base64url");
    const subkey = deriveSubkey("poster-upload");
    const nowS = Math.floor(Date.now() / 1000);
    const flipped = sig[0] === "A" ? "B" : "A";

    const tokens: [string, string, string][] = [
      ["a changed signature", v.id, `v1.${body}.${flipped}${sig.slice(1)}`],
      [
        "a changed payload",
        v.id,
        `v1.${reencoded({ ...payload, posterOrigin: "creator_image" })}.${sig}`,
      ],
      ["garbage", v.id, "not-a-token"],
      [
        "an expired token",
        v.id,
        signPosterToken(subkey, { ...payload, exp: nowS - 1 }),
      ],
      ["another video's token", v.id, elsewhere.uploadToken],
      ["this token for another video", otherVideo.id, upload.uploadToken],
      [
        "a token whose key is under another video",
        v.id,
        signPosterToken(subkey, { ...payload, key: elsewhere.key }),
      ],
    ];
    for (const [label, videoId, uploadToken] of tokens) {
      expect(
        await completeUpload(c.actor, { kind: "poster", videoId, uploadToken }),
        label,
      ).toEqual({ ok: false, code: "not_found" });
    }
    expect((await rowOf(v.id)).posterObjectKey).toBeNull();
    expect((await rowOf(otherVideo.id)).posterObjectKey).toBeNull();

    expect(
      await completeUpload(c.actor, {
        kind: "poster",
        videoId: v.id,
        uploadToken: upload.uploadToken,
      }),
    ).toEqual({ ok: true });
    expect((await rowOf(v.id)).posterObjectKey).toBe(upload.key);
  });

  it("refuses a PUT with another Content-Type (403) or length (413 / 400), and a second PUT to the URL (412)", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const jpeg = await fixture("poster.jpg");
    const upload = await startPoster(c.actor, v.id, jpeg.length);
    const longer = new Uint8Array(jpeg.length + 1);
    longer.set(jpeg);

    expect(
      (await putSigned(upload.url, jpeg, { "Content-Type": "image/png" }))
        .status,
    ).toBe(403);
    expect((await putSigned(upload.url, jpeg)).status).toBe(403);
    expect((await putSigned(upload.url, longer, upload.headers)).status).toBe(
      413,
    );
    expect(
      (await putSigned(upload.url, jpeg.subarray(1), upload.headers)).status,
    ).toBe(400);
    expect(await listFiles(objectPath(`posters/${v.id}`))).toEqual([]);

    expect((await putSigned(upload.url, jpeg, upload.headers)).status).toBe(
      200,
    );
    expect((await putSigned(upload.url, jpeg, upload.headers)).status).toBe(
      412,
    );
    const other = pngBytes(jpeg.length);
    expect((await putSigned(upload.url, other, upload.headers)).status).toBe(
      412,
    );
    expect((await readFile(objectPath(upload.key))).equals(jpeg)).toBe(true);
    expect(await listFiles(objectPath(`posters/${v.id}`))).toEqual([
      basename(upload.key),
    ]);
  });

  it("can change on a published video but not on a disabled one", async () => {
    const c = await newCreator(disk);
    const live = await publishVideo(await newVideo(c.creatorId));
    const jpeg = await fixture("poster.jpg");
    const replaced = await uploadPoster(c.actor, live.id, jpeg);
    expect(replaced.result).toEqual({ ok: true });
    expect((await rowOf(live.id)).posterObjectKey).toBe(replaced.upload.key);

    // Q-38 a: a complete before the PUT, or after the video is disabled, changes nothing.
    const next = await startPoster(c.actor, live.id, jpeg.length);
    const completeNext = () =>
      completeUpload(c.actor, {
        kind: "poster",
        videoId: live.id,
        uploadToken: next.uploadToken,
      });
    expect(await completeNext()).toEqual({ ok: false, code: "not_found" });
    expect((await rowOf(live.id)).posterObjectKey).toBe(replaced.upload.key);
    expect((await putSigned(next.url, jpeg, next.headers)).status).toBe(200);
    await disable(live.id);
    expect(await completeNext()).toEqual({ ok: false, code: "not_found" });
    expect(await rowOf(live.id)).toMatchObject({
      status: "disabled",
      posterObjectKey: replaced.upload.key,
      posterOrigin: "frame_capture",
    });
    // The refused PUT's object goes; a retried complete of the live poster is refused too and never deletes it.
    expect(await pathExists(objectPath(next.key))).toBe(false);
    expect(
      await completeUpload(c.actor, {
        kind: "poster",
        videoId: live.id,
        uploadToken: replaced.upload.uploadToken,
      }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(await listFiles(objectPath(`posters/${live.id}`))).toEqual([
      basename(replaced.upload.key),
    ]);

    const off = await newVideo(c.creatorId, { ...DISABLED });
    expect(
      await presignUpload(c.actor, {
        kind: "poster",
        videoId: off.id,
        size: jpeg.length,
        contentType: "image/jpeg",
        posterOrigin: "frame_capture",
      }),
    ).toEqual({ ok: false, code: "not_found" });
  });
});

describe("posters no row points at", () => {
  it("changes nothing on a video disabled while its poster is checked, and deletes the PUT's object (Q-38 a)", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const jpeg = await fixture("poster.jpg");
    const current = await uploadPoster(c.actor, v.id, jpeg);
    expect(current.result).toEqual({ ok: true });
    const next = await startPoster(c.actor, v.id, jpeg.length);
    expect((await putSigned(next.url, jpeg, next.headers)).status).toBe(200);
    const driver = localDriver();
    const realHead = driver.head;
    vi.spyOn(driver, "head").mockImplementationOnce(async (key) => {
      await disable(v.id);
      return realHead(key);
    });

    expect(
      await completeUpload(c.actor, {
        kind: "poster",
        videoId: v.id,
        uploadToken: next.uploadToken,
      }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(await rowOf(v.id)).toMatchObject({
      status: "disabled",
      posterObjectKey: current.upload.key,
      posterOrigin: "frame_capture",
    });
    expect(await listFiles(objectPath(`posters/${v.id}`))).toEqual([
      basename(current.upload.key),
    ]);
  });

  it("deletes the PUT's object when a valid token's video is gone", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const jpeg = await fixture("poster.jpg");
    const upload = await startPoster(c.actor, v.id, jpeg.length);
    expect((await putSigned(upload.url, jpeg, upload.headers)).status).toBe(
      200,
    );
    await db.delete(video).where(eq(video.id, v.id));

    expect(
      await completeUpload(c.actor, {
        kind: "poster",
        videoId: v.id,
        uploadToken: upload.uploadToken,
      }),
    ).toEqual({ ok: false, code: "not_found" });
    expect(await pathExists(objectPath(upload.key))).toBe(false);
  });

  it("sweeps strays older than a token's lifetime at each poster start, never the live poster", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const jpeg = await fixture("poster.jpg");
    const live = await uploadPoster(c.actor, v.id, jpeg);
    expect(live.result).toEqual({ ok: true });
    /** A poster PUT whose complete never came. */
    const stray = async () => {
      const upload = await startPoster(c.actor, v.id, jpeg.length);
      expect((await putSigned(upload.url, jpeg, upload.headers)).status).toBe(
        200,
      );
      return upload.key;
    };
    const age = (key: string, hours: number) => {
      const at = new Date(Date.now() - hours * HOUR_MS);
      return utimes(objectPath(key), at, at);
    };
    const old = await stray();
    const fresh = await stray();
    // Past the token's 1 h 15 min and the hour after it; the live poster is older still and stays.
    await age(old, 3);
    await age(live.upload.key, 5);

    const next = await startPoster(c.actor, v.id, jpeg.length);
    expect(await pathExists(objectPath(old))).toBe(false);
    expect(await listFiles(objectPath(`posters/${v.id}`))).toEqual(
      [basename(live.upload.key), basename(fresh)].sort(),
    );

    // A swap deletes the old live poster as replaced; the next start sweeps the now-aged stray, never the new live one.
    expect((await putSigned(next.url, jpeg, next.headers)).status).toBe(200);
    expect(
      await completeUpload(c.actor, {
        kind: "poster",
        videoId: v.id,
        uploadToken: next.uploadToken,
      }),
    ).toEqual({ ok: true });
    expect((await rowOf(v.id)).posterObjectKey).toBe(next.key);
    expect(await listFiles(objectPath(`posters/${v.id}`))).toEqual(
      [basename(next.key), basename(fresh)].sort(),
    );
    await age(fresh, 3);
    await age(next.key, 5);
    await startPoster(c.actor, v.id, jpeg.length);
    expect(await listFiles(objectPath(`posters/${v.id}`))).toEqual([
      basename(next.key),
    ]);
  });
});

describe("the dev storage route (07 D51, D80)", () => {
  /** A request to `url` as the route receives it, for handleDevStorage. */
  const requestTo = (url: string, method: "PUT" | "GET", body?: Bytes) =>
    new NextRequest(url, {
      method,
      body,
      headers: { "Content-Type": "image/jpeg" },
    });
  const withParam = (url: string, name: string, value: string) => {
    const changed = new URL(url);
    changed.searchParams.set(name, value);
    return changed.href;
  };

  it("answers 403 to unsigned, tampered or expired object, part and download URLs", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const jpeg = await fixture("poster.jpg");
    const posterPut = await startPoster(c.actor, v.id, jpeg.length);
    const original = await startOriginal(c.actor, v.id, SMALL);
    const signed = await presignParts(c.actor, {
      videoId: v.id,
      uploadId: original.uploadId,
      partNumbers: [1],
    });
    if (!signed.ok) throw new Error(signed.code);
    const partUrl = signed.urls[1] ?? "";
    const download = await presignDownload({
      key: posterPut.key,
      filename: "poster.jpg",
      disposition: "inline",
    });
    const base = `${env.APP_URL}/api/dev/storage/originals/${c.creatorId}/${v.id}/x.mp4`;

    const forbidden: [string, string, "PUT" | "GET"][] = [
      ["an unsigned object PUT", base, "PUT"],
      ["an unsigned GET", base, "GET"],
      [
        "an unsigned part PUT",
        `${base}?uploadId=${original.uploadId}&partNumber=1`,
        "PUT",
      ],
      [
        "a part URL with another part number",
        withParam(partUrl, "partNumber", "2"),
        "PUT",
      ],
      [
        "a part URL with another upload id",
        withParam(partUrl, "uploadId", randomUUID()),
        "PUT",
      ],
      [
        "a part URL with a later exp",
        withParam(
          partUrl,
          "exp",
          String(Number(new URL(partUrl).searchParams.get("exp")) + 60),
        ),
        "PUT",
      ],
      [
        "an object URL with another length",
        withParam(posterPut.url, "len", String(jpeg.length + 1)),
        "PUT",
      ],
      [
        "an object URL with another type",
        withParam(posterPut.url, "ct", "image/png"),
        "PUT",
      ],
      [
        "a part URL used for another key",
        partUrl.replace(original.key, `${original.key}.mp4`),
        "PUT",
      ],
      [
        "a download URL with another disposition",
        withParam(download, "cd", "attachment"),
        "GET",
      ],
      ["a download URL used to PUT", download, "PUT"],
      ["a poster URL used to GET", posterPut.url, "GET"],
    ];
    for (const [label, url, method] of forbidden) {
      const response =
        method === "PUT" ? await putSigned(url, jpeg) : await getSigned(url);
      expect(response.status, label).toBe(403);
    }

    // Each signed URL works now and is refused once its exp has passed.
    const expired: [string, string, "PUT" | "GET"][] = [
      ["the object URL", posterPut.url, "PUT"],
      ["the part URL", partUrl, "PUT"],
      ["the download URL", download, "GET"],
    ];
    for (const [label, url, method] of expired) {
      const exp = Number(new URL(url).searchParams.get("exp"));
      const late = await handleDevStorage(
        env,
        requestTo(url, method, method === "PUT" ? jpeg : undefined),
        devStorageSegments(url),
        exp + 1,
      );
      expect(late.status, label).toBe(403);
    }
    expect((await putSigned(partUrl, partOf(bytesOf(SMALL), 1))).status).toBe(
      200,
    );
    expect(await listFiles(objectPath(`posters/${v.id}`))).toEqual([]);
  });

  it("answers 404 with APP_ENV=production or preview, or STORAGE_DRIVER=r2, even to a valid signed URL", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const jpeg = await fixture("poster.jpg");
    const upload = await startPoster(c.actor, v.id, jpeg.length);

    for (const e of [
      { APP_ENV: "production", STORAGE_DRIVER: "local" },
      { APP_ENV: "preview", STORAGE_DRIVER: "local" },
      { APP_ENV: "test", STORAGE_DRIVER: "r2" },
      { APP_ENV: "development", STORAGE_DRIVER: "r2" },
    ] as const) {
      for (const method of ["PUT", "GET"] as const) {
        const response = await handleDevStorage(
          e,
          requestTo(upload.url, method, method === "PUT" ? jpeg : undefined),
          devStorageSegments(upload.url),
        );
        expect(response.status, `${e.APP_ENV}/${e.STORAGE_DRIVER}`).toBe(404);
      }
    }
    expect(await pathExists(objectPath(upload.key))).toBe(false);
  });

  it("streams a signed download with its Content-Disposition and no-store; a missing object is 404", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const jpeg = await fixture("poster.jpg");
    const { upload } = await uploadPoster(c.actor, v.id, jpeg);
    const filename = 'Café "clip".jpg';

    const response = await getSigned(
      await presignDownload({
        key: upload.key,
        filename,
        disposition: "attachment",
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      contentDisposition("attachment", filename),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-length")).toBe(String(jpeg.length));
    expect(Buffer.from(await response.arrayBuffer()).equals(jpeg)).toBe(true);

    const missing = await getSigned(
      await presignDownload({
        key: `posters/${v.id}/${randomUUID()}.jpg`,
        filename,
        disposition: "inline",
      }),
    );
    expect(missing.status).toBe(404);
  });

  it("answers 404 to a part PUT for an unknown or ended upload, and 413 to a part over PART_BYTES", async () => {
    const c = await newCreator(disk);
    const v = await newVideo(c.creatorId);
    const bytes = bytesOf(TOTAL);
    const unknown = await localDriver().presignPart({
      key: `originals/${c.creatorId}/${v.id}/${randomUUID()}.mp4`,
      uploadId: randomUUID(),
      partNumber: 1,
      expiresIn: 60,
    });
    expect((await putSigned(unknown, partOf(bytes, 1))).status).toBe(404);

    const upload = await startOriginal(c.actor, v.id, TOTAL);
    const signed = await presignParts(c.actor, {
      videoId: v.id,
      uploadId: upload.uploadId,
      partNumbers: [1],
    });
    if (!signed.ok) throw new Error(signed.code);
    const url = signed.urls[1] ?? "";
    expect(
      (await putSigned(url, bytes.subarray(0, PART_BYTES + 1))).status,
    ).toBe(413);
    expect(await listFiles(uploadDirPath(upload.uploadId))).toEqual([
      "manifest.json",
    ]);

    expect(await abortUpload(c.actor, { videoId: v.id })).toEqual({ ok: true });
    expect((await putSigned(url, partOf(bytes, 1))).status).toBe(404);
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
  });
});

describe("the four upload routes", () => {
  it("answer 401 JSON, uncached, when signed out", async () => {
    for (const name of UPLOAD_ROUTE_NAMES) {
      const response = await callUploadRoute(name, {});
      expect(response.status, name).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: { code: "unauthorized" },
      });
    }
  });

  it("answer 400 invalid to a body that isn't JSON, and to a client-chosen key", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    const valid = {
      start: originalStart(v.id, SMALL),
      parts: { videoId: v.id, uploadId: randomUUID(), partNumbers: [1] },
      complete: { kind: "original", videoId: v.id, uploadId: randomUUID() },
      abort: { videoId: v.id },
    };
    for (const name of UPLOAD_ROUTE_NAMES) {
      const json = JSON.stringify(valid[name]);
      for (const type of [
        "text/plain",
        "application/x-www-form-urlencoded",
        "multipart/form-data; boundary=x",
      ]) {
        await expectJson(await callUploadRoute(name, json, type), 400, {
          code: "invalid",
        });
      }
      await expectJson(await callUploadRoute(name, "{not json"), 400, {
        code: "invalid",
      });
      await expectJson(
        await callUploadRoute(name, { ...valid[name], key: "originals/x" }),
        400,
        { code: "invalid" },
      );
    }
    expect(await rowOf(v.id)).toMatchObject(NO_ORIGINAL);
  });

  it("answer 404 for another creator's video on all four", async () => {
    const owner = await newCreator(disk);
    const v = await newVideo(owner.creatorId);
    const upload = await startOriginal(owner.actor, v.id, SMALL);
    const open = await rowOf(v.id);
    await signedIn(disk);

    for (const [name, body] of [
      ["start", originalStart(v.id, SMALL)],
      ["parts", { videoId: v.id, uploadId: upload.uploadId, partNumbers: [1] }],
      [
        "complete",
        { kind: "original", videoId: v.id, uploadId: upload.uploadId },
      ],
      ["abort", { videoId: v.id }],
      ["abort", { videoId: v.id, uploadId: upload.uploadId }],
    ] as const) {
      await expectJson(await callUploadRoute(name, body), 404, {
        code: "not_found",
      });
    }
    expect(await rowOf(v.id)).toEqual(open);
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(true);
  });

  it("answer 409 original_locked and not_same_file, 410 upload_expired and 422 parts_incomplete", async () => {
    const me = await signedIn(disk);
    const live = await publishVideo(await newVideo(me.creatorId));
    await expectJson(
      await callUploadRoute("start", originalStart(live.id, SMALL)),
      409,
      { code: "original_locked" },
    );

    const v = await newVideo(me.creatorId);
    const open = await startOriginal(me.actor, v.id, TWO_PARTS);
    await expectJson(
      await callUploadRoute(
        "start",
        originalStart(v.id, TWO_PARTS + 1, { resume: true }),
      ),
      409,
      { code: "not_same_file" },
    );
    await expectJson(
      await callUploadRoute("complete", {
        kind: "original",
        videoId: v.id,
        uploadId: open.uploadId,
      }),
      422,
      { code: "parts_incomplete" },
    );
    await startedHoursAgo(v.id, 25);
    await expectJson(
      await callUploadRoute("parts", {
        videoId: v.id,
        uploadId: open.uploadId,
        partNumbers: [1],
      }),
      410,
      { code: "upload_expired" },
    );
    await expectJson(
      await callUploadRoute(
        "start",
        originalStart(v.id, TWO_PARTS, { resume: true }),
      ),
      410,
      { code: "upload_expired" },
    );
  });

  it("answer 400 bad_type and too_large on start (only an oversized size is too_large), and open or sign nothing", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    const poster = {
      kind: "poster",
      videoId: v.id,
      size: 1000,
      contentType: "image/jpeg",
      posterOrigin: "frame_capture",
    };
    const created = vi.spyOn(localDriver(), "createMultipart");
    const signed = vi.spyOn(localDriver(), "presignPut");

    for (const [body, code] of [
      [
        { ...originalStart(v.id, SMALL), contentType: "video/x-msvideo" },
        "bad_type",
      ],
      [originalStart(v.id, ORIGINAL_MAX_BYTES + 1), "too_large"],
      [originalStart(v.id, 0), "invalid"],
      [{ ...poster, contentType: "image/png" }, "bad_type"],
      [{ ...poster, size: POSTER_MAX_BYTES + 1 }, "too_large"],
      [{ ...poster, size: 0 }, "invalid"],
    ] as const) {
      await expectJson(await callUploadRoute("start", body), 400, { code });
    }
    expect(created).not.toHaveBeenCalled();
    expect(signed).not.toHaveBeenCalled();
    expect(await rowOf(v.id)).toMatchObject({
      ...NO_ORIGINAL,
      posterObjectKey: null,
    });
    expect(await uploadsUnder(`originals/${me.creatorId}/${v.id}/`)).toEqual(
      [],
    );
  });

  it("answer 400 invalid to a body over 16 KiB, by its Content-Length or as it is read", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    // Each body is valid but for its size: start would open an upload, abort answer 204, parts and complete 404.
    const valid = {
      start: originalStart(v.id, SMALL),
      parts: { videoId: v.id, uploadId: randomUUID(), partNumbers: [1] },
      complete: { kind: "original", videoId: v.id, uploadId: randomUUID() },
      abort: { videoId: v.id },
    };
    const CAP = 16 * 1024;
    for (const name of UPLOAD_ROUTE_NAMES) {
      const json = JSON.stringify(valid[name]);
      // JSON allows the leading whitespace.
      await expectJson(
        await callUploadRoute(
          name,
          `${" ".repeat(CAP + 1 - json.length)}${json}`,
        ),
        400,
        { code: "invalid" },
      );
      await expectJson(
        await callUploadRoute(name, json, undefined, {
          "content-length": String(CAP + 1),
        }),
        400,
        { code: "invalid" },
      );
    }
    expect(await rowOf(v.id)).toMatchObject(NO_ORIGINAL);
    expect(await uploadsUnder(`originals/${me.creatorId}/${v.id}/`)).toEqual(
      [],
    );

    // Exactly the cap is read.
    const abort = JSON.stringify(valid.abort);
    const atCap = await callUploadRoute(
      "abort",
      `${" ".repeat(CAP - abort.length)}${abort}`,
    );
    expect(atCap.status).toBe(204);
  });

  it("answer 500 internal when the domain call throws, and log the error class only", async () => {
    const me = await signedIn(disk);
    const v = await newVideo(me.creatorId);
    const upload = await startOriginal(me.actor, v.id, SMALL);
    const secret = `originals/${me.creatorId}/${v.id}/leaked-key.mp4`;
    vi.spyOn(localDriver(), "listParts").mockRejectedValueOnce(
      new Error(`ENOENT: no such file or directory, open '${secret}'`),
    );
    const logged = captureLogEvents("uploads.route_failed");

    const response = await callUploadRoute("complete", {
      kind: "original",
      videoId: v.id,
      uploadId: upload.uploadId,
    });
    const { written, events } = logged();
    await expectJson(response, 500, { code: "internal" });
    expect(events).toEqual([
      {
        ts: expect.any(String),
        level: "error",
        event: "uploads.route_failed",
        error: "Error",
      },
    ]);
    expect(written).not.toContain(secret);
    expect(written).not.toContain(upload.key);
    expect(written).not.toContain(upload.uploadId);
    expect((await rowOf(v.id)).originalStatus).toBe("uploading");
  });
});
