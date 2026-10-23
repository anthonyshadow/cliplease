import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createVideoFromUpload as createVideoAction } from "../../src/app/(dashboard)/dashboard/videos/new/actions";
import { db } from "../../src/db/client";
import { auditEvent, video } from "../../src/db/schema";
import { videoStepHref } from "../../src/lib/videos/steps";
import type { Actor } from "../../src/server/auth/actor";
import {
  createVideoFromUpload,
  VideoInputError,
} from "../../src/server/videos/create";
import {
  getVideoForCreator,
  getVideoStepFacts,
} from "../../src/server/videos/queries";
import { formOf, redirectTo } from "../helpers/actions";
import { mockNextHeaders, signedInCreator } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { insertLicenseRequest, videoRow } from "../helpers/factories";
import { libraryDraft, videosOf } from "../helpers/library-videos";
import {
  fixture,
  newCreator,
  newDraft,
  objectPath,
  originalKeyOf,
  pathExists,
  posterKeyOf,
  uploadOriginal as sendOriginal,
  startOriginal,
  trackTestStorage,
  UUID,
  uploadDirPath,
  uploadPoster,
} from "../helpers/uploads";

// The plain upload's first step (P10b; 02 §5.10, §6.1; 07 D20, D23, D39): createVideoFromUpload and its action, the
// per-creator slug, getVideoForCreator's DTO, and a real file and poster through P10a's upload helpers. Owner answers
// Q-40 a (title copy) and Q-43 a (titles tidied).
vi.mock("next/headers", () => import("../helpers/next-headers"));

const disk = trackTestStorage();

afterAll(async () => {
  await disk.clean();
  await resetDb();
});
beforeEach(() => mockNextHeaders(null));

const slugsOf = async (creatorId: string) =>
  (await videosOf(creatorId)).map((v) => v.slug).sort();

const auditsBy = (userId: string) =>
  db
    .select({
      actorType: auditEvent.actorType,
      actorUserId: auditEvent.actorUserId,
      action: auditEvent.action,
      entityType: auditEvent.entityType,
      entityId: auditEvent.entityId,
      data: auditEvent.data,
    })
    .from(auditEvent)
    .where(eq(auditEvent.actorUserId, userId));

/** The owner's poster URL's `?v=`: the first 8 hex of sha256(key). */
const posterV = (key: string) =>
  createHash("sha256").update(key).digest("hex").slice(0, 8);

