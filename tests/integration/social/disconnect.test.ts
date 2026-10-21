import { and, eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { db } from "../../../src/db/client";
import { socialAccount, video, videoPosting } from "../../../src/db/schema";
import { MINUTE_MS } from "../../../src/lib/time";
import { countLiveVideosByAccount } from "../../../src/server/library/queries";
import { disconnectSocialAccount } from "../../../src/server/social/disconnect";
import {
  mockProvider,
  setMockScenarioForTests,
} from "../../../src/server/social/providers/mock";
import { syncSocialAccount } from "../../../src/server/social/sync";
import { redirectTo } from "../../helpers/actions";
import { mockNextHeaders, signedInCreator } from "../../helpers/auth";
import {
  accountRow,
  accountsOf,
  at,
  auditsOf,
  connect,
  connectedDemo,
  type Demo,
  demoAccount,
  insertDemoAccount,
  location,
  postNumber,
  postsOf,
} from "../../helpers/connect-flow";
import { resetDb } from "../../helpers/db";
import { insertLibraryVideo, publishVideo } from "../../helpers/factories";
import { syncedDemo } from "../../helpers/library";

// Disconnect (02 §7.8, 03 §9.3, 07 D72; owner answer Q-17 a) against the test database.
vi.mock("next/headers", () => import("../../helpers/next-headers"));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

afterAll(resetDb);
beforeEach(() => mockNextHeaders(null));
afterEach(() => {
  vi.restoreAllMocks();
  setMockScenarioForTests(null);
});

/** A Demo account whose access token expired a minute ago. */
const expiredDemo = () =>
  demoAccount(undefined, {
    accessTokenExpiresAt: new Date(Date.now() - MINUTE_MS),
  });

/** A Library video on post 01, published, so it counts as a live video from the account. */
async function publishedVideoOnPost01(s: Demo) {
  const post = await postNumber(s.account.id, "01");
  const { video: draft, posting } = await insertLibraryVideo(s.account, post);
  return { post, video: await publishVideo(draft), posting };
}

describe("disconnectSocialAccount (03 §9.3)", () => {
  it("wipes the account: tokens, expiries and profile gone, no scopes, disconnected (a)", async () => {
    const s = await syncedDemo();
    // A healthy synced row already has these four null: set them, so the wipe has to clear them.
    await db
      .update(socialAccount)
      .set({
        syncStartedAt: new Date(Date.now() - 5 * MINUTE_MS),
        syncBlockedUntil: new Date(Date.now() + 15 * MINUTE_MS),
        lastSyncError: "rate_limited",
        lastSyncErrorAt: new Date(),
      })
      .where(eq(socialAccount.id, s.account.id));
    expect(await disconnectSocialAccount(s.account.id, s.actor)).toEqual({
      revoked: "revoked",
    });
    const row = await accountRow(s.account.id);
    expect(row).toMatchObject({
      status: "disconnected",
      accessTokenEnc: null,
      refreshTokenEnc: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scopes: [],
      username: null,
      displayName: null,
      avatarUrl: null,
      profileUrl: null,
      accountType: null,
      syncStartedAt: null,
      syncBlockedUntil: null,
      lastSyncError: null,
      lastSyncErrorAt: null,
      // What stays (03 §9.3): the ids, the provider and the account's platform id.
      id: s.account.id,
      provider: "mock",
      providerAccountId: s.account.providerAccountId,
    });
    expect(row.disconnectedAt).toBeInstanceOf(Date);
    expect(await postsOf(s.account.id)).toEqual([]);
  });

  it("scrubs a referenced post to stale, deletes the other 23 and leaves the video and its posting alone (b)", async () => {
    const s = await syncedDemo();
    const { post, video: before, posting } = await publishedVideoOnPost01(s);
    expect((await countLiveVideosByAccount(s.actor)).get(s.account.id)).toBe(1);

    await disconnectSocialAccount(s.account.id, s.actor);
    const rows = await postsOf(s.account.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      ...post,
      status: "stale",
      title: null,
      caption: null,
      thumbnailUrl: null,
      thumbnailFetchedAt: null,
      thumbnailExpiresAt: null,
      postedAt: null,
      durationSec: null,
      width: null,
      height: null,
      viewCount: null,
      likeCount: null,
      commentCount: null,
      shareCount: null,
      visibility: null,
      updatedAt: expect.any(Date),
    });
    const [videoNow] = await db
      .select()
      .from(video)
      .where(eq(video.id, before.id));
    expect(videoNow).toEqual(before);
    const [postingNow] = await db
      .select()
      .from(videoPosting)
      .where(eq(videoPosting.id, posting.id));
    expect(postingNow).toEqual(posting);
    expect(postingNow).toMatchObject({ verification: "verified" });
  });

  it("revokes once, and a revoke that throws still disconnects with revoked failed (c)", async () => {
    const s = await demoAccount();
    const revoke = vi.spyOn(mockProvider, "revoke");
    await disconnectSocialAccount(s.account.id, s.actor);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke.mock.calls[0]?.[0]).toMatchObject({
      accessToken: expect.stringMatching(/^mock_access_/),
      refreshToken: expect.stringMatching(/^mock_refresh_/),
    });

    const t = await demoAccount();
    vi.spyOn(mockProvider, "revoke").mockRejectedValue(new Error("down"));
    expect(await disconnectSocialAccount(t.account.id, t.actor)).toEqual({
      revoked: "failed",
    });
    expect((await accountRow(t.account.id)).status).toBe("disconnected");
  });

  it("writes one audit row with ids only (d), and a second call is a no-op (e)", async () => {
    const s = await demoAccount();
    await disconnectSocialAccount(s.account.id, s.actor);
    const revoke = vi.spyOn(mockProvider, "revoke");
    expect(await disconnectSocialAccount(s.account.id, s.actor)).toEqual({
      revoked: "unsupported",
    });
    expect(revoke).not.toHaveBeenCalled();
    expect(await auditsOf(s.account.id, "social_account.disconnected")).toEqual(
      [
        {
          actorType: "creator",
          data: {
            socialAccountId: s.account.id,
            provider: "mock",
            revoked: "revoked",
          },
        },
      ],
    );
  });

  it("refreshes an expired token before the revoke, and never marks the account when that fails", async () => {
    const fresh = await expiredDemo();
    const refresh = vi.spyOn(mockProvider, "refreshToken");
    expect(
      await disconnectSocialAccount(fresh.account.id, fresh.actor),
    ).toEqual({
      revoked: "revoked",
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    const s = await expiredDemo();
    setMockScenarioForTests("expired");
    expect(await disconnectSocialAccount(s.account.id, s.actor)).toEqual({
      revoked: "failed",
    });
    expect((await accountRow(s.account.id)).status).toBe("disconnected");
    expect(
      await auditsOf(s.account.id, "social_account.needs_reconnect"),
    ).toEqual([]);
  });

  it("records unsupported, with no platform call, when there is nothing to revoke", async () => {
    // A needs_reconnect account whose token expired can't be refreshed; the purge cron (07 D47) leaves none at all.
    const expired = await expiredDemo();
    const wiped = await demoAccount();
    await db
      .update(socialAccount)
      .set({ status: "needs_reconnect" })
      .where(eq(socialAccount.id, expired.account.id));
    await db
      .update(socialAccount)
      .set({
        status: "needs_reconnect",
        accessTokenEnc: null,
        refreshTokenEnc: null,
      })
      .where(eq(socialAccount.id, wiped.account.id));
    const refresh = vi.spyOn(mockProvider, "refreshToken");
    const revoke = vi.spyOn(mockProvider, "revoke");
    for (const s of [expired, wiped]) {
      expect(await disconnectSocialAccount(s.account.id, s.actor)).toEqual({
        revoked: "unsupported",
      });
      expect((await accountRow(s.account.id)).status).toBe("disconnected");
      expect(
        await auditsOf(s.account.id, "social_account.disconnected"),
      ).toEqual([
        {
          actorType: "creator",
          data: {
            socialAccountId: s.account.id,
            provider: "mock",
            revoked: "unsupported",
          },
        },
      ]);
    }
    expect(refresh).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("never writes a token to the logs or the console (J2.19)", async () => {
    const s = await demoAccount();
    const written: string[] = [];
    const capture = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        written.push(args.map(String).join(" "));
      });
    }
    vi.spyOn(mockProvider, "revoke").mockRejectedValue(new Error("down"));
    await disconnectSocialAccount(s.account.id, s.actor);
    expect(written.join("")).toContain("social.revoke_failed");
    expect(written.join("")).not.toMatch(/mock_access_|mock_refresh_/);
  });

  it("refuses another creator's account", async () => {
    const s = await demoAccount();
    const stranger = await demoAccount();
    const revoke = vi.spyOn(mockProvider, "revoke");
    expect(
      await disconnectSocialAccount(s.account.id, stranger.actor),
    ).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
    expect((await accountRow(s.account.id)).status).toBe("connected");
  });

  it("stops a sync that is running, so nothing comes back after the disconnect (owner answer Q-17 a)", async () => {
    const { account, actor } = await demoAccount();
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const real = mockProvider.listPosts.bind(mockProvider);
    vi.spyOn(mockProvider, "listPosts").mockImplementationOnce(
      async (token, input) => {
        entered.resolve();
        await gate.promise;
        return real(token, input);
      },
    );
    const running = syncSocialAccount(account.id, actor);
    await entered.promise;
    await disconnectSocialAccount(account.id, actor);
    gate.resolve();
    expect(await running).toEqual({ ok: false, reason: "not_found" });
    const row = await accountRow(account.id);
    expect(row).toMatchObject({
      status: "disconnected",
      username: null,
      avatarUrl: null,
      syncStartedAt: null,
      lastSyncedAt: null,
    });
    expect(await postsOf(account.id)).toEqual([]);
  });
});

