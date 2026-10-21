import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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
import { socialAccount, socialPost, video } from "../../../src/db/schema";
import { MINUTE_MS } from "../../../src/lib/time";
import {
  SocialAuthError,
  SocialUpstreamError,
} from "../../../src/server/social/errors";
import {
  mockProvider,
  mockTokensFor,
  setMockScenarioForTests,
} from "../../../src/server/social/providers/mock";
import {
  SOCIAL_SYNC_MAX_PAGES,
  syncSocialAccount,
} from "../../../src/server/social/sync";
import { storeTokens } from "../../../src/server/social/tokens";
import { redirectTo } from "../../helpers/actions";
import { mockNextHeaders, signedInCreator } from "../../helpers/auth";
import {
  accountRow,
  accountsOf,
  at,
  auditsOf,
  connect,
  type Demo,
  demoAccount,
  disconnectWhere,
  location,
  postNumber,
  postsOf,
} from "../../helpers/connect-flow";
import { resetDb } from "../../helpers/db";
import {
  insertLibraryVideo,
  insertUploadVideo,
  insertVideoPosting,
} from "../../helpers/factories";
import { captureLogEvents } from "../../helpers/logs";

// The sync engine under every mock scenario (02 §7.5, 03 §7.2, 07 D02, D13, D68, D72), against the test database. Each
// case has its own creator and Demo account, with mock tokens sealed as the callback seals them.
vi.mock("next/headers", () => import("../../helpers/next-headers"));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));

afterAll(resetDb);
beforeEach(() => mockNextHeaders(null));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setMockScenarioForTests(null);
});

const sync = (d: Demo, opts?: Parameters<typeof syncSocialAccount>[2]) =>
  syncSocialAccount(d.account.id, d.actor, opts);

const OK_FULL = {
  ok: true,
  fetched: 24,
  kept: 24,
  upserted: 24,
  removed: 0,
  hasOlder: false,
};

