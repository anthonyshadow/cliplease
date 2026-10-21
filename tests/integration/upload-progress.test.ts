import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { count } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/client";
import { auditEvent } from "../../src/db/schema";
import { planResume } from "../../src/lib/upload/resume";
import type { Actor } from "../../src/server/auth/actor";
import { localDriver } from "../../src/server/storage/index";
import { PART_BYTES } from "../../src/server/storage/limits";
import {
  abortUpload,
  completeUpload,
  getOriginalUploadProgress,
  presignParts,
} from "../../src/server/storage/uploads";
import { resetDb } from "../helpers/db";
import { captureLogEvents } from "../helpers/logs";
import {
  assembleOnly,
  bytesOf,
  MiB,
  newCreator,
  newDraft,
  objectPath,
  partOf,
  pathExists,
  putSigned,
  rowOf,
  SMALL,
  sendParts,
  startedHoursAgo,
  startOriginal,
  TOTAL,
  trackTestStorage,
  uploadDirPath,
  uploadOriginal,
} from "../helpers/uploads";

// getOriginalUploadProgress (P10c; 07 D80): the paused percent the File step shows after a reload, from the server's own
// part list on P10a's local driver. Owner-scoped and read-only: it never writes the row or the audit log, and it returns
// the upload id and byte counts only, never a key, an ETag or a part URL.
vi.mock("next/headers", () => import("../helpers/next-headers"));

const disk = trackTestStorage();

afterAll(async () => {
  await disk.clean();
  await resetDb();
});
afterEach(() => vi.restoreAllMocks());

const auditCount = async () => {
  const [row] = await db.select({ value: count() }).from(auditEvent);
  return row?.value;
};

/** The progress, checking that reading it changed neither the row nor the audit log. */
async function progressOf(actor: Actor, videoId: string) {
  const row = await rowOf(videoId);
  const audits = await auditCount();
  const progress = await getOriginalUploadProgress(actor, { videoId });
  expect(await rowOf(videoId)).toEqual(row);
  expect(await auditCount()).toBe(audits);
  return progress;
}

/** A creator's draft with a 40 MiB upload open and `partNumbers` stored. */
async function openUpload(partNumbers: number[]) {
  const c = await newCreator(disk);
  const videoId = await newDraft(disk, c);
  const bytes = bytesOf(TOTAL);
  const upload = await startOriginal(c.actor, videoId, TOTAL);
  await sendParts(c.actor, {
    videoId,
    uploadId: upload.uploadId,
    bytes,
    partNumbers,
  });
  return { c, videoId, bytes, upload };
}

describe("an open upload", () => {
  it("is resumable with the bytes of the stored parts: 2 of 3 parts of 40 MiB is 32 MiB", async () => {
    const { c, videoId, upload } = await openUpload([1, 2]);

    expect(await progressOf(c.actor, videoId)).toEqual({
      state: "resumable",
      uploadId: upload.uploadId,
      size: TOTAL,
      doneBytes: 32 * MiB,
    });
  });

  it("counts whole parts only, as a resume skips them: a short part is not done", async () => {
    const { c, videoId, bytes, upload } = await openUpload([1, 3]);
    const signed = await presignParts(c.actor, {
      videoId,
      uploadId: upload.uploadId,
      partNumbers: [2],
    });
    if (!signed.ok) throw new Error(signed.code);
    const short = partOf(bytes, 2).subarray(0, 8 * MiB);
    expect((await putSigned(signed.urls[2] ?? "", short)).status).toBe(200);

    const progress = await progressOf(c.actor, videoId);
    expect(progress).toEqual({
      state: "resumable",
      uploadId: upload.uploadId,
      size: TOTAL,
      doneBytes: 24 * MiB,
    });
    const resume = await startOriginal(c.actor, videoId, TOTAL, {
      resume: true,
    });
    expect(resume.doneParts).toEqual([1, 3]);
    expect(
      planResume({
        size: TOTAL,
        partSize: PART_BYTES,
        doneParts: resume.doneParts,
      }).doneBytes,
    ).toBe(24 * MiB);
  });

  it("is resumable at 0 bytes before any part arrives", async () => {
    const { c, videoId, upload } = await openUpload([]);
    expect(await progressOf(c.actor, videoId)).toEqual({
      state: "resumable",
      uploadId: upload.uploadId,
      size: TOTAL,
      doneBytes: 0,
    });
  });

  it("is resumable with every byte done once the parts were assembled but the row is still uploading", async () => {
    const { c, videoId, upload } = await openUpload([1, 2, 3]);
    await assembleOnly(upload);
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);

    expect(await progressOf(c.actor, videoId)).toEqual({
      state: "resumable",
      uploadId: upload.uploadId,
      size: TOTAL,
      doneBytes: TOTAL,
    });
    expect(await pathExists(objectPath(upload.key))).toBe(true);
  });
});

