import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "../../../src/db/client";
import {
  licenseRequest,
  rateCard,
  socialAccount,
  socialPost,
  video,
  videoPosting,
} from "../../../src/db/schema";
import { expectDbError, PG_ERROR } from "../../helpers/db";
import {
  insertCreator,
  insertLibraryVideo,
  insertLicense,
  insertLicenseRequest,
  insertMoneyMovement,
  insertRateCard,
  insertSocialAccount,
  insertSocialPost,
  insertUploadVideo,
  insertVideoPosting,
  instagramReelUrl,
  randomHex,
  rateCardRow,
} from "../../helpers/factories";

/** A creator with a connected Instagram account and a post whose link_key is `linkKey`. */
async function instagramPost(linkKey?: string) {
  const creator = await insertCreator();
  const account = await insertSocialAccount(creator, { provider: "instagram" });
  const post = await insertSocialPost(
    account,
    linkKey ? { providerPostId: linkKey } : {},
  );
  return { creator, account, post };
}

async function newUploadVideo() {
  const creator = await insertCreator();
  return insertUploadVideo(creator);
}

describe("CORE constraints (P03 smoke cases)", () => {
  it("handle: allows dots and underscores, refuses .., capitals, a leading dot and fewer than 3 characters", async () => {
    await insertCreator({ handle: "maya.films" });
    await insertCreator({ handle: "m_a.y_a" });
    for (const handle of ["a..b", "Maya", ".maya", "ma"]) {
      await expectDbError(insertCreator({ handle }), {
        code: PG_ERROR.check,
        constraint: "creator_profile_handle_format",
      });
    }
  });

  it("total: allows 99,999,999 in minor units, refuses 100,000,000 and a total that isn't price + fee", async () => {
    const target = await newUploadVideo();
    const atCap = await insertLicenseRequest(target, {
      licensePriceCents: 90_909_090,
      platformFeeCents: 9_090_909,
    });
    expect(atCap.amountTotalCents).toBe(99_999_999);
    await expectDbError(
      insertLicenseRequest(target, {
        licensePriceCents: 90_000_000,
        platformFeeCents: 10_000_000,
      }),
      { code: PG_ERROR.check, constraint: "license_request_total" },
    );
    await expectDbError(
      insertLicenseRequest(target, { amountTotalCents: 16_501 }),
      {
        code: PG_ERROR.check,
        constraint: "license_request_total",
      },
    );
  });

  it("buyer token: refuses an unsealed value", async () => {
    await expectDbError(
      insertLicenseRequest(await newUploadVideo(), { buyerTokenEnc: "plain" }),
      {
        code: PG_ERROR.check,
        constraint: "license_request_buyer_token_sealed",
      },
    );
  });

  it("verified postings: one video per (platform, link_key) until released; unverified rows may share it (07 D66)", async () => {
    const linkKey = `K${randomHex(5)}`;
    const a = await instagramPost(linkKey);
    const b = await instagramPost(linkKey);
    const first = await insertLibraryVideo(a.account, a.post);
    await expectDbError(insertLibraryVideo(b.account, b.post), {
      code: PG_ERROR.unique,
      constraint: "video_posting_verified_uidx",
    });
    await db
      .update(videoPosting)
      .set({ verification: "unverified", unverifiedReason: "released" })
      .where(eq(videoPosting.id, first.posting.id));
    await insertLibraryVideo(b.account, b.post);

    for (const creator of [a.creator, b.creator]) {
      const upload = await insertUploadVideo(creator);
      await insertVideoPosting(upload, {
        linkKey,
        url: instagramReelUrl(linkKey),
      });
    }
  });

  it("posting shape: verifiable platforms only, a reason when unverified, one source, CASCADE from the video, RESTRICT from the post", async () => {
    const upload = await newUploadVideo();
    await expectDbError(
      insertVideoPosting(upload, {
        platform: "facebook",
        verification: "verified",
        unverifiedReason: null,
        otherLabel: null,
        url: "https://www.facebook.com/reel/123",
        linkKey: "123",
      }),
      { code: PG_ERROR.check, constraint: "video_posting_unverifiable" },
    );
    await expectDbError(
      insertVideoPosting(upload, { unverifiedReason: null }),
      {
        code: PG_ERROR.check,
        constraint: "video_posting_reason",
      },
    );

    const { account, post } = await instagramPost();
    const library = await insertLibraryVideo(account, post);
    await expectDbError(insertVideoPosting(library.video, { isSource: true }), {
      code: PG_ERROR.unique,
      constraint: "video_posting_source_uidx",
    });

    await insertVideoPosting(upload);
    await insertVideoPosting(upload);
    await db.delete(video).where(eq(video.id, upload.id));
    const left = await db
      .select({ id: videoPosting.id })
      .from(videoPosting)
      .where(eq(videoPosting.videoId, upload.id));
    expect(left).toEqual([]);

    await expectDbError(
      db.delete(socialPost).where(eq(socialPost.id, post.id)),
      {
        code: PG_ERROR.restrict,
        constraint: "video_posting_social_post_fk",
      },
    );
  });

  it("publish: needs postings confirmed, with every other requirement met", async () => {
    const draft = await newUploadVideo();
    const published = {
      status: "published",
      originalStatus: "ready",
      originalObjectKey: `originals/${draft.creatorId}/${draft.id}.mp4`,
      originalBytes: 1_048_576,
      originalMime: "video/mp4",
      posterObjectKey: `posters/${draft.creatorId}/${draft.id}.jpg`,
      posterOrigin: "frame_capture",
      rightsAttestedAt: new Date(),
      attestationVersion: "v1",
      containsMusic: false,
      identifiablePeople: false,
      publishedAt: new Date(),
    } as const;
    await expectDbError(
      db.update(video).set(published).where(eq(video.id, draft.id)),
      {
        code: PG_ERROR.check,
        constraint: "video_published_requirements",
      },
    );
    await db
      .update(video)
      .set({ ...published, postingsConfirmedAt: new Date() })
      .where(eq(video.id, draft.id));
  });

  it("money movements: one per request and kind, a positive amount; the fee floor stays within 0–10000", async () => {
    const request = await insertLicenseRequest(await newUploadVideo());
    await insertMoneyMovement(request);
    await expectDbError(insertMoneyMovement(request), {
      code: PG_ERROR.unique,
      constraint: "money_movement_request_kind_uidx",
    });
    await expectDbError(
      insertMoneyMovement(request, { kind: "buyer_refund", amountCents: 0 }),
      {
        code: PG_ERROR.check,
        constraint: "money_movement_amount_positive",
      },
    );
    await expectDbError(
      insertLicenseRequest(
        { id: request.videoId, creatorId: request.creatorId },
        { platformFeeMinCents: 10_001 },
      ),
      {
        code: PG_ERROR.check,
        constraint: "license_request_fee_min_range",
      },
    );
  });

  it("currency: payout_currency defaults to cad; requests and movements need one; only cad and usd exist; codes start CL- (07 D94, D101)", async () => {
    const creator = await insertCreator();
    expect(creator.payoutCurrency).toBe("cad");
    const target = await insertUploadVideo(creator);
    await expectDbError(insertLicenseRequest(target, { currency: undefined }), {
      code: PG_ERROR.notNull,
      column: "currency",
    });
    const request = await insertLicenseRequest(target);
    expect(request.currency).toBe("cad");
    await expectDbError(
      db
        .update(licenseRequest)
        .set({ currency: sql`'eur'` })
        .where(eq(licenseRequest.id, request.id)),
      { code: PG_ERROR.invalidInput },
    );
    await expectDbError(insertMoneyMovement(request, { currency: undefined }), {
      code: PG_ERROR.notNull,
      column: "currency",
    });
    await expectDbError(insertLicense(request, { code: "CLR-7K3M-9QXA" }), {
      code: PG_ERROR.check,
      constraint: "license_code_format",
    });
    const issued = await insertLicense(request, { code: "CL-7K3M-9QXA" });
    expect(issued.code).toBe("CL-7K3M-9QXA");
  });

  it("platform accounts: one live owner per (provider, account id) until disconnected", async () => {
    const providerAccountId = `ig-${randomHex(5)}`;
    const first = await insertSocialAccount(await insertCreator(), {
      provider: "instagram",
      providerAccountId,
    });
    const second = await insertCreator();
    await expectDbError(
      insertSocialAccount(second, { provider: "instagram", providerAccountId }),
      {
        code: PG_ERROR.unique,
        constraint: "social_account_live_provider_account_uidx",
      },
    );
    await db
      .update(socialAccount)
      .set({
        status: "disconnected",
        accessTokenEnc: null,
        refreshTokenEnc: null,
        disconnectedAt: new Date(),
      })
      .where(eq(socialAccount.id, first.id));
    await insertSocialAccount(second, {
      provider: "instagram",
      providerAccountId,
    });
  });
});

