import { asc, count, eq, inArray } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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
} from "../../../src/db/schema";
import { defaultRateOptions } from "../../../src/lib/pricing/presets";
import { DAY_MS, HOUR_MS } from "../../../src/lib/time";
import { decryptSecret } from "../../../src/server/crypto/token-cipher";
import {
  accessTokenAad,
  refreshTokenAad,
} from "../../../src/server/social/tokens";
import { resetDb } from "../../helpers/db";
import {
  insertCreator,
  insertSocialAccount,
  insertUser,
} from "../../helpers/factories";

// `bun run db:seed [--demo]` (03 §8.1, 07 D53, D88) with .env.test's ADMIN_EMAILS (e2e-admin@example.com,
// e2e-admin-2@example.com), PAYMENTS_DRIVER=fake, the mock provider and its default scenario.
beforeEach(resetDb);
// Maya's demo rows must not stay in the shared test database.
afterAll(resetDb);

const seed = () => runSeed({ appEnv: "test", demo: false });
const demoSeed = () => runSeed({ appEnv: "test", demo: true });

const MAYA_CREATOR = "00000000-0000-4000-8000-000000000001";
const MAYA_ACCOUNT = "00000000-0000-4000-8000-000000000011";
const MAYA_ACCT = "mock_acct_c4180ab2";

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
    audits: await rowCount(auditEvent),
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
  it("seeds @maya with a synced Demo account, and a second run changes nothing", async () => {
    expect(await demoSeed()).toEqual({
      promoted: 0,
      created: true,
      demo: {
        userCreated: true,
        profileCreated: true,
        rateOptionsAdded: 10,
        accountCreated: true,
        postsAdded: 24,
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
      },
    });
    expect(await demoRows()).toEqual(rows);
    expect(await db.select().from(auditEvent)).toEqual(audits);
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