describe("createVideoFromUpload (the domain function)", () => {
  it("writes a self-attested draft with the tidied title, its slug and no file, plus one audit row without the title", async () => {
    const c = await newCreator(disk);
    const { videoId } = await createVideoFromUpload(c.actor, {
      title: "  Beach\tday\n at   dusk ",
    });

    expect(videoId).toMatch(UUID);
    expect(await videoRow(videoId)).toMatchObject({
      id: videoId,
      creatorId: c.creatorId,
      slug: "beach-day-at-dusk",
      title: "Beach day at dusk",
      source: "upload",
      ownership: "self_attested",
      status: "draft",
      originalStatus: "none",
      originalObjectKey: null,
      originalUploadId: null,
      originalBytes: null,
      originalMime: null,
      originalFilename: null,
      posterObjectKey: null,
      posterOrigin: null,
      rightsAttestedAt: null,
    });
    expect(await auditsBy(c.userId)).toEqual([
      {
        actorType: "creator",
        actorUserId: c.userId,
        action: "video.created",
        entityType: "video",
        entityId: videoId,
        data: {},
      },
    ]);
  });

  it("numbers a creator's repeated title -2, -3; another creator gets the bare slug", async () => {
    const c = await newCreator(disk);
    for (let n = 0; n < 3; n++) await newDraft(disk, c, "Sunset Run");
    expect(await slugsOf(c.creatorId)).toEqual([
      "sunset-run",
      "sunset-run-2",
      "sunset-run-3",
    ]);

    const other = await newCreator(disk);
    await newDraft(disk, other, "Sunset Run");
    expect(await slugsOf(other.creatorId)).toEqual(["sunset-run"]);
  });

  it("gives three parallel creates of one title the slugs base, -2 and -3 (a slug lost to a parallel insert is picked again)", async () => {
    const c = await newCreator(disk);
    const created = await Promise.all(
      [1, 2, 3].map(() =>
        createVideoFromUpload(c.actor, { title: "Lake Swim" }),
      ),
    );

    expect(new Set(created.map((r) => r.videoId)).size).toBe(3);
    expect(await slugsOf(c.creatorId)).toEqual([
      "lake-swim",
      "lake-swim-2",
      "lake-swim-3",
    ]);
    expect(await auditsBy(c.userId)).toHaveLength(3);
  });

  it("cuts a 60-character slug at a hyphen to make room for the suffix", async () => {
    const c = await newCreator(disk);
    const title =
      "Golden hour surf session at Tofino with friends, one big wave";
    for (let n = 0; n < 3; n++) await newDraft(disk, c, title);

    const slugs = await slugsOf(c.creatorId);
    expect(slugs).toEqual([
      "golden-hour-surf-session-at-tofino-with-friends-one-big-2",
      "golden-hour-surf-session-at-tofino-with-friends-one-big-3",
      "golden-hour-surf-session-at-tofino-with-friends-one-big-wave",
    ]);
    expect(slugs[2]).toHaveLength(60);
  });

  it("refuses an empty, blank or 101-character title (VideoInputError) and writes nothing", async () => {
    const c = await newCreator(disk);
    for (const title of ["", "   ", "a".repeat(101)]) {
      await expect(
        createVideoFromUpload(c.actor, { title }),
      ).rejects.toBeInstanceOf(VideoInputError);
    }
    expect(await videosOf(c.creatorId)).toEqual([]);
    expect(await auditsBy(c.userId)).toEqual([]);
  });
});

describe("the title page's action (S18's Continue)", () => {
  it("sends a signed-out visitor to sign-in with next", async () => {
    await expect(
      createVideoAction(null, formOf({ title: "Beach day" })),
    ).rejects.toMatchObject(
      redirectTo("/sign-in?next=%2Fdashboard%2Fvideos%2Fnew"),
    );
  });

  it("creates the draft and goes to its File step", async () => {
    const me = await signedInCreator();
    const thrown = await createVideoAction(
      null,
      formOf({ title: "Beach day" }),
    ).catch((error: unknown) => error);

    const [row] = await videosOf(me.creatorId);
    expect(row).toMatchObject({ title: "Beach day", slug: "beach-day" });
    expect(thrown).toMatchObject(redirectTo(videoStepHref(row.id, "file")));
  });

  it.each([
    ["a 101-character title", "a".repeat(101), "Keep it to 100 characters."],
    ["an empty title", "", "Add a title."],
    ["a blank title", " \n\t ", "Add a title."],
    ["a title of direction marks only", "\u202e\u200f", "Add a title."],
  ])(
    "refuses %s with the field's message and writes nothing",
    async (_, title, message) => {
      const me = await signedInCreator();
      expect(await createVideoAction(null, formOf({ title }))).toEqual({
        ok: false,
        error: { code: "invalid_input", message, fields: { title: [message] } },
      });
      expect(await videosOf(me.creatorId)).toEqual([]);
      expect(await auditsBy(me.userId)).toEqual([]);
    },
  );

  it("stores a title with a line break and a right-to-left override tidied (Q-43 a)", async () => {
    const me = await signedInCreator();
    await expect(
      createVideoAction(null, formOf({ title: "Beach\nday \u202eat dusk" })),
    ).rejects.toMatchObject({ digest: expect.stringContaining("?step=file") });

    const [row] = await videosOf(me.creatorId);
    expect(row).toMatchObject({
      title: "Beach day at dusk",
      slug: "beach-day-at-dusk",
    });
  });
});