describe("exclusive licenses (0002)", () => {
  it("rate card: off at ×3.00 by default; the premium stays within ×1.00 to ×10.00", async () => {
    const creator = await insertCreator();
    await insertRateCard(creator);
    expect(await rateCardRow(creator.id)).toMatchObject({
      exclusiveEnabled: false,
      exclusiveMultiplierBps: 30000,
    });

    const setPremium = (exclusiveMultiplierBps: number) =>
      db
        .update(rateCard)
        .set({ exclusiveMultiplierBps })
        .where(eq(rateCard.creatorId, creator.id));
    for (const bps of [9999, 100001]) {
      await expectDbError(setPremium(bps), {
        code: PG_ERROR.check,
        constraint: "rate_card_exclusive_multiplier_range",
      });
    }
    for (const bps of [10000, 100000]) await setPremium(bps);
  });

  it("video: follows the card by default; its own premium stays within ×1.00 to ×10.00", async () => {
    const creator = await insertCreator();
    for (const exclusiveMultiplierBps of [9999, 100001]) {
      await expectDbError(
        insertUploadVideo(creator, { exclusiveMultiplierBps }),
        {
          code: PG_ERROR.check,
          constraint: "video_exclusive_multiplier_range",
        },
      );
    }
    for (const exclusiveMultiplierBps of [null, 30000]) {
      const row = await insertUploadVideo(creator, { exclusiveMultiplierBps });
      expect(row.exclusiveMultiplierBps).toBe(exclusiveMultiplierBps);
    }
    expect(await insertUploadVideo(creator)).toMatchObject({
      exclusiveEnabled: null,
      exclusiveMultiplierBps: null,
    });
  });

  it("request: exclusive only on a term up to 1 year with a premium in bounds; not exclusive is always ×1.00", async () => {
    const target = await newUploadVideo();
    for (const overrides of [
      { exclusive: true, termKey: "perpetual", exclusiveMultiplierBps: 30000 },
      { exclusive: false, exclusiveMultiplierBps: 30000 },
      { exclusive: true, termKey: "y1", exclusiveMultiplierBps: 100500 },
      { exclusive: true, termKey: "y1", exclusiveMultiplierBps: 9999 },
    ] as const) {
      await expectDbError(insertLicenseRequest(target, overrides), {
        code: PG_ERROR.check,
        constraint: "license_request_exclusive_fields",
      });
    }
    for (const termKey of ["d30", "m6", "y1"] as const) {
      await insertLicenseRequest(target, {
        exclusive: true,
        termKey,
        exclusiveMultiplierBps: 30000,
      });
    }
    await insertLicenseRequest(target, {
      exclusive: true,
      termKey: "y1",
      exclusiveMultiplierBps: 10000,
    });
  });

  it("request and license: not exclusive by default", async () => {
    const request = await insertLicenseRequest(await newUploadVideo());
    expect(request).toMatchObject({
      exclusive: false,
      exclusiveMultiplierBps: 10000,
    });
    expect((await insertLicense(request)).exclusive).toBe(false);
  });
});