describe("default", () => {
  it("stores 24 available posts, and a second sync adds none (J3.8)", async () => {
    const d = await demoAccount();
    expect(await sync(d)).toEqual({ ...OK_FULL, added: 24 });
    const after = await accountRow(d.account.id);
    expect(after).toMatchObject({
      status: "connected",
      hasOlder: false,
      lastSyncError: null,
      syncStartedAt: null,
    });
    expect(after.lastSyncedAt).toBeInstanceOf(Date);
    const rows = await postsOf(d.account.id);
    expect(rows).toHaveLength(24);
    for (const row of rows) {
      expect(row).toMatchObject({ status: "available", removedAt: null });
      expect(row.linkKey).toBe(row.providerPostId);
      expect(row.permalink).toBe(
        `https://example.com/mock/${row.providerPostId}`,
      );
    }

    expect(await sync(d)).toEqual({ ...OK_FULL, added: 0 });
    expect(await postsOf(d.account.id)).toHaveLength(24);
    const [nulls] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(socialPost)
      .where(sql`${socialPost.linkKey} is null`);
    expect(nulls?.n).toBe(0);
  });

  it("reads the profile first and saves a changed username", async () => {
    const d = await demoAccount();
    const real = mockProvider.getProfile.bind(mockProvider);
    const profile = vi
      .spyOn(mockProvider, "getProfile")
      .mockImplementation(async (token) => ({
        ...(await real(token)),
        username: "demo.renamed",
        displayName: "Demo Renamed",
      }));
    const list = vi.spyOn(mockProvider, "listPosts");
    await sync(d);
    expect(await accountRow(d.account.id)).toMatchObject({
      username: "demo.renamed",
      displayName: "Demo Renamed",
    });
    expect(profile.mock.invocationCallOrder[0]).toBeLessThan(
      list.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("refuses another creator's account, and a disconnected one, without a platform call", async () => {
    const d = await demoAccount();
    const stranger = await demoAccount();
    const profile = vi.spyOn(mockProvider, "getProfile");
    expect(await syncSocialAccount(d.account.id, stranger.actor)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await syncSocialAccount(randomUUID(), d.actor)).toEqual({
      ok: false,
      reason: "not_found",
    });
    await disconnectWhere(eq(socialAccount.id, d.account.id));
    expect(await sync(d)).toEqual({ ok: false, reason: "not_found" });
    expect(profile).not.toHaveBeenCalled();
  });

  it("stores platform text without NUL bytes, and leaves out a post whose id holds one", async () => {
    const d = await demoAccount();
    // The spies sit under the registry's cleaning (text.ts), as a real adapter's answers would.
    const realProfile = mockProvider.getProfile.bind(mockProvider);
    vi.spyOn(mockProvider, "getProfile").mockImplementation(async (token) => ({
      ...(await realProfile(token)),
      username: "demo\u0000creator",
      avatarUrl: "mock://avatar/\u000001",
    }));
    const realList = mockProvider.listPosts.bind(mockProvider);
    vi.spyOn(mockProvider, "listPosts").mockImplementation(async (t, i) => {
      const page = await realList(t, i);
      return {
        ...page,
        posts: page.posts.map((post) => {
          if (post.externalId.endsWith("_01")) {
            return {
              ...post,
              title: "Bay\u0000",
              caption: "Morning\u0000 light",
            };
          }
          if (post.externalId.endsWith("_02")) {
            return { ...post, externalId: `${post.externalId}\u0000` };
          }
          return post;
        }),
      };
    });
    const logs = captureLogEvents("social.post_skipped");
    const result = await sync(d);
    const { events } = logs();
    expect(result).toMatchObject({
      ok: true,
      fetched: 23,
      kept: 23,
      upserted: 23,
    });
    expect(events).toEqual([
      expect.objectContaining({ level: "warn", provider: "mock", count: 1 }),
    ]);
    expect(await accountRow(d.account.id)).toMatchObject({
      username: "democreator",
      avatarUrl: null,
    });
    expect(await postNumber(d.account.id, "01")).toMatchObject({
      title: "Bay",
      caption: "Morning light",
    });
    expect(await postsOf(d.account.id)).toHaveLength(23);
  });

  it("lets the system actor sync any account", async () => {
    const d = await demoAccount();
    const result = await syncSocialAccount(d.account.id, {
      kind: "system",
      source: "seed",
    });
    expect(result).toMatchObject({ ok: true, kept: 24 });
  });
});

describe("maxPosts and older runs (07 D13)", () => {
  it("counts kept videos: 12, then an older run fetches the rest", async () => {
    const d = await demoAccount();
    expect(await sync(d, { maxPosts: 12 })).toEqual({
      ok: true,
      fetched: 12,
      kept: 12,
      upserted: 12,
      added: 12,
      removed: 0,
      hasOlder: true,
    });
    expect(await postsOf(d.account.id)).toHaveLength(12);
    expect((await accountRow(d.account.id)).hasOlder).toBe(true);

    expect(await sync(d, { mode: "older" })).toEqual({
      ok: true,
      fetched: 12,
      kept: 12,
      upserted: 12,
      added: 12,
      removed: 0,
      hasOlder: false,
    });
    expect(await postsOf(d.account.id)).toHaveLength(24);
    expect((await accountRow(d.account.id)).hasOlder).toBe(false);
  });

  it("upserts only maxPosts − kept of the last page, and then hasn't reached the end", async () => {
    const d = await demoAccount();
    expect(await sync(d, { maxPosts: 20 })).toMatchObject({
      fetched: 24,
      kept: 20,
      upserted: 20,
      hasOlder: true,
    });
    expect(await postsOf(d.account.id)).toHaveLength(20);
  });

  it("counts videos, not the other items a platform lists", async () => {
    const d = await demoAccount();
    const real = mockProvider.listPosts.bind(mockProvider);
    vi.spyOn(mockProvider, "listPosts").mockImplementation(async (t, i) => {
      const page = await real(t, i);
      const [newest] = page.posts;
      if (!newest) return page;
      const photo = {
        ...newest,
        externalId: `${newest.externalId}_photo`,
        kind: "image",
      } as unknown as (typeof page.posts)[number];
      return { ...page, posts: [photo, ...page.posts] };
    });
    expect(await sync(d, { maxPosts: 12 })).toMatchObject({
      fetched: 13,
      kept: 12,
      upserted: 12,
      hasOlder: true,
    });
    const rows = await postsOf(d.account.id);
    expect(rows).toHaveLength(12);
    expect(rows.some((r) => r.providerPostId.endsWith("_photo"))).toBe(false);
  });

  it("stops at SOCIAL_SYNC_MAX_PAGES pages, and when the budget is spent, without a sweep", async () => {
    const d = await demoAccount();
    const real = mockProvider.listPosts.bind(mockProvider);
    // A platform that always has one more page: one post per page, never the end.
    const endless = vi
      .spyOn(mockProvider, "listPosts")
      .mockImplementation(async (token, input) => {
        const page = Number(input.cursor ?? "0");
        const { posts } = await real(token, { cursor: null });
        const post = posts[page % posts.length];
        if (!post) throw new Error("no mock post");
        const id = `${post.externalId}_p${page}`;
        return {
          posts: [{ ...post, externalId: id, linkKey: id }],
          nextCursor: String(page + 1),
        };
      });
    expect(await sync(d)).toMatchObject({
      ok: true,
      fetched: SOCIAL_SYNC_MAX_PAGES,
      kept: SOCIAL_SYNC_MAX_PAGES,
      hasOlder: true,
    });
    expect(endless).toHaveBeenCalledTimes(SOCIAL_SYNC_MAX_PAGES);

    endless.mockClear();
    expect(await sync(d, { budgetMs: 0 })).toMatchObject({
      ok: true,
      fetched: 1,
      removed: 0,
      hasOlder: true,
    });
    expect(endless).toHaveBeenCalledTimes(1);
  });

  it("an older run never sweeps: the newer posts it never listed stay, even one the platform removed", async () => {
    const d = await demoAccount();
    await sync(d, { maxPosts: 12 });
    setMockScenarioForTests("post_removed");
    expect(await sync(d, { mode: "older", maxPosts: 50 })).toMatchObject({
      ok: true,
      removed: 0,
      hasOlder: false,
    });
    expect(await postsOf(d.account.id)).toHaveLength(24);
    expect(await postNumber(d.account.id, "05")).toMatchObject({
      status: "available",
    });

    // Nothing older is left: the run lists nothing and still deletes nothing.
    expect(await sync(d, { mode: "older" })).toMatchObject({
      ok: true,
      fetched: 0,
      removed: 0,
      hasOlder: false,
    });
    expect(await postsOf(d.account.id)).toHaveLength(24);
  });
});

describe("removal sweep (07 D13, D72)", () => {
  it("runs only after the list ended: a capped post_removed run deletes nothing, a full one deletes post 05", async () => {
    const d = await demoAccount();
    await sync(d);
    setMockScenarioForTests("post_removed");
    expect(await sync(d, { maxPosts: 12 })).toMatchObject({
      ok: true,
      removed: 0,
      hasOlder: true,
    });
    expect(await postsOf(d.account.id)).toHaveLength(24);

    expect(await sync(d)).toMatchObject({ ok: true, removed: 1 });
    const rows = await postsOf(d.account.id);
    expect(rows).toHaveLength(23);
    expect(rows.some((r) => r.providerPostId.endsWith("_05"))).toBe(false);
  });

  it("post_removed with a video on post 05: removed, not deleted, once audited, the video untouched (J3.9)", async () => {
    const d = await demoAccount();
    await sync(d);
    const post05 = await postNumber(d.account.id, "05");
    const { video: before } = await insertLibraryVideo(d.account, post05);
    const getPost = vi.spyOn(mockProvider, "getPost");
    setMockScenarioForTests("post_removed");
    expect(await sync(d)).toMatchObject({ ok: true, removed: 1 });

    const after = await postNumber(d.account.id, "05");
    expect(after.status).toBe("removed");
    expect(after.removedAt).toBeInstanceOf(Date);
    expect(await postsOf(d.account.id)).toHaveLength(24);
    expect(getPost).toHaveBeenCalledTimes(1);
    expect(await auditsOf(post05.id, "social_post.removed")).toEqual([
      {
        actorType: "creator",
        data: { socialPostId: post05.id, socialAccountId: d.account.id },
      },
    ]);
    const [videoNow] = await db
      .select()
      .from(video)
      .where(eq(video.id, before.id));
    expect(videoNow).toEqual(before);
    expect((await accountRow(d.account.id)).lastSyncError).toBeNull();

    // Listed again later: available again.
    setMockScenarioForTests(null);
    await sync(d);
    expect(await postNumber(d.account.id, "05")).toMatchObject({
      status: "available",
      removedAt: null,
    });
  });

  it("counts any posting as a reference: an unverified one keeps its post through an empty list", async () => {
    const d = await demoAccount();
    await sync(d);
    const post05 = await postNumber(d.account.id, "05");
    const upload = await insertUploadVideo({ id: d.account.creatorId });
    await insertVideoPosting(upload, {
      platform: "mock",
      url: post05.permalink,
      linkKey: post05.linkKey,
      socialPostId: post05.id,
    });
    setMockScenarioForTests("empty");
    expect(await sync(d)).toMatchObject({ ok: true, fetched: 0, removed: 24 });
    const rows = await postsOf(d.account.id);
    expect(rows.map((r) => [r.id, r.status])).toEqual([[post05.id, "removed"]]);
  });

  it("pinned_old_post: getPost finds post 24, so it stays available with no removal audit", async () => {
    const d = await demoAccount();
    await sync(d);
    const post24 = await postNumber(d.account.id, "24");
    await insertLibraryVideo(d.account, post24);
    const getPost = vi.spyOn(mockProvider, "getPost");
    setMockScenarioForTests("pinned_old_post");
    expect(await sync(d)).toMatchObject({ ok: true, removed: 0 });
    expect(getPost).toHaveBeenCalledWith(
      expect.any(String),
      post24.providerPostId,
      d.account.providerAccountId,
    );
    expect(await postNumber(d.account.id, "24")).toMatchObject({
      status: "available",
    });
    expect(await auditsOf(post24.id, "social_post.removed")).toEqual([]);
    expect(await postsOf(d.account.id)).toHaveLength(24);
  });

  it("keeps a referenced post when getPost fails, and the run still succeeds", async () => {
    const d = await demoAccount();
    await sync(d);
    const post05 = await postNumber(d.account.id, "05");
    await insertLibraryVideo(d.account, post05);
    vi.spyOn(mockProvider, "getPost").mockRejectedValue(
      new SocialUpstreamError(),
    );
    setMockScenarioForTests("post_removed");
    expect(await sync(d)).toMatchObject({ ok: true, removed: 0 });
    expect(await postNumber(d.account.id, "05")).toMatchObject({
      status: "available",
    });
    expect((await accountRow(d.account.id)).lastSyncError).toBeNull();
  });

  it("keeps a referenced post when getPost answers it with a NUL in its permalink: a failed check, never gone", async () => {
    const d = await demoAccount();
    await sync(d);
    const post24 = await postNumber(d.account.id, "24");
    await insertLibraryVideo(d.account, post24);
    const realGet = mockProvider.getPost.bind(mockProvider);
    vi.spyOn(mockProvider, "getPost").mockImplementation(async (...args) => {
      const post = await realGet(...args);
      return post && { ...post, permalink: `${post.permalink}\u0000` };
    });
    setMockScenarioForTests("pinned_old_post");
    const logs = captureLogEvents("social.sweep_check_failed");
    expect(await sync(d)).toMatchObject({ ok: true, removed: 0 });
    expect(logs().events).toEqual([
      expect.objectContaining({
        level: "warn",
        socialAccountId: d.account.id,
        error: "SocialUpstreamError",
      }),
    ]);
    expect(await postNumber(d.account.id, "24")).toMatchObject({
      status: "available",
    });
    expect(await auditsOf(post24.id, "social_post.removed")).toEqual([]);
  });

  it("empty after a sync: unreferenced posts deleted, the account still connected", async () => {
    const d = await demoAccount();
    await sync(d);
    setMockScenarioForTests("empty");
    expect(await sync(d)).toMatchObject({ ok: true, removed: 24 });
    expect(await postsOf(d.account.id)).toEqual([]);
    expect((await accountRow(d.account.id)).status).toBe("connected");
  });
});

describe("errors (07 D02)", () => {
  it("rate_limited: blocks the account for 900 s, keeps the cache and the status (J2.13)", async () => {
    const d = await demoAccount();
    await sync(d);
    setMockScenarioForTests("rate_limited");
    expect(await sync(d)).toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterSec: 900,
    });
    const row = await accountRow(d.account.id);
    expect(row).toMatchObject({
      status: "connected",
      lastSyncError: "rate_limited",
      syncStartedAt: null,
    });
    expect(row.lastSyncErrorAt).toBeInstanceOf(Date);
    const blockedFor = (row.syncBlockedUntil?.getTime() ?? 0) - Date.now();
    expect(blockedFor).toBeGreaterThan(880_000);
    expect(blockedFor).toBeLessThanOrEqual(905_000);
    expect(await postsOf(d.account.id)).toHaveLength(24);

    const list = vi.spyOn(mockProvider, "listPosts");
    const again = await sync(d);
    expect(again).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(again.ok === false && again.retryAfterSec).toBeGreaterThan(880);
    expect(list).not.toHaveBeenCalled();
  });

  it("expired: needs_reconnect, cache kept, and the next call makes no platform call (J2.10)", async () => {
    const d = await demoAccount();
    await sync(d);
    setMockScenarioForTests("expired");
    expect(await sync(d)).toEqual({ ok: false, reason: "needs_reconnect" });
    expect(await accountRow(d.account.id)).toMatchObject({
      status: "needs_reconnect",
      syncStartedAt: null,
    });
    expect(await postsOf(d.account.id)).toHaveLength(24);
    expect(
      await auditsOf(d.account.id, "social_account.needs_reconnect"),
    ).toEqual([
      {
        actorType: "system",
        data: { socialAccountId: d.account.id, source: "lazy" },
      },
    ]);

    const calls = [
      vi.spyOn(mockProvider, "getProfile"),
      vi.spyOn(mockProvider, "listPosts"),
      vi.spyOn(mockProvider, "refreshToken"),
    ];
    expect(await sync(d)).toEqual({ ok: false, reason: "needs_reconnect" });
    for (const call of calls) expect(call).not.toHaveBeenCalled();
  });

  it("upstream: records the error, keeps the status and the cache (J2.17)", async () => {
    const d = await demoAccount();
    await sync(d);
    vi.spyOn(mockProvider, "listPosts").mockRejectedValue(
      new SocialUpstreamError(),
    );
    expect(await sync(d)).toEqual({ ok: false, reason: "upstream_error" });
    const row = await accountRow(d.account.id);
    expect(row).toMatchObject({
      status: "connected",
      lastSyncError: "upstream",
      syncStartedAt: null,
    });
    expect(row.lastSyncErrorAt).toBeInstanceOf(Date);
    expect(await postsOf(d.account.id)).toHaveLength(24);

    // The next good sync clears the error.
    vi.restoreAllMocks();
    expect(await sync(d)).toMatchObject({ ok: true });
    expect((await accountRow(d.account.id)).lastSyncError).toBeNull();
  });

  it("retries once with the token another request stored meanwhile (02 §7.4 step 3b)", async () => {
    const d = await demoAccount();
    const newer = mockTokensFor(d.userId, "t2");
    // Another request's refresh, stamped a minute later, lands just before the platform refuses the old token.
    const list = vi
      .spyOn(mockProvider, "listPosts")
      .mockImplementationOnce(async () => {
        await storeTokens(
          db,
          d.account.id,
          newer,
          new Date(Date.now() + MINUTE_MS),
        );
        throw new SocialAuthError();
      });
    expect(await sync(d)).toMatchObject({ ok: true, kept: 24 });
    expect(list.mock.calls[1]?.[0]).toBe(newer.accessToken);
    expect((await accountRow(d.account.id)).status).toBe("connected");
  });

  it("an auth failure with no newer token marks the account needs_reconnect", async () => {
    const d = await demoAccount();
    vi.spyOn(mockProvider, "listPosts").mockRejectedValue(
      new SocialAuthError(),
    );
    expect(await sync(d)).toEqual({ ok: false, reason: "needs_reconnect" });
    expect((await accountRow(d.account.id)).status).toBe("needs_reconnect");
  });
});

describe("single-flight lease (03 §7.2)", () => {
  it("answers already_syncing while a run holds the lease", async () => {
    const d = await demoAccount();
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
    const first = sync(d);
    await entered.promise;
    expect(await sync(d)).toEqual({ ok: false, reason: "already_syncing" });
    gate.resolve();
    expect(await first).toMatchObject({ ok: true, kept: 24 });
    expect((await accountRow(d.account.id)).syncStartedAt).toBeNull();
  });

  it("reads a block by the database's clock: an app clock running ahead still gets rate_limited", async () => {
    const d = await demoAccount();
    await db
      .update(socialAccount)
      .set({ syncBlockedUntil: sql`now() + interval '30 seconds'` })
      .where(eq(socialAccount.id, d.account.id));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + MINUTE_MS);
    const profile = vi.spyOn(mockProvider, "getProfile");
    const result = await sync(d);
    expect(result).toMatchObject({ ok: false, reason: "rate_limited" });
    expect(result.ok === false && result.retryAfterSec).toBeGreaterThan(20);
    expect(result.ok === false && result.retryAfterSec).toBeLessThanOrEqual(30);
    expect(profile).not.toHaveBeenCalled();
    expect((await accountRow(d.account.id)).syncStartedAt).toBeNull();
  });

  it("takes over a lease older than 2 minutes, never a newer one", async () => {
    const d = await demoAccount();
    const lease = (age: string) =>
      db
        .update(socialAccount)
        .set({ syncStartedAt: sql`now() - ${sql.raw(`interval '${age}'`)}` })
        .where(eq(socialAccount.id, d.account.id));
    await lease("1 minute");
    expect(await sync(d)).toEqual({ ok: false, reason: "already_syncing" });
    await lease("3 minutes");
    expect(await sync(d)).toMatchObject({ ok: true, kept: 24 });
    expect((await accountRow(d.account.id)).syncStartedAt).toBeNull();
  });
});