describe("an expired upload", () => {
  it("is expired 25 h after its start, and the row stays uploading", async () => {
    const { c, videoId } = await openUpload([]);
    await startedHoursAgo(videoId, 25);

    expect(await progressOf(c.actor, videoId)).toEqual({ state: "expired" });
    expect((await rowOf(videoId)).originalStatus).toBe("uploading");
  });

  it("is expired when its parts are gone and nothing is at the key", async () => {
    const { c, videoId, upload } = await openUpload([]);
    await rm(uploadDirPath(upload.uploadId), { recursive: true });

    expect(await progressOf(c.actor, videoId)).toEqual({ state: "expired" });
  });
});

describe("no progress (null)", () => {
  it("for another creator, while the owner still sees the upload", async () => {
    const { c, videoId, upload } = await openUpload([]);
    const other = await newCreator(disk);

    expect(await progressOf(other.actor, videoId)).toBeNull();
    expect(await progressOf(c.actor, videoId)).toMatchObject({
      state: "resumable",
      uploadId: upload.uploadId,
    });
  });

  it("after abortUpload", async () => {
    const { c, videoId } = await openUpload([]);
    expect(await abortUpload(c.actor, { videoId })).toEqual({ ok: true });

    expect(await progressOf(c.actor, videoId)).toBeNull();
  });

  it("for a 'none', a 'ready' and a 'failed' original", async () => {
    const c = await newCreator(disk);
    const none = await newDraft(disk, c);
    const ready = await newDraft(disk, c);
    await uploadOriginal(c.actor, ready, bytesOf(SMALL));
    const failed = await newDraft(disk, c);
    const { uploadId } = await startOriginal(c.actor, failed, SMALL);
    await startedHoursAgo(failed, 25);
    await completeUpload(c.actor, {
      kind: "original",
      videoId: failed,
      uploadId,
    });

    for (const [status, videoId] of [
      ["none", none],
      ["ready", ready],
      ["failed", failed],
    ] as const) {
      expect((await rowOf(videoId)).originalStatus, status).toBe(status);
      expect(await progressOf(c.actor, videoId), status).toBeNull();
    }
  });

  it("for a missing video or an id that isn't a uuid", async () => {
    const c = await newCreator(disk);
    expect(
      await getOriginalUploadProgress(c.actor, { videoId: randomUUID() }),
    ).toBeNull();
    expect(
      await getOriginalUploadProgress(c.actor, { videoId: "not-a-uuid" }),
    ).toBeNull();
  });

  it("on a storage error, logging the video id and the error class only", async () => {
    const { c, videoId, upload } = await openUpload([]);
    vi.spyOn(localDriver(), "listParts").mockRejectedValueOnce(
      new Error(`ENOENT: no such file or directory, open '${upload.key}'`),
    );
    const logged = captureLogEvents("uploads.progress_failed");

    const progress = await progressOf(c.actor, videoId);
    const { written, events } = logged();
    expect(progress).toBeNull();
    expect(events).toEqual([
      {
        ts: expect.any(String),
        level: "warn",
        event: "uploads.progress_failed",
        videoId,
        error: "Error",
      },
    ]);
    expect(written).not.toContain(upload.key);
    expect(written).not.toContain(upload.uploadId);
  });
});
