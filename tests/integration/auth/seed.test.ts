import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { asc, count, eq, inArray } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runSeed } from "../../../scripts/seed";
import { db } from "../../../src/db/client";
import {
  auditEvent,
  creatorProfile,
  rateCard,
  rateOption,
  socialAccount,
  socialPost,
  user,
  video,
  videoPosting,
} from "../../../src/db/schema";
import { defaultRateOptions } from "../../../src/lib/pricing/presets";
import { DAY_MS, HOUR_MS } from "../../../src/lib/time";
import {
  decryptSecret,
  deriveSubkey,
} from "../../../src/server/crypto/token-cipher";
import { env } from "../../../src/server/env";
import {
  accessTokenAad,
  refreshTokenAad,
} from "../../../src/server/social/tokens";
import {
  createLocalStorage,
  type LocalStorage,
} from "../../../src/server/storage/local";
import { resetDb } from "../../helpers/db";
import {
  insertCreator,
  insertSocialAccount,
  insertUploadVideo,
  insertUser,
} from "../../helpers/factories";
import { libraryDraft } from "../../helpers/library-videos";
import {
  expectOwnershipInvariant,
  insertVerifiedElsewhere,
} from "../../helpers/postings";
import {
  fixture,
  listFiles,
  originalKeyOf,
  posterKeyOf,
} from "../../helpers/uploads";

// `bun run db:seed [--demo]` (03 §8.1, 07 D53, D88) with .env.test's ADMIN_EMAILS (e2e-admin@example.com,
// e2e-admin-2@example.com), PAYMENTS_DRIVER=fake, the mock provider and its default scenario. --demo stores V1's files
// in a folder of this file's own: V1's ids are fixed, so the shared .data/storage would mix them with the dev seed's.
beforeEach(resetDb);

let root: string;
let store: LocalStorage;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "cliplease-seed-"));
  store = createLocalStorage({
    root,
    appUrl: env.APP_URL,
    subkey: deriveSubkey("local-storage-url"),
  });
});
// Each test starts with no stored file.
beforeEach(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(root);
});
afterAll(() => rm(root, { recursive: true, force: true }));

const seed = () => runSeed({ appEnv: "test", demo: false });
const demoSeed = () => runSeed({ appEnv: "test", demo: true, storage: store });

const MAYA_CREATOR = "00000000-0000-4000-8000-000000000001";
const MAYA_ACCOUNT = "00000000-0000-4000-8000-000000000011";
const MAYA_ACCT = "mock_acct_c4180ab2";
const V1 = "00000000-0000-4000-8000-000000000101";
const V1_POSTING = "00000000-0000-4000-8000-000000000201";
const POST_01 = "mock_post_c4180ab2_01";

/** Every file the seed stored in this test. */
const files = () => listFiles(root);

const fixtureSize = async (name: string) => (await fixture(name)).byteLength;

/** A database --demo seeded once, then V1 deleted (its posting goes too): as P09's seed left dev. */
async function seededWithoutV1() {
  await demoSeed();
  await db.delete(video).where(eq(video.id, V1));
}

async function rowCount(table: PgTable): Promise<number> {
  const [row] = await db.select({ value: count() }).from(table);
  return row.value;
}

async function counts() {
  return {
    users: await rowCount(user),
    creators: await rowCount(creatorProfile),
    accounts: await rowCount(socialAccount),
    posts: await rowCount(socialPost),
    videos: await rowCount(video),
    postings: await rowCount(videoPosting),
    audits: await rowCount(auditEvent),
    files: await files(),
  };
}

/** Every row the demo writes, in a stable order. */
async function demoRows() {
  return {
    users: await db.select().from(user).orderBy(asc(user.id)),
    creators: await db.select().from(creatorProfile),
    rateCards: await db.select().from(rateCard),
    options: await db
      .select()
      .from(rateOption)
      .orderBy(asc(rateOption.optionKey)),
    accounts: await db.select().from(socialAccount),
    posts: await db
      .select()
      .from(socialPost)
      .orderBy(asc(socialPost.providerPostId)),
    videos: await db.select().from(video),
    postings: await db.select().from(videoPosting),
  };
}