describe("the callback's first sync (07 D13)", () => {
  it("stores the posts before the redirect", async () => {
    const me = await signedInCreator();
    const response = await connect();
    expect(location(response)).toBe(
      at("/dashboard/connections?connected=mock"),
    );
    const [account] = await accountsOf(me.creatorId);
    if (!account) throw new Error("no account");
    expect(account.lastSyncedAt).toBeInstanceOf(Date);
    expect(await postsOf(account.id)).toHaveLength(24);
  });

  it("still says connected when the first sync finds the account must reconnect", async () => {
    setMockScenarioForTests("expired");
    const me = await signedInCreator();
    const response = await connect();
    expect(location(response)).toBe(
      at("/dashboard/connections?connected=mock"),
    );
    const [account] = await accountsOf(me.creatorId);
    expect(account?.status).toBe("needs_reconnect");
  });
});

describe("the sync actions (02 §6.1)", () => {
  it("sends a signed-out caller to sign in and syncs nothing", async () => {
    const { syncAccount, syncAllAccounts } = await import(
      "../../../src/app/(dashboard)/dashboard/_actions/social"
    );
    const d = await demoAccount();
    const profile = vi.spyOn(mockProvider, "getProfile");
    mockNextHeaders(null);
    await expect(
      syncAccount({ socialAccountId: d.account.id }),
    ).rejects.toMatchObject(
      redirectTo("/sign-in?next=%2Fdashboard%2Fconnections"),
    );
    await expect(syncAllAccounts()).rejects.toMatchObject(
      redirectTo("/sign-in?next=%2Fdashboard%2Flibrary"),
    );
    expect(profile).not.toHaveBeenCalled();
    expect(await accountRow(d.account.id)).toMatchObject({
      lastSyncedAt: null,
      syncStartedAt: null,
    });
    expect(await postsOf(d.account.id)).toEqual([]);
  });

  it("syncAccount syncs the creator's account and refreshes the page", async () => {
    const { syncAccount } = await import(
      "../../../src/app/(dashboard)/dashboard/_actions/social"
    );
    const { refresh } = await import("next/cache");
    vi.mocked(refresh).mockClear();
    const me = await signedInCreator();
    const mine = await demoAccount({ id: me.creatorId, userId: me.userId });
    expect((await accountRow(mine.account.id)).lastSyncedAt).toBeNull();

    const result = await syncAccount({ socialAccountId: mine.account.id });
    expect(result).toEqual({ ok: true, data: { ...OK_FULL, added: 24 } });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await accountRow(mine.account.id)).lastSyncedAt).toBeInstanceOf(
      Date,
    );

    const stranger = await demoAccount();
    expect(await syncAccount({ socialAccountId: stranger.account.id })).toEqual(
      { ok: true, data: { ok: false, reason: "not_found" } },
    );
    expect(await syncAccount({ socialAccountId: "nope" })).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });

  it("syncAllAccounts syncs every connected account and names each", async () => {
    const { syncAllAccounts } = await import(
      "../../../src/app/(dashboard)/dashboard/_actions/social"
    );
    const me = await signedInCreator();
    const owner = { id: me.creatorId, userId: me.userId };
    const first = await demoAccount(owner);
    const second = await demoAccount(owner, { second: true });
    const result = await syncAllAccounts();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((r) => r.socialAccountId).sort()).toEqual(
      [first.account.id, second.account.id].sort(),
    );
    for (const r of result.data) expect(r.result).toMatchObject({ ok: true });
  });
});

describe("tokens at rest (J2.19)", () => {
  it("no account, post or audit row holds a mock token in the clear", async () => {
    for (const table of ["social_account", "social_post", "audit_event"]) {
      const { rows } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} t where t::text ~ 'mock_(access|refresh)_'`,
      );
      expect({ table, n: rows[0]?.n }).toEqual({ table, n: 0 });
    }
    const [accounts] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(socialAccount);
    expect(accounts?.n).toBeGreaterThan(10);
  });
});
