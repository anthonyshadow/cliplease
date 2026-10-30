import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publishVideo as publishVideoAction } from "../../src/app/(dashboard)/dashboard/videos/[id]/actions";
import { db } from "../../src/db/client";
import { creatorProfile, video } from "../../src/db/schema";
import { videoUrl } from "../../src/lib/urls";
import { REVIEW_COPY } from "../../src/lib/videos/review";
import { MUSIC_DISABLED_USES } from "../../src/lib/videos/rights";
import { env } from "../../src/server/env";
import { VideoNotFoundError } from "../../src/server/videos/errors";
import { listPublicVideos } from "../../src/server/videos/public";
import { publishVideo } from "../../src/server/videos/publish";
import { listCreatorVideos } from "../../src/server/videos/queries";
import { NOT_FOUND } from "../helpers/actions";
import { mockNextHeaders, signedInCreator } from "../helpers/auth";
import { auditsOf } from "../helpers/connect-flow";
import { expectDbError, PG_ERROR } from "../helpers/db";
import {
  insertCreator,
  insertLicense,
  insertLicenseRequest,
  insertRateCard,
  insertUploadVideo,
  insertVideoPosting,
  videoRow,
} from "../helpers/factories";
import { OBJECT_KEY } from "../helpers/object-key";
import {
  pricedCreator,
  readyLibraryVideo,
  readyUpload,
} from "../helpers/ready-videos";

// Publish (P14a; 02 §5.6, §6.1; 07 D66, D69, D74) against the test database: every blocker refuses and changes nothing,
// a ready video goes live with one `video.published` audit row naming each posting's platform, verification and link
// choice and nothing more, payouts never block, publishing again is a no-op; the action's link and refusals; and the
// two lists that show live videos, /dashboard/videos (listCreatorVideos) and /@handle (listPublicVideos).
vi.mock("next/headers", () => import("../helpers/next-headers"));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

beforeEach(() => {
  mockNextHeaders(null);
  vi.mocked(refresh).mockClear();
});

const published = (videoId: string) => auditsOf(videoId, "video.published");

