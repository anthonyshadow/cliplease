import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteDraftVideo as deleteDraftAction,
  unpublishVideo as unpublishAction,
} from "../../src/app/(dashboard)/dashboard/videos/[id]/actions";
import { db } from "../../src/db/client";
import {
  licenseRequest,
  socialAccount,
  socialPost,
  video,
} from "../../src/db/schema";
import type { NewVideo } from "../../src/db/schema/types";
import { listVideoPostings } from "../../src/server/postings/queries";
import { saveVideoPostings } from "../../src/server/postings/save";
import { presignUpload } from "../../src/server/storage/uploads";
import {
  VideoNotDraftError,
  VideoNotFoundError,
} from "../../src/server/videos/errors";
import {
  deleteDraftVideo,
  unpublishVideo,
} from "../../src/server/videos/lifecycle";
import { posterResponse } from "../../src/server/videos/poster";
import {
  getPublishBlockers,
  publishVideo,
} from "../../src/server/videos/publish";
import {
  getRequestCounts,
  getVideoForCreator,
  listCreatorVideos,
} from "../../src/server/videos/queries";
import { NOT_FOUND, redirectTo } from "../helpers/actions";
import { mockNextHeaders } from "../helpers/auth";
import { auditsOf } from "../helpers/connect-flow";
import { waitForLockWaiter } from "../helpers/db";
import {
  completeSteps,
  insertLicense,
  insertLicenseRequest,
  insertRateCard,
  insertVideoPosting,
  publishVideo as publishedFactory,
  videoRow,
} from "../helpers/factories";
import { postingsOf, releasePosting } from "../helpers/postings";
import { readyLibraryVideo } from "../helpers/ready-videos";
import {
  bytesOf,
  fixture,
  newDraft,
  objectPath,
  originalStart,
  pathExists,
  SMALL,
  sendParts,
  signedIn,
  startOriginal,
  trackTestStorage,
  uploadDirPath,
  uploadOriginal,
  uploadPoster,
  uploadsUnder,
} from "../helpers/uploads";

// Turn off, Turn on and Delete draft (P14b; 02 §5.6, §6.1; 03 §5.2; 01 J5.19–J5.21; 07 D09, D45, D66, D72) against the
// test database and .data/storage: the transitions through the domain, what they leave alone (requests, published_at),
// what Off unlocks (Replace, Where posted) and hides (the public poster), what a deleted draft takes with it, and the
// video page's own read.
vi.mock("next/headers", () => import("../helpers/next-headers"));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

const disk = trackTestStorage();
afterAll(() => disk.clean());
beforeEach(() => {
  mockNextHeaders(null);
  vi.mocked(refresh).mockClear();
});

/** A signed-in creator with a rate card (Turn on reads it). */
async function owner() {
  const me = await signedIn(disk);
  await insertRateCard({ id: me.creatorId });
  return me;
}

type Creator = Awaited<ReturnType<typeof owner>>;

/** `me`'s draft with a stored original and poster (real keys, through the upload routes); returns their keys. */
async function draftWithFiles(me: Creator) {
  const id = await newDraft(disk, me);
  const { upload: original } = await uploadOriginal(
    me.actor,
    id,
    bytesOf(SMALL),
  );
  const { upload: poster } = await uploadPoster(
    me.actor,
    id,
    await fixture("poster.jpg"),
  );
  return { id, original: original.key, poster: poster.key };
}

/** draftWithFiles, every step done, live. */
async function liveVideo(me: Creator) {
  const { id, poster } = await draftWithFiles(me);
  const { originalObjectKey, originalBytes } = await videoRow(id);
  return publishedFactory(
    { id, creatorId: me.creatorId },
    { originalObjectKey, originalBytes, posterObjectKey: poster },
  );
}

/** An admin's Disable, by hand (P21 builds it). */
const disable = (id: string, extra: Partial<NewVideo> = {}) =>
  db
    .update(video)
    .set({ status: "disabled", disabledReason: "rights_claim", ...extra })
    .where(eq(video.id, id));