describe("getVideoForCreator", () => {
  const DTO_KEYS = [
    "durationMs",
    "hasVerifiedPosting",
    "height",
    "id",
    "originalError",
    "originalFilename",
    "originalLocked",
    "originalStatus",
    "posterOrigin",
    "posterSrc",
    "postingsConfirmedAt",
    "rightsAnswered",
    "sameVideoConfirmed",
    "source",
    "sourcePost",
    "status",
    "title",
    "width",
  ];

  it("gives the owner a fresh draft's DTO: no poster, not locked, rights not answered", async () => {
    const c = await newCreator(disk);
    const id = await newDraft(disk, c);

    expect(await getVideoForCreator(c.actor, id)).toStrictEqual({
      id,
      title: "Beach day",
      status: "draft",
      originalStatus: "none",
      originalError: null,
      originalFilename: null,
      durationMs: null,
      width: null,
      height: null,
      posterSrc: null,
      posterOrigin: null,
      originalLocked: false,
      rightsAnswered: false,
      source: "upload",
      postingsConfirmedAt: null,
      sameVideoConfirmed: false,
      hasVerifiedPosting: false,
      sourcePost: null,
    });
  });

  it("never names the object keys, the upload id or the creator; the poster URL carries a hash of its key", async () => {
    const c = await newCreator(disk);
    const id = await newDraft(disk, c);
    const original = await startOriginal(c.actor, id, 1024 ** 2);
    const { upload: poster } = await uploadPoster(
      c.actor,
      id,
      await fixture("poster.jpg"),
    );

    const dto = await getVideoForCreator(c.actor, id);
    expect(Object.keys(dto ?? {}).sort()).toEqual(DTO_KEYS);
    expect(dto).toMatchObject({
      originalStatus: "uploading",
      posterOrigin: "frame_capture",
      posterSrc: `/api/media/posters/${id}?v=${posterV(poster.key)}`,
    });
    const json = JSON.stringify(dto);
    for (const hidden of [
      "posterObjectKey",
      "originalObjectKey",
      "originalUploadId",
      "creatorId",
      poster.key,
      original.key,
      original.uploadId,
      c.creatorId,
    ]) {
      expect(json).not.toContain(hidden);
    }
  });

  it("is null for another creator, a missing id and an id that isn't a uuid", async () => {
    const c = await newCreator(disk);
    const id = await newDraft(disk, c);
    const other = await newCreator(disk);

    expect(await getVideoForCreator(other.actor, id)).toBeNull();
    expect(await getVideoForCreator(c.actor, randomUUID())).toBeNull();
    for (const bad of ["not-a-uuid", "", `${id}x`]) {
      expect(await getVideoForCreator(c.actor, bad)).toBeNull();
    }
  });

  it("reports the original locked by an awaiting_approval request (07 D09)", async () => {
    const c = await newCreator(disk);
    const id = await newDraft(disk, c);
    await insertLicenseRequest(
      { id, creatorId: c.creatorId },
      { status: "awaiting_approval" },
    );

    expect(await getVideoForCreator(c.actor, id)).toMatchObject({
      status: "draft",
      originalLocked: true,
    });
  });

  it("reports rights answered once rights_attested_at is set", async () => {
    const c = await newCreator(disk);
    const id = await newDraft(disk, c);
    await db
      .update(video)
      .set({ rightsAttestedAt: new Date(), attestationVersion: "v1" })
      .where(eq(video.id, id));

    expect(await getVideoForCreator(c.actor, id)).toMatchObject({
      rightsAnswered: true,
    });
  });
});