const byKey = <T extends { optionKey: string }>(rows: T[]) =>
  [...rows].sort((a, b) => a.optionKey.localeCompare(b.optionKey));

describe("db:seed", () => {
  it("creates seed_user_admin with the first listed address when no listed user exists", async () => {
    expect(await seed()).toEqual({ promoted: 0, created: true });
    const [admin] = await db.select().from(user);
    expect(admin).toMatchObject({
      id: "seed_user_admin",
      email: "e2e-admin@example.com",
      emailVerified: true,
      role: "admin",
      name: "",
    });
    expect(await db.select().from(creatorProfile)).toHaveLength(0);
  });

  it("promotes a listed user who signed in before being listed, and creates no one", async () => {
    const helper = await insertUser({
      email: "e2e-admin-2@example.com",
      role: "creator",
    });
    const other = await insertUser();
    expect(await seed()).toEqual({ promoted: 1, created: false });
    const rows = await db.select().from(user);
    expect(rows.map((r) => [r.id, r.role]).sort()).toEqual(
      [
        [helper.id, "admin"],
        [other.id, "creator"],
      ].sort(),
    );
  });

  it("writes one system seed.applied row with counts only", async () => {
    await insertUser({ email: "e2e-admin@example.com", role: "creator" });
    await seed();
    const audits = await db.select().from(auditEvent);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: "system",
      actorUserId: null,
      action: "seed.applied",
      entityType: "user",
      data: { promoted: 1, created: false, source: "seed" },
    });
    expect(JSON.stringify(audits[0].data)).not.toContain("@");
  });

  it("changes nothing on a second run", async () => {
    await insertUser({ email: "e2e-admin@example.com", role: "creator" });
    await seed();
    const before = await db.select().from(user);
    const auditsBefore = await counts();
    expect(await seed()).toEqual({ promoted: 0, created: false });
    expect(await db.select().from(user)).toEqual(before);
    expect(await counts()).toEqual(auditsBefore);
  });

  it("refuses when seed_user_admin holds an address that is no longer listed", async () => {
    await insertUser({ id: "seed_user_admin", email: "old-owner@example.com" });
    await expect(seed()).rejects.toThrow(/seed_user_admin exists/);
    const [row] = await db
      .select()
      .from(user)
      .where(eq(user.id, "seed_user_admin"));
    expect(row.email).toBe("old-owner@example.com");
  });

  it.each([false, true])(
    "refuses APP_ENV=production (demo: %s) without writing",
    async (demo) => {
      const before = await counts();
      await expect(runSeed({ appEnv: "production", demo })).rejects.toThrow(
        /APP_ENV=production/,
      );
      expect(await counts()).toEqual(before);
    },
  );
});