describe("unpublishVideo, then Turn on (01 J5.20)", () => {
  it("turns a live video off and on again, keeping published_at, with one video.unpublished row", async () => {
    const me = await owner();
    const live = await liveVideo(me);
    await unpublishVideo(me.actor, live.id);
    expect(await videoRow(live.id)).toMatchObject({
      status: "unpublished",
      publishedAt: live.publishedAt,
      slug: live.slug,
    });
    expect(await auditsOf(live.id, "video.unpublished")).toHaveLength(1);

    // Already off, a draft or a disabled video: nothing changes, no second row.
    await unpublishVideo(me.actor, live.id);
    expect(await auditsOf(live.id, "video.unpublished")).toHaveLength(1);

    expect(await publishVideo(me.actor, { videoId: live.id })).toEqual({
      ok: true,
      slug: live.slug,
    });
    expect(await videoRow(live.id)).toMatchObject({
      status: "published",
      publishedAt: live.publishedAt,
    });
  });

  it("leaves a request waiting for approval as it is", async () => {
    const me = await owner();
    const live = await liveVideo(me);
    const request = await insertLicenseRequest(live, {
      status: "awaiting_approval",
    });
    await unpublishVideo(me.actor, live.id);
    const [after] = await db
      .select()
      .from(licenseRequest)
      .where(eq(licenseRequest.id, request.id));
    expect(after).toEqual(request);
  });

  it("is a no-op on a draft and a disabled video, and another creator's video isn't found", async () => {
    const me = await owner();
    const draft = await newDraft(disk, me);
    await unpublishVideo(me.actor, draft);
    expect((await videoRow(draft)).status).toBe("draft");

    const disabled = await liveVideo(me);
    await disable(disabled.id);
    await unpublishVideo(me.actor, disabled.id);
    expect((await videoRow(disabled.id)).status).toBe("disabled");

    const them = await owner();
    await expect(unpublishVideo(them.actor, draft)).rejects.toBeInstanceOf(
      VideoNotFoundError,
    );
    await expect(
      unpublishVideo(them.actor, "not-a-uuid"),
    ).rejects.toBeInstanceOf(VideoNotFoundError);
  });

  it("hides the poster from everyone but the owner once off (07 D72)", async () => {
    const me = await owner();
    const live = await liveVideo(me);
    // Signed out: signedIn left the owner's session in the mocked headers.
    mockNextHeaders(null);
    expect((await posterResponse(live.id)).status).toBe(200);
    await unpublishVideo(me.actor, live.id);
    expect((await posterResponse(live.id)).status).toBe(404);
    mockNextHeaders(me.session);
    const own = await posterResponse(live.id);
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe("private, no-store");
  });

  it("lets the original be replaced and the postings saved only while off (07 D09, D69)", async () => {
    const me = await owner();
    const live = await liveVideo(me);
    const start = originalStart(live.id, SMALL);
    expect(await presignUpload(me.actor, start)).toEqual({
      ok: false,
      code: "original_locked",
    });
    const save = () =>
      saveVideoPostings(me.actor, {
        videoId: live.id,
        notPosted: true,
        postings: [],
      });
    await expect(save()).rejects.toMatchObject({ name: "PostingsLockedError" });

    await unpublishVideo(me.actor, live.id);
    await expect(save()).resolves.toMatchObject({ ok: true });
    const replaced = await presignUpload(me.actor, start);
    expect(replaced.ok).toBe(true);
  });

  it("keeps Replace locked while Off once a request or a license exists", async () => {
    const me = await owner();
    const live = await liveVideo(me);
    await unpublishVideo(me.actor, live.id);
    const request = await insertLicenseRequest(live, { status: "approved" });
    await insertLicense(request);
    expect(
      await presignUpload(me.actor, originalStart(live.id, SMALL)),
    ).toEqual({ ok: false, code: "original_locked" });
  });

  it("can't always be undone: Turn on runs every blocker again (07 D66)", async () => {
    const me = await owner();
    const library = await readyLibraryVideo(me.creatorId);
    await publishVideo(me.actor, { videoId: library.id });
    await unpublishVideo(me.actor, library.id);
    const [posting] = await postingsOf(library.id);
    await db
      .update(socialAccount)
      .set({ status: "needs_reconnect" })
      .where(eq(socialAccount.id, posting?.socialAccountId as string));
    expect(await publishVideo(me.actor, { videoId: library.id })).toEqual({
      ok: false,
      blockers: ["reconnect_account"],
    });
    expect((await videoRow(library.id)).status).toBe("unpublished");
  });
});