describe("publishVideo (02 §5.6; 07 D69)", () => {
  it("makes a ready Library video live with one audit row: its Demo posting, verified, its link shown", async () => {
    const { creator, actor } = await pricedCreator();
    const ready = await readyLibraryVideo(creator.id);
    expect(creator.payoutsStatus).toBe("not_started");

    expect(await publishVideo(actor, { videoId: ready.id })).toEqual({
      ok: true,
      slug: ready.slug,
    });
    const row = await videoRow(ready.id);
    expect(row.status).toBe("published");
    expect(row.publishedAt).toBeInstanceOf(Date);
    expect(await published(ready.id)).toEqual([
      {
        actorType: "creator",
        data: {
          postings: [{ platform: "mock", verified: true, showLink: true }],
          copyVersion: "v1",
        },
      },
    ]);
  });

  it("audits an upload's unverified Facebook and Other postings as not verified, and a not-posted upload as none", async () => {
    const { creator, actor } = await pricedCreator();
    const posted = await readyUpload(creator.id);
    await insertVideoPosting(posted, {
      platform: "facebook",
      url: null,
      linkKey: null,
      unverifiedReason: "no_link",
      position: 0,
    });
    await insertVideoPosting(posted, {
      platform: "other",
      otherLabel: "Vimeo",
      url: "https://vimeo.com/123",
      linkKey: null,
      unverifiedReason: "unverifiable",
      showLink: false,
      position: 1,
    });
    await publishVideo(actor, { videoId: posted.id });
    expect((await published(posted.id))[0]?.data).toEqual({
      postings: [
        { platform: "facebook", verified: false, showLink: true },
        { platform: "other", verified: false, showLink: false },
      ],
      copyVersion: "v1",
    });

    const notPosted = await readyUpload(creator.id);
    await publishVideo(actor, { videoId: notPosted.id });
    expect((await published(notPosted.id))[0]?.data).toEqual({
      postings: [],
      copyVersion: "v1",
    });
  });

  it("is a no-op once live: the first published_at stays, no second audit row", async () => {
    const { creator, actor } = await pricedCreator();
    const ready = await readyUpload(creator.id);
    await publishVideo(actor, { videoId: ready.id });
    const first = (await videoRow(ready.id)).publishedAt;
    expect(await publishVideo(actor, { videoId: ready.id })).toEqual({
      ok: true,
      slug: ready.slug,
    });
    expect((await videoRow(ready.id)).publishedAt).toEqual(first);
    expect(await published(ready.id)).toHaveLength(1);
  });

  it("turns an unpublished video back on, keeping its published_at", async () => {
    const { creator, actor } = await pricedCreator();
    const before = new Date("2026-10-01T12:00:00.000Z");
    const off = await readyUpload(creator.id, {
      status: "unpublished",
      publishedAt: before,
    });
    expect(await publishVideo(actor, { videoId: off.id })).toMatchObject({
      ok: true,
    });
    expect(await videoRow(off.id)).toMatchObject({
      status: "published",
      publishedAt: before,
    });
  });

  it("refuses with each blocker and changes nothing", async () => {
    const { creator, actor } = await pricedCreator();
    const cases: [string, () => Promise<{ id: string }>][] = [
      [
        "postings_unconfirmed",
        () => readyUpload(creator.id, { postingsConfirmedAt: null }),
      ],
      [
        "poster_required",
        () =>
          readyUpload(creator.id, {
            posterObjectKey: null,
            posterOrigin: null,
          }),
      ],
      [
        "not_attested",
        () => readyUpload(creator.id, { rightsAttestedAt: null }),
      ],
      [
        "reconnect_account",
        () => readyLibraryVideo(creator.id, "needs_reconnect"),
      ],
      [
        "disabled_by_admin",
        () =>
          readyUpload(creator.id, {
            status: "disabled",
            disabledReason: "other",
          }),
      ],
      ["original_not_ready", () => insertUploadVideo(creator)],
    ];
    for (const [blocker, make] of cases) {
      const { id } = await make();
      const before = await videoRow(id);
      const result = await publishVideo(actor, { videoId: id });
      expect(result.ok).toBe(false);
      expect(result.ok ? [] : result.blockers).toContain(blocker);
      expect(await videoRow(id)).toEqual(before);
      expect(await published(id)).toEqual([]);
    }
  });

  it("refuses a video whose verified posting lost its same-video tick", async () => {
    const { creator, actor } = await pricedCreator();
    const ready = await readyLibraryVideo(creator.id);
    await db
      .update(video)
      .set({ sameVideoConfirmedAt: null })
      .where(eq(video.id, ready.id));
    expect(await publishVideo(actor, { videoId: ready.id })).toEqual({
      ok: false,
      blockers: ["same_video_unconfirmed"],
    });
  });

  it("refuses no_enabled_option when music turns off the only uses left on", async () => {
    const { creator, actor } = await pricedCreator(["organic_social"]);
    const ready = await readyUpload(creator.id, {
      containsMusic: true,
      disabledUses: ["paid_social", "broadcast"],
    });
    expect(await publishVideo(actor, { videoId: ready.id })).toEqual({
      ok: false,
      blockers: ["no_enabled_option"],
    });
  });

  it("is backed by the CHECK: postings_confirmed_at null can't be published directly", async () => {
    const { creator } = await pricedCreator();
    const unsaid = await readyUpload(creator.id, { postingsConfirmedAt: null });
    await expectDbError(
      db
        .update(video)
        .set({ status: "published", publishedAt: new Date() })
        .where(eq(video.id, unsaid.id)),
      { code: PG_ERROR.check, constraint: "video_published_requirements" },
    );
  });

  it("refuses another creator's video as not found", async () => {
    const { actor } = await pricedCreator();
    const theirs = await pricedCreator();
    const ready = await readyUpload(theirs.creator.id);
    await expect(
      publishVideo(actor, { videoId: ready.id }),
    ).rejects.toBeInstanceOf(VideoNotFoundError);
    expect((await videoRow(ready.id)).status).toBe("draft");
  });
});

