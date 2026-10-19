// Integration factories (P03): each inserts one valid row that satisfies every CORE CHECK, NOT NULL and FK, then
// applies `overrides` last. Unique columns get random values, because rows build up across the tests of one file
// (resetDb runs once per file). Later prompts reuse these.
import { randomBytes, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { PgInsertValue, PgTable } from "drizzle-orm/pg-core";
import { db } from "../../src/db/client";
import {
  creatorProfile,
  license,
  licenseRequest,
  moneyMovement,
  socialAccount,
  socialPost,
  user,
  video,
  videoPosting,
} from "../../src/db/schema";
import type {
  CreatorProfile,
  License,
  LicenseRequest,
  MoneyMovement,
  NewCreatorProfile,
  NewLicense,
  NewLicenseRequest,
  NewMoneyMovement,
  NewSocialAccount,
  NewSocialPostRow,
  NewVideo,
  NewVideoPosting,
  SocialAccount,
  SocialPostRow,
  User,
  Video,
  VideoPosting,
} from "../../src/db/schema/types";
import { LICENSE_V1_VERSION } from "../../src/lib/legal/license-v1";
import type { LicenseSnapshotV1 } from "../../src/lib/licensing/snapshot";
import { DAY_MS, HOUR_MS } from "../../src/lib/time";

/** Random lowercase hex, for unique test values. */
export const randomHex = (bytes: number) => randomBytes(bytes).toString("hex");

/** A free, valid handle for one test (rows build up across a file). */
export const uniqueTestHandle = () => `t.${randomHex(4)}`;

/** The Instagram reel URL insertVideoPosting builds for a link key. */
export const instagramReelUrl = (linkKey: string) =>
  `https://www.instagram.com/reel/${linkKey}/`;

const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, as license_code_format allows
const TEST_CREATOR_NAME = "Test Creator";
const TEST_VIDEO_TITLE = "Test video";
// Every test request and its license snapshot: organic social, 30 days, one country (Canada).
const TEST_SCOPE = {
  useKey: "organic_social",
  termKey: "d30",
  territoryKey: "country",
  territoryCode: "CA",
} as const;

/** Inserts one row and returns it; pass `tx` inside a transaction. */
async function insertOne<T extends PgTable>(
  table: T,
  values: PgInsertValue<T>,
  executor: Pick<typeof db, "insert"> = db,
): Promise<T["$inferSelect"]> {
  const [row] = await executor.insert(table).values(values).returning();
  if (row === undefined) throw new Error("insert returned no row");
  return row;
}

export async function insertUser(
  overrides: Partial<typeof user.$inferInsert> = {},
): Promise<User> {
  const id = overrides.id ?? randomUUID();
  return insertOne(user, {
    id,
    name: "Test User",
    email: `user-${id}@example.com`,
    emailVerified: true,
    ...overrides,
  });
}

/**
 * A creator profile and nothing else (no rate card, accounts or videos). It inserts its user unless `userId` is given.
 * time_zone ('UTC') and payout_currency ('cad') come from the database defaults.
 */
export async function insertCreator(
  overrides: Partial<NewCreatorProfile> = {},
): Promise<CreatorProfile> {
  const userId = overrides.userId ?? (await insertUser()).id;
  return insertOne(creatorProfile, {
    userId,
    handle: `c${randomHex(6)}`,
    displayName: TEST_CREATOR_NAME,
    ageConfirmedAt: new Date(),
    ...overrides,
  });
}

/** A connected account with a sealed-looking access token (tests never encrypt; P06 owns the cipher). */
export async function insertSocialAccount(
  creator: Pick<CreatorProfile, "id">,
  overrides: Partial<NewSocialAccount> = {},
): Promise<SocialAccount> {
  return insertOne(socialAccount, {
    creatorId: creator.id,
    provider: "mock",
    providerAccountId: `acct-${randomHex(6)}`,
    username: `user${randomHex(3)}`,
    accessTokenEnc: "v1.test.iv.tag.access",
    ...overrides,
  });
}

/** A post of `account`; link_key is the provider post id unless given. */
export async function insertSocialPost(
  account: SocialAccount,
  overrides: Partial<NewSocialPostRow> = {},
): Promise<SocialPostRow> {
  const providerPostId = overrides.providerPostId ?? `post${randomHex(6)}`;
  return insertOne(socialPost, {
    socialAccountId: account.id,
    creatorId: account.creatorId,
    provider: account.provider,
    providerPostId,
    mediaType: "video",
    permalink: `https://example.com/mock/${providerPostId}`,
    linkKey: providerPostId,
    postedAt: new Date(),
    fetchedAt: new Date(),
    ...overrides,
  });
}

const draftVideo = (creatorId: string) =>
  ({
    creatorId,
    slug: `video-${randomHex(4)}`,
    title: TEST_VIDEO_TITLE,
  }) satisfies Partial<NewVideo>;

/** A draft upload: self-attested, no postings. */
export async function insertUploadVideo(
  creator: Pick<CreatorProfile, "id">,
  overrides: Partial<NewVideo> = {},
): Promise<Video> {
  return insertOne(video, {
    ...draftVideo(creator.id),
    source: "upload",
    ownership: "self_attested",
    ...overrides,
  });
}

/**
 * A draft Library video (verified owner) and its one source posting: verified, position 0, pointing at `post` and
 * `account`. Both rows are written in one transaction.
 */
export async function insertLibraryVideo(
  account: SocialAccount,
  post: SocialPostRow,
  overrides: {
    video?: Partial<NewVideo>;
    posting?: Partial<NewVideoPosting>;
  } = {},
): Promise<{ video: Video; posting: VideoPosting }> {
  return db.transaction(async (tx) => {
    const row = await insertOne(
      video,
      {
        ...draftVideo(post.creatorId),
        source: "library",
        ownership: "verified_owner",
        ...overrides.video,
      },
      tx,
    );
    const posting = await insertOne(
      videoPosting,
      {
        videoId: row.id,
        creatorId: row.creatorId,
        platform: post.provider,
        url: post.permalink,
        linkKey: post.linkKey,
        verification: "verified",
        isSource: true,
        socialAccountId: account.id,
        socialPostId: post.id,
        verifiedUsername: `@${account.username ?? "test"}`,
        verifiedAccountLinkedAt: account.connectedAt,
        verifiedAt: new Date(),
        position: 0,
        ...overrides.posting,
      },
      tx,
    );
    return { video: row, posting };
  });
}

/**
 * Publishes `draft` with every column `video_published_requirements` asks for: a ready original, a poster, the
 * attestations and the confirmed postings.
 */
export async function publishVideo(draft: Video): Promise<Video> {
  const [live] = await db
    .update(video)
    .set({
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
      postingsConfirmedAt: new Date(),
      publishedAt: new Date(),
    })
    .where(eq(video.id, draft.id))
    .returning();
  if (!live) throw new Error("no video to publish");
  return live;
}

/**
 * An unverified Instagram posting ('not_found') at the video's next free position, with a random link. Set `url` and
 * `linkKey` together (video_posting_link_key), or both to null with `unverifiedReason: "no_link"`. The position is
 * computed in the insert itself, so pass `position` when inserting several postings on one video at once.
 */
export async function insertVideoPosting(
  target: Pick<Video, "id" | "creatorId">,
  overrides: Partial<NewVideoPosting> = {},
): Promise<VideoPosting> {
  const linkKey = `k${randomHex(5)}`;
  return insertOne(videoPosting, {
    videoId: target.id,
    creatorId: target.creatorId,
    platform: "instagram",
    url: instagramReelUrl(linkKey),
    linkKey,
    verification: "unverified",
    unverifiedReason: "not_found",
    position: sql`(select coalesce(max(${videoPosting.position}), -1) + 1 from ${videoPosting} where ${videoPosting.videoId} = ${target.id})`,
    ...overrides,
  });
}

/**
 * A checkout_pending request for `target` in its creator's payout currency (read in the insert itself): CA$150.00 +
 * CA$15.00 = CA$165.00, fee floor CA$2.00. The total is price + fee unless `amountTotalCents` is given.
 */
export async function insertLicenseRequest(
  target: Pick<Video, "id" | "creatorId">,
  overrides: Partial<NewLicenseRequest> = {},
): Promise<LicenseRequest> {
  const licensePriceCents = overrides.licensePriceCents ?? 15000;
  const platformFeeCents = overrides.platformFeeCents ?? 1500;
  return insertOne(licenseRequest, {
    videoId: target.id,
    creatorId: target.creatorId,
    licenseeName: "Acme Studio",
    contactName: "Pat Buyer",
    buyerEmail: `buyer-${randomHex(4)}@example.com`,
    buyerTokenHash: randomHex(32),
    buyerTokenEnc: "v1.test.iv.tag.buyer",
    ...TEST_SCOPE,
    currency: sql`(select ${creatorProfile.payoutCurrency} from ${creatorProfile} where ${creatorProfile.id} = ${target.creatorId})`,
    basePriceCents: 15000,
    useMultiplierBps: 10000,
    termMultiplierBps: 10000,
    territoryMultiplierBps: 10000,
    platformFeeBps: 1000,
    platformFeeMinCents: 200,
    licensePriceCents,
    platformFeeCents,
    amountTotalCents: licensePriceCents + platformFeeCents,
    termsVersion: LICENSE_V1_VERSION,
    termsAcceptedAt: new Date(),
    approvalWindowHours: 72,
    checkoutSubmissionId: randomUUID(),
    checkoutExpiresAt: new Date(Date.now() + HOUR_MS),
    ...overrides,
  });
}

/** A pending creator transfer of the license price, in the request's currency. */
export async function insertMoneyMovement(
  request: LicenseRequest,
  overrides: Partial<NewMoneyMovement> = {},
): Promise<MoneyMovement> {
  return insertOne(moneyMovement, {
    licenseRequestId: request.id,
    kind: "creator_transfer",
    currency: request.currency,
    amountCents: request.licensePriceCents,
    ...overrides,
  });
}

function randomLicenseCode(): string {
  const part = () =>
    Array.from(randomBytes(4), (b) => CODE_ALPHABET[b % 32]).join("");
  return `CL-${part()}-${part()}`;
}

/** A minimal, typed v1 snapshot (self-attested, no postings). License issuing (P18) builds the real one. */
function testSnapshot(
  request: LicenseRequest,
  code: string,
  startsAt: Date,
  endsAt: Date | null,
): LicenseSnapshotV1 {
  return {
    v: 1,
    termsVersion: LICENSE_V1_VERSION,
    code,
    issuedAt: startsAt.toISOString(),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt?.toISOString() ?? null,
    licensee: { name: request.licenseeName },
    creator: { handle: "test", displayName: TEST_CREATOR_NAME },
    ownership: { kind: "self_attested" },
    postings: [],
    video: {
      id: request.videoId,
      title: TEST_VIDEO_TITLE,
      durationMs: null,
      width: null,
      height: null,
    },
    scope: {
      useKey: TEST_SCOPE.useKey,
      useLabel: "Organic social",
      termKey: TEST_SCOPE.termKey,
      termLabel: "30 days",
      territoryKey: TEST_SCOPE.territoryKey,
      territoryLabel: "One country",
      territoryDetail: "Canada",
    },
    exclusions: { music: false, people: false },
    creditLine: "Video: @test",
    amounts: {
      licensePriceCents: request.licensePriceCents,
      platformFeeCents: request.platformFeeCents,
      amountTotalCents: request.amountTotalCents,
      currency: request.currency,
    },
    exclusive: false,
    renewalOfCode: null,
  };
}

/**
 * A license for `request` (30 days from now unless `startsAt` / `endsAt` are given), with a random CL- code. The
 * snapshot follows the code and dates; its scope, creator and ownership are placeholders, so pass `snapshot` when a
 * test reads them.
 */
export async function insertLicense(
  request: LicenseRequest,
  overrides: Partial<NewLicense> = {},
): Promise<License> {
  const code = overrides.code ?? randomLicenseCode();
  const startsAt = overrides.startsAt ?? new Date();
  const endsAt =
    overrides.endsAt === undefined
      ? new Date(startsAt.getTime() + 30 * DAY_MS)
      : overrides.endsAt;
  return insertOne(license, {
    licenseRequestId: request.id,
    videoId: request.videoId,
    creatorId: request.creatorId,
    code,
    termsVersion: request.termsVersion,
    startsAt,
    endsAt,
    snapshot: testSnapshot(request, code, startsAt, endsAt),
    originalObjectKey: `originals/${request.creatorId}/${request.videoId}.mp4`,
    originalBytes: 1_048_576,
    originalMime: "video/mp4",
    ...overrides,
  });
}