describe("the disconnectAccount action", () => {
  it("sends a signed-out caller to sign in and disconnects nothing", async () => {
    const { disconnectAccount } = await import(
      "../../../src/app/(dashboard)/dashboard/_actions/social"
    );
    const { account } = await demoAccount();
    const revoke = vi.spyOn(mockProvider, "revoke");
    mockNextHeaders(null);
    await expect(
      disconnectAccount({ socialAccountId: account.id }),
    ).rejects.toMatchObject(
      redirectTo("/sign-in?next=%2Fdashboard%2Fconnections"),
    );
    expect(revoke).not.toHaveBeenCalled();
    const row = await accountRow(account.id);
    expect(row.status).toBe("connected");
    expect(row.accessTokenEnc).toBe(account.accessTokenEnc);
    expect(row.refreshTokenEnc).toBe(account.refreshTokenEnc);
  });

  it("disconnects the creator's account, refuses another's, and refreshes the page", async () => {
    const { disconnectAccount } = await import(
      "../../../src/app/(dashboard)/dashboard/_actions/social"
    );
    const { refresh } = await import("next/cache");
    vi.mocked(refresh).mockClear();
    const me = await signedInCreator();
    const mine = await insertDemoAccount({
      id: me.creatorId,
      userId: me.userId,
    });
    const { account: stranger } = await demoAccount();

    expect(await disconnectAccount({ socialAccountId: "nope" })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
    expect(
      await disconnectAccount({ socialAccountId: stranger.id }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(refresh).not.toHaveBeenCalled();

    expect(await disconnectAccount({ socialAccountId: mine.id })).toEqual({
      ok: true,
      data: { revoked: "revoked" },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await accountRow(mine.id)).status).toBe("disconnected");
    expect((await accountRow(stranger.id)).status).toBe("connected");
  });
});

describe("after a disconnect", () => {
  it("reconnecting the same account brings the same row back with 24 posts (f, J2.16)", async () => {
    const me = await signedInCreator();
    const first = await connectedDemo(me.creatorId);
    await disconnectSocialAccount(first.id, me.actor);

    expect(location(await connect())).toBe(
      at("/dashboard/connections?connected=mock"),
    );
    const rows = await accountsOf(me.creatorId);
    expect(rows.map((r) => r.id)).toEqual([first.id]);
    expect(rows[0]).toMatchObject({
      status: "connected",
      username: "demo.creator",
      disconnectedAt: null,
    });
    const posts = await postsOf(first.id);
    expect(posts).toHaveLength(24);
    expect(posts.every((p) => p.status === "available")).toBe(true);
  });

  it("lets another creator connect an account the first one disconnected (g, J2.7)", async () => {
    setMockScenarioForTests("shared_account");
    const a = await signedInCreator();
    const shared = await connectedDemo(a.creatorId);

    await signedInCreator();
    expect(location(await connect())).toBe(
      at("/dashboard/connections?error=already_linked"),
    );
    await disconnectSocialAccount(shared.id, a.actor);

    const b = await signedInCreator();
    expect(location(await connect())).toBe(
      at("/dashboard/connections?connected=mock"),
    );
    const [mine] = await accountsOf(b.creatorId);
    expect(mine).toMatchObject({
      providerAccountId: "mock_acct_shared",
      status: "connected",
    });
    expect(mine?.id).not.toBe(shared.id);
    const [{ live } = { live: 0 }] = await db
      .select({ live: sql<number>`count(*)::int` })
      .from(socialAccount)
      .where(
        and(
          eq(socialAccount.providerAccountId, "mock_acct_shared"),
          sql`${socialAccount.status} <> 'disconnected'`,
        ),
      );
    expect(live).toBe(1);
  });
});