describe("getVideoStepFacts (P11c: the composed Continue's uncached read)", () => {
  /** getVideoForCreator's DTO cut down to the step facts. */
  async function factsOfDto(actor: Actor, id: string) {
    const dto = await getVideoForCreator(actor, id);
    if (!dto) throw new Error("no video");
    return {
      status: dto.status,
      originalStatus: dto.originalStatus,
      source: dto.source,
      postingsConfirmedAt: dto.postingsConfirmedAt,
      sameVideoConfirmed: dto.sameVideoConfirmed,
      hasVerifiedPosting: dto.hasVerifiedPosting,
      rightsAnswered: dto.rightsAnswered,
    };
  }

  it("gives a fresh upload draft's facts, as the DTO gives them", async () => {
    const c = await newCreator(disk);
    const id = await newDraft(disk, c);

    const facts = await getVideoStepFacts(c.actor, id);
    expect(facts).toStrictEqual({
      status: "draft",
      originalStatus: "none",
      source: "upload",
      postingsConfirmedAt: null,
      sameVideoConfirmed: false,
      hasVerifiedPosting: false,
      rightsAnswered: false,
    });
    expect(facts).toStrictEqual(await factsOfDto(c.actor, id));
  });

  it("reads a Library draft's verified posting, confirmed postings, tick and rights as stored now", async () => {
    const c = await newCreator(disk);
    const draft = await libraryDraft(c);
    const at = new Date("2026-10-21T12:00:00.000Z");
    await db
      .update(video)
      .set({
        postingsConfirmedAt: at,
        sameVideoConfirmedAt: at,
        rightsAttestedAt: at,
        attestationVersion: "v1",
      })
      .where(eq(video.id, draft.id));

    const facts = await getVideoStepFacts(c.actor, draft.id);
    expect(facts).toStrictEqual({
      status: "draft",
      originalStatus: "ready",
      source: "library",
      postingsConfirmedAt: at.toISOString(),
      sameVideoConfirmed: true,
      hasVerifiedPosting: true,
      rightsAnswered: true,
    });
    expect(facts).toStrictEqual(await factsOfDto(c.actor, draft.id));
  });

  it("is null for another creator, a missing id and an id that isn't a uuid", async () => {
    const c = await newCreator(disk);
    const id = await newDraft(disk, c);
    const other = await newCreator(disk);

    expect(await getVideoStepFacts(other.actor, id)).toBeNull();
    expect(await getVideoStepFacts(c.actor, randomUUID())).toBeNull();
    for (const bad of ["not-a-uuid", "", `${id}x`]) {
      expect(await getVideoStepFacts(c.actor, bad)).toBeNull();
    }
  });
});

describe("a draft, its original and its poster, end to end", () => {
  it("stores sample.mp4 and poster.jpg under keys made of ids, and the owner sees them ready", async () => {
    const c = await newCreator(disk);
    const id = await newDraft(disk, c, "Sample clip");
    const mp4 = await fixture("sample.mp4");
    const jpeg = await fixture("poster.jpg");

    const sent = await sendOriginal(c.actor, id, mp4, {
      start: { fileName: "sample.mp4" },
    });
    expect(sent.result).toEqual({ ok: true });
    const withOriginal = await videoRow(id);
    expect(withOriginal).toMatchObject({
      originalStatus: "ready",
      originalUploadId: null,
      originalBytes: mp4.length,
      originalMime: "video/mp4",
      originalFilename: "sample.mp4",
    });
    const originalKey = withOriginal.originalObjectKey ?? "";
    expect(originalKey).toMatch(originalKeyOf(c.creatorId, id));
    expect((await readFile(objectPath(originalKey))).equals(mp4)).toBe(true);
    expect(await pathExists(uploadDirPath(sent.upload.uploadId))).toBe(false);

    const posted = await uploadPoster(c.actor, id, jpeg);
    expect(posted.result).toEqual({ ok: true });
    const row = await videoRow(id);
    const posterKey = row.posterObjectKey ?? "";
    expect(posterKey).toMatch(posterKeyOf(id));
    expect(row.posterOrigin).toBe("frame_capture");
    expect((await readFile(objectPath(posterKey))).equals(jpeg)).toBe(true);
    for (const key of [row.originalObjectKey, posterKey]) {
      expect(key).not.toContain("sample");
    }

    expect(await getVideoForCreator(c.actor, id)).toMatchObject({
      title: "Sample clip",
      originalStatus: "ready",
      originalFilename: "sample.mp4",
      posterSrc: `/api/media/posters/${id}?v=${posterV(posterKey)}`,
      posterOrigin: "frame_capture",
      originalLocked: false,
    });
  });
});