describe("db:seed --demo", () => {
  it("seeds @maya with a synced Demo account and her published First snow, and a second run changes nothing", async () => {
    expect(await demoSeed()).toEqual({
      promoted: 0,
      created: true,
      demo: {
        userCreated: true,
        profileCreated: true,
        rateOptionsAdded: 10,
        accountCreated: true,
        postsAdded: 24,
        videoCreated: true,
        objectsUploaded: 2,
      },
    });
    const rows = await demoRows();

    expect(rows.users.filter((u) => u.email === "maya@example.com")).toEqual([
      expect.objectContaining({
        id: "seed_user_maya",
        name: "Maya R.",
        emailVerified: true,
        role: "creator",
      }),
    ]);
    expect(rows.creators).toEqual([
      expect.objectContaining({
        id: MAYA_CREATOR,
        userId: "seed_user_maya",
        handle: "maya",
        displayName: "Maya R.",
        timeZone: "UTC",
        approvalWindowHours: 72,
        autoApprove: false,
        payoutCurrency: "cad",
        stripeAccountId: `acct_fake_${MAYA_CREATOR}`,
        payoutsStatus: "active",
      }),
    ]);
    expect(rows.rateCards).toEqual([
      expect.objectContaining({
        creatorId: MAYA_CREATOR,
        basePriceCents: 15000,
      }),
    ]);
    expect(
      byKey(
        rows.options.map(
          ({ dimension, optionKey, multiplierBps, enabled, sortOrder }) => ({
            dimension,
            optionKey,
            multiplierBps,
            enabled,
            sortOrder,
          }),
        ),
      ),
    ).toEqual(byKey(defaultRateOptions()));
    expect(
      rows.options.every((o) => o.rateCardId === rows.rateCards[0].id),
    ).toBe(true);

    expect(rows.accounts).toHaveLength(1);
    const [account] = rows.accounts;
    expect(account).toMatchObject({
      id: MAYA_ACCOUNT,
      creatorId: MAYA_CREATOR,
      provider: "mock",
      providerAccountId: MAYA_ACCT,
      username: "demo.creator",
      displayName: "Demo Creator",
      avatarUrl: "mock://avatar/01",
      profileUrl: "https://example.com/@demo.creator",
      accountType: "Media_Creator",
      status: "connected",
      scopes: ["mock.read"],
      hasOlder: false,
    });
    expect(account.accessTokenEnc).toMatch(/^v1\./);
    expect(account.refreshTokenEnc).toMatch(/^v1\./);
    // Sealed for the row's own id: the AAD binds it.
    expect(
      decryptSecret(
        account.accessTokenEnc as string,
        accessTokenAad(account.id),
      ),
    ).toBe("mock_access_c4180ab2_seed");
    expect(
      decryptSecret(
        account.refreshTokenEnc as string,
        refreshTokenAad(account.id),
      ),
    ).toBe("mock_refresh_c4180ab2_seed");

    // T is the seed's clock: last_synced_at, token_refreshed_at and every post's fetched_at.
    const t = (account.lastSyncedAt as Date).getTime();
    expect(account.tokenRefreshedAt?.getTime()).toBe(t);
    expect(account.connectedAt.getTime()).toBe(t - 3 * DAY_MS);
    expect(account.accessTokenExpiresAt?.getTime()).toBe(t + HOUR_MS);
    expect(account.refreshTokenExpiresAt?.getTime()).toBe(t + 30 * DAY_MS);
    expect(rows.creators[0].ageConfirmedAt.getTime()).toBe(t - 10 * DAY_MS);

    expect(rows.posts.map((p) => p.providerPostId)).toEqual(
      Array.from(
        { length: 24 },
        (_, i) => `mock_post_c4180ab2_${String(i + 1).padStart(2, "0")}`,
      ),
    );
    expect(
      rows.posts.every(
        (p) =>
          p.socialAccountId === MAYA_ACCOUNT &&
          p.creatorId === MAYA_CREATOR &&
          p.fetchedAt.getTime() === t,
      ),
    ).toBe(true);
    expect(rows.posts[0]).toMatchObject({
      durationSec: 14,
      width: 720,
      height: 1280,
    });

    // V1 "First snow" (03 §8.1): published two days ago whatever the payments driver, from the fixtures.
    const twoDaysAgo = new Date(t - 2 * DAY_MS);
    expect(rows.videos).toEqual([
      expect.objectContaining({
        id: V1,
        creatorId: MAYA_CREATOR,
        slug: "first-snow",
        title: "First snow",
        source: "library",
        ownership: "verified_owner",
        status: "published",
        publishedAt: twoDaysAgo,
        originalStatus: "ready",
        originalMime: "video/mp4",
        originalFilename: "first-snow.mp4",
        originalBytes: await fixtureSize("sample.mp4"),
        durationMs: 14_000,
        width: 720,
        height: 1280,
        posterOrigin: "frame_capture",
        postingsConfirmedAt: twoDaysAgo,
        sameVideoConfirmedAt: twoDaysAgo,
        containsMusic: false,
        identifiablePeople: false,
        rightsAttestedAt: twoDaysAgo,
        attestationVersion: "v1",
        disabledUses: [],
        basePriceOverrideCents: null,
        originalUploadId: null,
      }),
    ]);
    const [v1] = rows.videos;
    expect(v1.originalObjectKey).toMatch(originalKeyOf(MAYA_CREATOR, V1));
    expect(v1.posterObjectKey).toMatch(posterKeyOf(V1));
    expect((await store.head(v1.originalObjectKey as string))?.size).toBe(
      await fixtureSize("sample.mp4"),
    );
    expect((await store.head(v1.posterObjectKey as string))?.size).toBe(
      await fixtureSize("poster.jpg"),
    );
    expect(rows.postings).toEqual([
      expect.objectContaining({
        id: V1_POSTING,
        videoId: V1,
        creatorId: MAYA_CREATOR,
        platform: "mock",
        url: `https://example.com/mock/${POST_01}`,
        linkKey: POST_01,
        verification: "verified",
        unverifiedReason: null,
        isSource: true,
        position: 0,
        socialAccountId: MAYA_ACCOUNT,
        socialPostId: rows.posts[0].id,
        verifiedUsername: "@demo.creator",
        verifiedAccountLinkedAt: account.connectedAt,
        verifiedAt: twoDaysAgo,
        showLink: true,
      }),
    ]);
    await expectOwnershipInvariant();
    const stored = await files();
    expect(stored).toHaveLength(2);

    const audits = await db.select().from(auditEvent);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorType: "system",
      action: "seed.applied",
      entityId: "seed_user_admin",
      data: { promoted: 0, created: true, source: "seed" },
    });
    expect(JSON.stringify(audits[0].data)).not.toContain("@");

    expect(await demoSeed()).toEqual({
      promoted: 0,
      created: false,
      demo: {
        userCreated: false,
        profileCreated: false,
        rateOptionsAdded: 0,
        accountCreated: false,
        postsAdded: 0,
        videoCreated: false,
        objectsUploaded: 0,
      },
    });
    expect(await demoRows()).toEqual(rows);
    expect(await db.select().from(auditEvent)).toEqual(audits);
    expect(await files()).toEqual(stored);
  });

  it("stores a missing file again under a new key, and keeps the one still there", async () => {
    await demoSeed();
    const [before] = await db.select().from(video);
    await store.delete(before.posterObjectKey as string);
    expect((await demoSeed()).demo).toMatchObject({
      videoCreated: false,
      objectsUploaded: 1,
    });
    const [after] = await db.select().from(video);
    expect(after.originalObjectKey).toBe(before.originalObjectKey);
    expect(after.posterObjectKey).not.toBe(before.posterObjectKey);
    expect(await store.head(after.posterObjectKey as string)).not.toBeNull();
  });

  // A Replace in progress (its key has no object yet) and one that failed (no key): the creator's own, never repaired.
  it.each([
    {
      status: "uploading",
      columns: { originalStatus: "uploading" },
      dropObject: true,
    },
    {
      status: "failed",
      columns: {
        originalStatus: "failed",
        originalObjectKey: null,
        originalBytes: null,
        originalMime: null,
      },
      dropObject: false,
    },
  ] as const)(
    "leaves an original that is $status to the creator, storing no fixture over it",
    async ({ columns, dropObject }) => {
      await demoSeed();
      const [seeded] = await db.select().from(video);
      await db
        .update(video)
        .set({ ...columns, status: "unpublished" })
        .where(eq(video.id, V1));
      if (dropObject) await store.delete(seeded.originalObjectKey as string);
      const [before] = await db.select().from(video);
      expect((await demoSeed()).demo).toMatchObject({ objectsUploaded: 0 });
      expect(await db.select().from(video)).toEqual([before]);
    },
  );

  it("adds First snow to a database seeded before it (the account already there)", async () => {
    await seededWithoutV1();
    expect((await demoSeed()).demo).toEqual({
      userCreated: false,
      profileCreated: false,
      rateOptionsAdded: 0,
      accountCreated: false,
      postsAdded: 0,
      videoCreated: true,
      objectsUploaded: 2,
    });
    const rows = await demoRows();
    expect(rows.videos).toEqual([
      expect.objectContaining({ id: V1, ownership: "verified_owner" }),
    ]);
    expect(rows.postings).toEqual([
      expect.objectContaining({ id: V1_POSTING, isSource: true }),
    ]);
  });

  it.each([
    [
      "verified on another creator's video",
      () => insertVerifiedElsewhere(POST_01),
    ],
    [
      "verified on another of Maya's videos (a draft from her Library)",
      () =>
        libraryDraft(
          { creatorId: MAYA_CREATOR },
          { ready: false, post: { providerPostId: POST_01, linkKey: POST_01 } },
        ),
    ],
  ])(
    "refuses when post 01 is %s, writing and storing nothing",
    async (_, arrange) => {
      await seededWithoutV1();
      await arrange();
      const before = await counts();
      await expect(demoSeed()).rejects.toThrow(
        /mock_post_c4180ab2_01 is already licensable on another video: reset the dev database/,
      );
      expect(await counts()).toEqual(before);
    },
  );

  it("refuses when @maya's first-snow is another video, storing nothing", async () => {
    await seededWithoutV1();
    await insertUploadVideo({ id: MAYA_CREATOR }, { slug: "first-snow" });
    const before = await counts();
    await expect(demoSeed()).rejects.toThrow(/first-snow is another video/);
    expect(await counts()).toEqual(before);
  });

  it("names seed_user_maya in the audit row when only the demo changed", async () => {
    await insertUser({ email: "e2e-admin@example.com", role: "admin" });
    await demoSeed();
    const audits = await db.select().from(auditEvent);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      entityType: "user",
      entityId: "seed_user_maya",
      data: { promoted: 0, created: false, demo: { accountCreated: true } },
    });
  });

  it("adds only what is missing and leaves an existing Demo account as it is", async () => {
    await demoSeed();
    const seeded = await demoRows();
    await db
      .delete(rateOption)
      .where(
        inArray(rateOption.optionKey, ["broadcast", "perpetual", "region"]),
      );
    await db.delete(socialPost).where(
      inArray(
        socialPost.id,
        seeded.posts.slice(12).map((p) => p.id),
      ),
    );

    expect((await demoSeed()).demo).toEqual({
      userCreated: false,
      profileCreated: false,
      rateOptionsAdded: 3,
      accountCreated: false,
      postsAdded: 0,
      videoCreated: false,
      objectsUploaded: 0,
    });
    const rows = await demoRows();
    expect(rows.rateCards).toEqual(seeded.rateCards);
    expect(rows.options).toHaveLength(10);
    expect(rows.accounts).toEqual(seeded.accounts);
    expect(rows.posts).toEqual(seeded.posts.slice(0, 12));
  });

  it.each([
    [
      "Maya's address belongs to another user",
      () => insertUser({ email: "maya@example.com" }),
      /Maya's address belongs to a user other than seed_user_maya/,
    ],
    [
      "seed_user_maya has another address",
      () => insertUser({ id: "seed_user_maya", email: "someone@example.com" }),
      /seed_user_maya exists with another address/,
    ],
    [
      "the handle maya belongs to another creator",
      () => insertCreator({ handle: "maya" }),
      /the handle maya belongs to another creator/,
    ],
    [
      "Maya's Demo account is linked to another creator",
      async () =>
        insertSocialAccount(await insertCreator(), {
          providerAccountId: MAYA_ACCT,
        }),
      /mock_acct_c4180ab2 is linked to another creator/,
    ],
  ])("refuses when %s, writing nothing", async (_, arrange, message) => {
    await arrange();
    const before = await counts();
    await expect(demoSeed()).rejects.toThrow(message);
    expect(await counts()).toEqual(before);
  });
});
