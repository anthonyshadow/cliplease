import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../src/db/client";
import {
  creatorProfile,
  socialPost,
  video,
  videoPosting,
} from "../../src/db/schema";
import type { NewCreatorProfile, Video } from "../../src/db/schema/types";
import { MUSIC_DISABLED_USES } from "../../src/lib/videos/rights";
import {
  getLicensePageData,
  readLicensePageData,
} from "../../src/server/videos/public";
import {
  insertVideoPosting,
  publishVideo,
  randomHex,
} from "../helpers/factories";
import { OBJECT_KEY } from "../helpers/object-key";
import { postingsOf } from "../helpers/postings";
import {
  pricedCreator,
  readyLibraryVideo,
  readyUpload,
} from "../helpers/ready-videos";

// The license page's data (P15; 03 §7.5; 07 D03, D70, D72, D82, D94) against the test database: a published video gives
// the page's plain DTO in the creator's currency, every other state nothing (the page 404s), and the buyer's postings
// carry only what D70 shows. P19c: the hold copy's auto-approve flag, never the payouts status it is derived from.
const MOCK_ON = ["mock"] as const;

/** A creator's published Library video (its verified Demo source posting) and the creator. */
async function liveLibraryVideo(off: Parameters<typeof pricedCreator>[0] = []) {
  const { creator } = await pricedCreator(off);
  const live = await publishVideo(await readyLibraryVideo(creator.id));
  return { creator, live };
}

const read = (
  handle: string,
  v: Pick<Video, "slug">,
  platforms: readonly ("mock" | "instagram")[] = MOCK_ON,
) => readLicensePageData(handle, v.slug, platforms);