describe("the publishVideo action (02 §6.1)", () => {
  it("returns the link to share and fetches the page again", async () => {
    const owner = await signedInCreator();
    await insertRateCard({ id: owner.creatorId });
    const [profile] = await db
      .select({ handle: creatorProfile.handle })
      .from(creatorProfile)
      .where(eq(creatorProfile.id, owner.creatorId));
    const ready = await readyUpload(owner.creatorId);
    expect(await publishVideoAction({ videoId: ready.id })).toEqual({
      ok: true,
      data: {
        shareUrl: `${env.APP_URL}${videoUrl(profile?.handle ?? "", ready.slug)}`,
      },
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("refuses with publish_blocked when a blocker appeared, and 404s a video that isn't the creator's", async () => {
    const owner = await signedInCreator();
    await insertRateCard({ id: owner.creatorId });
    const unsaid = await readyUpload(owner.creatorId, {
      postingsConfirmedAt: null,
    });
    expect(await publishVideoAction({ videoId: unsaid.id })).toEqual({
      ok: false,
      error: { code: "publish_blocked", message: REVIEW_COPY.blockersTitle },
    });
    const theirs = await insertUploadVideo(await insertCreator());
    await expect(
      publishVideoAction({ videoId: theirs.id }),
    ).rejects.toMatchObject(NOT_FOUND);
    await expect(
      publishVideoAction({ videoId: "not-a-uuid" }),
    ).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("listCreatorVideos (03 §7.4; 05 §6.8)", () => {
  it("lists drafts first, then the most recently changed, each with its card's facts", async () => {
    const { creator, actor } = await pricedCreator();
    // The draft is the oldest row: only the drafts-first rule puts it ahead of the live videos.
    const draft = await insertUploadVideo(creator);
    const live = await readyLibraryVideo(creator.id);
    await publishVideo(actor, { videoId: live.id });
    const older = await readyUpload(creator.id);
    await publishVideo(actor, { videoId: older.id });
    await db
      .update(video)
      .set({ updatedAt: new Date("2026-10-01T12:00:00.000Z") })
      .where(eq(video.id, older.id));
    await insertLicenseRequest(live, { status: "awaiting_approval" });
    await insertLicense(
      await insertLicenseRequest(live, { status: "approved" }),
    );

    const { handle, videos } = await listCreatorVideos(actor);
    expect(videos.map((v) => v.id)).toEqual([draft.id, live.id, older.id]);
    expect(videos[0]).toMatchObject({
      status: "draft",
      shareUrl: null,
      continueHref: `/dashboard/videos/${draft.id}?step=file`,
      badge: { size: "sm", ownership: "self_attested" },
      fromPriceCents: 15000,
      currency: "cad",
    });
    expect(videos[1]).toMatchObject({
      status: "published",
      continueHref: null,
      shareUrl: `${env.APP_URL}${videoUrl(handle, live.slug)}`,
      badge: {
        size: "sm",
        ownership: "verified_owner",
        provider: "mock",
        verifiedUsername: "@demo.creator",
      },
      pendingCount: 1,
      licenseCount: 1,
    });
    expect(JSON.stringify(videos)).not.toMatch(OBJECT_KEY);
  });

  it("prints a video's own base price as its From price", async () => {
    const { creator, actor } = await pricedCreator();
    await readyUpload(creator.id, { basePriceOverrideCents: 20000 });
    const { videos } = await listCreatorVideos(actor);
    expect(videos[0]?.fromPriceCents).toBe(20000);
  });
});

describe("listPublicVideos (03 §7.5; 07 D72)", () => {
  it("shows only published videos, newest published first, with the badge buyers see and no object key", async () => {
    const { creator, actor } = await pricedCreator();
    const first = await readyLibraryVideo(creator.id);
    await publishVideo(actor, { videoId: first.id });
    // Created and published later, but its published_at is the older one.
    const second = await readyUpload(creator.id);
    await publishVideo(actor, { videoId: second.id });
    await db
      .update(video)
      .set({ publishedAt: new Date("2026-10-01T12:00:00.000Z") })
      .where(eq(video.id, second.id));
    await insertUploadVideo(creator);
    await readyUpload(creator.id, {
      status: "unpublished",
      publishedAt: new Date(),
    });

    const videos = await listPublicVideos(creator.id);
    expect(videos.map((v) => v.id)).toEqual([first.id, second.id]);
    expect(videos[0]?.badge).toMatchObject({
      ownership: "verified_owner",
      provider: "mock",
    });
    expect(videos[1]?.badge).toMatchObject({ ownership: "self_attested" });
    expect(videos[0]?.posterSrc).toMatch(
      new RegExp(`^/api/media/posters/${first.id}\\?v=[0-9a-f]{8}$`),
    );
    expect(JSON.stringify(videos)).not.toMatch(OBJECT_KEY);
  });

  it("leaves out a live video none of whose combinations can be bought, which the creator's card marks (owner answer Q-137 a)", async () => {
    const { creator, actor } = await pricedCreator(["organic_social"]);
    const open = await readyUpload(creator.id);
    await publishVideo(actor, { videoId: open.id });
    const music = await readyUpload(creator.id);
    await publishVideo(actor, { videoId: music.id });
    // With Organic social off on the rate card, music's rule (01 J5.14) leaves no use.
    await db
      .update(video)
      .set({ containsMusic: true, disabledUses: [...MUSIC_DISABLED_USES] })
      .where(eq(video.id, music.id));

    expect((await listPublicVideos(creator.id)).map((v) => v.id)).toEqual([
      open.id,
    ]);
    const { videos } = await listCreatorVideos(actor);
    expect(videos.find((v) => v.id === music.id)?.fromPriceCents).toBeNull();
    expect(videos.find((v) => v.id === open.id)?.fromPriceCents).toEqual(
      expect.any(Number),
    );
  });
});