describe("deleteDraftVideo (01 J5.21; owner answer Q-103 a)", () => {
  it("deletes the draft, its postings and both stored objects, with one video.draft_deleted row", async () => {
    const me = await owner();
    const { id, original, poster } = await draftWithFiles(me);
    await insertVideoPosting(
      { id, creatorId: me.creatorId },
      {
        platform: "youtube",
        url: null,
        linkKey: null,
        unverifiedReason: "no_link",
      },
    );
    expect(await pathExists(objectPath(original))).toBe(true);
    expect(await pathExists(objectPath(poster))).toBe(true);

    await deleteDraftVideo(me.actor, id);
    expect(await db.select().from(video).where(eq(video.id, id))).toEqual([]);
    expect(await postingsOf(id)).toEqual([]);
    expect(await pathExists(objectPath(original))).toBe(false);
    expect(await pathExists(objectPath(poster))).toBe(false);
    const [audit] = await auditsOf(id, "video.draft_deleted");
    expect(audit?.data).toEqual({ postings: 1 });

    // A second call, and another creator's call, are fine and change nothing.
    await deleteDraftVideo(me.actor, id);
    expect(await auditsOf(id, "video.draft_deleted")).toHaveLength(1);
  });

  it("ends an open upload and sweeps the draft's folders", async () => {
    const me = await owner();
    const id = await newDraft(disk, me);
    const upload = await startOriginal(me.actor, id, 2 * SMALL);
    await sendParts(me.actor, {
      videoId: id,
      uploadId: upload.uploadId,
      bytes: bytesOf(2 * SMALL),
      partNumbers: [1],
    });
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(true);
    await deleteDraftVideo(me.actor, id);
    expect(await pathExists(uploadDirPath(upload.uploadId))).toBe(false);
    expect(await uploadsUnder(`originals/${me.creatorId}/${id}/`)).toEqual([]);
  });

  it("refuses a video past its draft and touches nothing; another creator's draft stays", async () => {
    const me = await owner();
    const live = await liveVideo(me);
    await expect(deleteDraftVideo(me.actor, live.id)).rejects.toBeInstanceOf(
      VideoNotDraftError,
    );
    expect(await pathExists(objectPath(live.originalObjectKey as string))).toBe(
      true,
    );
    expect(await pathExists(objectPath(live.posterObjectKey as string))).toBe(
      true,
    );

    // Another creator's draft, files and all, is out of reach: nothing is deleted or swept.
    const theirs = await draftWithFiles(await owner());
    await deleteDraftVideo(me.actor, theirs.id);
    expect((await videoRow(theirs.id)).status).toBe("draft");
    expect(await pathExists(objectPath(theirs.original))).toBe(true);
    expect(await pathExists(objectPath(theirs.poster))).toBe(true);
    expect(await auditsOf(theirs.id, "video.draft_deleted")).toEqual([]);
  });

  it("waits for a publish holding the row, then refuses, and the files stay (Q-103 a)", async () => {
    const me = await owner();
    const id = await newDraft(disk, me);
    const { upload } = await uploadPoster(
      me.actor,
      id,
      await fixture("poster.jpg"),
    );
    await completeSteps(
      { id, creatorId: me.creatorId },
      { posterObjectKey: upload.key },
    );
    let deleting: Promise<void> | undefined;
    await db.transaction(async (tx) => {
      await tx.select().from(video).where(eq(video.id, id)).for("update");
      deleting = deleteDraftVideo(me.actor, id);
      await waitForLockWaiter("%for update%");
      await tx
        .update(video)
        .set({ status: "published", publishedAt: new Date() })
        .where(eq(video.id, id));
    });
    await expect(deleting).rejects.toBeInstanceOf(VideoNotDraftError);
    expect((await videoRow(id)).status).toBe("published");
    expect(await pathExists(objectPath(upload.key))).toBe(true);
  });
});