describe("readLicensePageData", () => {
  it("gives a published Library video's page: the poster route, the Demo badge, its posting and the CAD options", async () => {
    const { creator, live } = await liveLibraryVideo();
    const page = await read(creator.handle, live);
    expect(page).toMatchObject({
      video: {
        id: live.id,
        slug: live.slug,
        title: live.title,
        containsMusic: false,
        identifiablePeople: false,
      },
      creator: {
        handle: creator.handle,
        displayName: creator.displayName,
        approvalWindowHours: creator.approvalWindowHours,
      },
      badge: { size: "lg", ownership: "verified_owner", provider: "mock" },
      platformFeeBps: 1000,
      platformFeeMinCents: 200,
      selection: {
        use: "organic_social",
        term: "d30",
        territory: "country",
        territoryCode: null,
      },
    });
    expect(page?.options.currency).toBe("cad");
    expect(page?.video.posterUrl).toMatch(
      new RegExp(`^/api/media/posters/${live.id}\\?v=[0-9a-f]{8}$`),
    );
    expect(page?.postings.postings).toHaveLength(1);
    expect(page?.postings.primary).toMatchObject({
      platform: "mock",
      verified: true,
      verifiedUsername: "@demo.creator",
    });
    const json = JSON.stringify(page);
    expect(json).not.toMatch(/ObjectKey|disabledReason":"(rights|prohibited)/);
    expect(json).not.toMatch(OBJECT_KEY);
    expect(json).not.toContain(creator.id);
  });

  it("gives nothing for a draft, an unpublished or a disabled video, an unknown slug or an unknown handle", async () => {
    const { creator, live } = await liveLibraryVideo();
    expect(await read(creator.handle, { slug: "no-such-video" })).toBeNull();
    expect(await read("nobody-here", live)).toBeNull();
    for (const status of ["draft", "unpublished", "disabled"] as const) {
      await db.update(video).set({ status }).where(eq(video.id, live.id));
      expect(await read(creator.handle, live)).toBeNull();
    }
  });

  it("hides a video with any Demo posting while Demo is off (07 D72)", async () => {
    const { creator, live } = await liveLibraryVideo();
    expect(await read(creator.handle, live, [])).toBeNull();
    const { creator: other } = await pricedCreator();
    const upload = await readyUpload(other.id);
    await insertVideoPosting(upload, {
      platform: "mock",
      url: null,
      linkKey: null,
      unverifiedReason: "no_link",
    });
    await publishVideo(upload);
    expect(await read(other.handle, upload, ["instagram"])).toBeNull();
    expect(await read(other.handle, upload)).not.toBeNull();
  });

  it("keeps a music video's Paid social ads and TV / broadcast as disabled tiles (07 D82)", async () => {
    const { creator } = await pricedCreator();
    const music = await publishVideo(await readyUpload(creator.id), {
      containsMusic: true,
      disabledUses: [...MUSIC_DISABLED_USES],
    });
    const page = await read(creator.handle, music);
    expect(page?.video.containsMusic).toBe(true);
    expect(
      page?.options.use.map(({ key, enabled, disabledReason }) => ({
        key,
        enabled,
        disabledReason,
      })),
    ).toEqual([
      { key: "organic_social", enabled: true, disabledReason: undefined },
      { key: "paid_social", enabled: false, disabledReason: "music" },
      { key: "broadcast", enabled: false, disabledReason: "music" },
    ]);
  });

  it("gives nothing when no combination of the options can be bought", async () => {
    const { creator } = await pricedCreator(["organic_social"]);
    const music = await publishVideo(await readyUpload(creator.id), {
      containsMusic: true,
      disabledUses: [...MUSIC_DISABLED_USES],
    });
    expect(await read(creator.handle, music)).toBeNull();
  });

  it("lists every posting buyers may see, verified first, with no handle on a Not verified one (07 D70)", async () => {
    const { creator, live } = await liveLibraryVideo();
    await insertVideoPosting(live, {
      platform: "facebook",
      url: "https://www.facebook.com/reel/123456789",
      linkKey: "123456789",
      unverifiedReason: "unverifiable",
    });
    await insertVideoPosting(live, {
      platform: "other",
      otherLabel: "Vimeo",
      url: "https://vimeo.com/76979871",
      linkKey: null,
      unverifiedReason: "unverifiable",
    });
    const page = await read(creator.handle, live);
    expect(
      page?.postings.postings.map(
        ({ label, verified, verifiedUsername, hostLabel }) => ({
          label,
          verified,
          verifiedUsername,
          hostLabel,
        }),
      ),
    ).toEqual([
      {
        label: "Demo",
        verified: true,
        verifiedUsername: "@demo.creator",
        hostLabel: null,
      },
      {
        label: "Facebook",
        verified: false,
        verifiedUsername: null,
        hostLabel: null,
      },
      {
        label: "Vimeo",
        verified: false,
        verifiedUsername: null,
        hostLabel: "vimeo.com",
      },
    ]);
  });

  it("hides a link the creator hid, and a removed post's, saying which (owner answer Q-112 a)", async () => {
    const { creator, live } = await liveLibraryVideo();
    const [source] = await postingsOf(live.id);
    await db
      .update(videoPosting)
      .set({ showLink: false })
      .where(eq(videoPosting.videoId, live.id));
    expect((await read(creator.handle, live))?.postings.primary).toMatchObject({
      url: null,
      hasLink: true,
      removed: false,
    });
    await db
      .update(socialPost)
      .set({ status: "removed", removedAt: new Date() })
      .where(eq(socialPost.id, source?.socialPostId as string));
    expect((await read(creator.handle, live))?.postings.primary).toMatchObject({
      url: null,
      removed: true,
    });
  });

  it("says the creator auto-approves only while auto-approve is on and the stored payouts status is active, and never carries that status (07 D81; owner answer Q-155)", async () => {
    const { creator } = await pricedCreator();
    const live = await publishVideo(await readyUpload(creator.id));
    expect((await read(creator.handle, live))?.creator.autoApprove).toBe(false);
    // An account, so the payouts status can be past not_started (creator_profile_payouts_needs_account).
    const stripeAccountId = `acct_fake_${randomHex(6)}`;
    const autoApproveWith = async (
      set: Pick<NewCreatorProfile, "autoApprove" | "payoutsStatus">,
    ) => {
      await db
        .update(creatorProfile)
        .set({ stripeAccountId, ...set })
        .where(eq(creatorProfile.id, creator.id));
      return (await read(creator.handle, live))?.creator.autoApprove;
    };

    expect(
      await autoApproveWith({ autoApprove: true, payoutsStatus: "active" }),
    ).toBe(true);
    expect(
      await autoApproveWith({ autoApprove: true, payoutsStatus: "restricted" }),
    ).toBe(false);
    expect(
      await autoApproveWith({ autoApprove: false, payoutsStatus: "active" }),
    ).toBe(false);

    const page = await read(creator.handle, live);
    expect(Object.keys(page?.creator ?? {}).sort()).toEqual([
      "approvalWindowHours",
      "autoApprove",
      "displayName",
      "handle",
    ]);
    expect(JSON.stringify(page)).not.toMatch(/payoutsStatus|acct_/);
  });

  it("is self-attested for an upload with no verified posting", async () => {
    const { creator } = await pricedCreator();
    const upload = await publishVideo(await readyUpload(creator.id));
    const page = await read(creator.handle, upload);
    expect(page?.postings).toEqual({ primary: null, postings: [] });
    expect(page?.badge).toMatchObject({ ownership: "self_attested" });
  });
});

describe("getLicensePageData", () => {
  // React's cache() shares one read between generateMetadata and the page only inside a server request; here it is the
  // plain read with the server's own enabled platforms (mock, in tests).
  it("reads with the server's enabled platforms", async () => {
    const { creator, live } = await liveLibraryVideo();
    const page = await getLicensePageData(creator.handle, live.slug);
    expect(page?.video.id).toBe(live.id);
  });
});