describe("the Turn off and Delete draft actions (02 §6.1)", () => {
  it("unpublishVideo: off, then refresh(); a bad or foreign id is a 404", async () => {
    const me = await owner();
    const live = await liveVideo(me);
    expect(await unpublishAction({ videoId: live.id })).toEqual({
      ok: true,
      data: undefined,
    });
    expect((await videoRow(live.id)).status).toBe("unpublished");
    expect(refresh).toHaveBeenCalled();
    await expect(unpublishAction({ videoId: "nope" })).rejects.toMatchObject(
      NOT_FOUND,
    );
    await owner();
    await expect(unpublishAction({ videoId: live.id })).rejects.toMatchObject(
      NOT_FOUND,
    );
  });

  it("deleteDraftVideo: back to /dashboard/videos; a live video refuses with video_not_draft", async () => {
    const me = await owner();
    const draft = await newDraft(disk, me);
    await expect(deleteDraftAction({ videoId: draft })).rejects.toMatchObject(
      redirectTo("/dashboard/videos"),
    );
    expect(await db.select().from(video).where(eq(video.id, draft))).toEqual(
      [],
    );
    const live = await liveVideo(me);
    expect(await deleteDraftAction({ videoId: live.id })).toMatchObject({
      ok: false,
      error: { code: "video_not_draft" },
    });
    expect(refresh).toHaveBeenCalled();
  });
});

describe("the video page's reads (05 §6.7)", () => {
  it("counts waiting requests and licenses, and names a verified posting's removed post only", async () => {
    const me = await owner();
    const library = await readyLibraryVideo(me.creatorId);
    await insertLicenseRequest(library, { status: "awaiting_approval" });
    await insertLicense(
      await insertLicenseRequest(library, { status: "approved" }),
    );
    const [posting] = await postingsOf(library.id);
    const removedAt = new Date("2026-10-14T12:00:00Z");
    await db
      .update(socialPost)
      .set({ status: "removed", removedAt })
      .where(eq(socialPost.id, posting?.socialPostId as string));
    expect(await getRequestCounts(me.actor, library.id)).toEqual({
      pendingCount: 1,
      licenseCount: 1,
    });
    const removedOf = async () =>
      (await listVideoPostings(me.actor, library.id)).map((p) => p.removedAt);
    expect(await removedOf()).toEqual([removedAt.toISOString()]);
    // A released posting (an admin Disable, 07 D66) keeps its post but says nothing of it.
    if (posting) await releasePosting(posting);
    expect(await removedOf()).toEqual([null]);
    const them = await owner();
    expect(await getRequestCounts(them.actor, library.id)).toBeNull();
  });

  it("never reads the admin's note of a disabled video (07 D45)", async () => {
    const me = await owner();
    const live = await liveVideo(me);
    await disable(live.id, { disabledNote: "Complaint ticket 4711" });
    const reads = JSON.stringify([
      await getVideoForCreator(me.actor, live.id),
      await getPublishBlockers(me.actor, live.id),
      await getRequestCounts(me.actor, live.id),
      await listVideoPostings(me.actor, live.id),
      await listCreatorVideos(me.actor),
    ]);
    expect(reads).toContain("rights_claim");
    expect(reads).not.toContain("4711");
  });

  it("gives an Off card its link, and a disabled one none", async () => {
    const me = await owner();
    const off = await liveVideo(me);
    await unpublishVideo(me.actor, off.id);
    const disabled = await liveVideo(me);
    await disable(disabled.id);
    const { videos } = await listCreatorVideos(me.actor);
    const card = (id: string) => videos.find((v) => v.id === id);
    expect(card(off.id)?.shareUrl).toMatch(/\/@[a-z0-9_.-]+\//);
    expect(card(disabled.id)?.shareUrl).toBeNull();
  });
});
