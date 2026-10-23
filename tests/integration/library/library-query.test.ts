import { randomUUID } from "node:crypto";
import { eq, inArray, type SQL, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { db } from "../../../src/db/client";
import { socialAccount, socialPost } from "../../../src/db/schema";
import {
  encodeLibraryCursor,
  getLibraryPost,
  LibraryFilterSchema,
  listAccountSummaries,
  listLibraryPosts,
  queryLibraryPage,
} from "../../../src/server/library/queries";
import {
  mockProvider,
  mockTokensFor,
} from "../../../src/server/social/providers/mock";
import { MOCK_ANCHOR } from "../../../src/server/social/providers/mock-data";
import {
  syncSocialAccount,
  upsertPosts,
} from "../../../src/server/social/sync";
import type { SocialPost } from "../../../src/server/social/types";
import { bareCreator } from "../../helpers/auth";
import { demoAccount, postNumber, postsOf } from "../../helpers/connect-flow";
import {
  insertLibraryVideo,
  insertSocialAccount,
  insertSocialPost,
  insertUploadVideo,
  insertVideoPosting,
  publishVideo,
} from "../../helpers/factories";
import {
  cursorAfter,
  ids,
  libraryOrder,
  MOCK_POST_NUMBERS,
  postNo,
  readAllPages,
  syncedDemo,
  twoSyncedDemos,
} from "../../helpers/library";

// The Library query (02 §5.4, 03 §7.2; 07 D13, D48, D72) against the test database. Each case has its own creator;
// the Demo accounts are synced through the mock provider (24 posts, newest first: 01 … 24).

const SNOW_CAPTION =
  "He saw snow for the first time and lost it #dogs #firstsnow";
/** Read by the database's clock, the one visiblePostsWhere uses. */
const DAYS_AGO_31 = sql`now() - interval '31 days'`;

/** The URL's params, through the page's parser. */
const filterOf = (params: Record<string, string | string[]>) =>
  LibraryFilterSchema.parse(params);

const updatePosts = (set: PgUpdateSetSource<typeof socialPost>, where: SQL) =>
  db.update(socialPost).set(set).where(where);

/** The proxy URL with the stored thumbnail's version in the query, so a new one gets past the browser's cache. */
const thumbnailSrcOf = (id: string, version: string | null | undefined) =>
  `/api/library/thumbnails/${id}?v=${encodeURIComponent(version ?? "")}`;

describe("listLibraryPosts: order and the tile DTO (03 §7.2)", () => {
  it("lists a synced Demo account's 24 posts newest first, post 01 first, with no next page", async () => {
    const d = await syncedDemo();
    const post01 = await postNumber(d.account.id, "01");
    const library = await listLibraryPosts(d.actor, {});

    expect(library.posts.map(postNo)).toEqual(MOCK_POST_NUMBERS);
    expect(ids(library.posts)).toEqual(ids(libraryOrder(library.posts)));
    expect(library.nextCursor).toBeNull();
    expect(library.posts[0]).toEqual({
      id: post01.id,
      platform: "mock",
      accountUsername: "demo.creator",
      kind: "video",
      title: null,
      captionExcerpt: SNOW_CAPTION,
      permalink: post01.permalink,
      thumbnailSrc: thumbnailSrcOf(
        post01.id,
        post01.thumbnailFetchedAt?.toISOString(),
      ),
      thumbnailVersion: post01.thumbnailFetchedAt?.toISOString(),
      width: 720,
      height: 1280,
      postedAt: new Date(MOCK_ANCHOR).toISOString(),
      durationSec: 14,
      viewCount: 14_800_000,
      likeCount: 888_000,
      commentCount: 44_400,
      visibility: "public",
      fetchedAt: post01.fetchedAt.toISOString(),
      video: null,
    });
    expect(library.platformCounts).toEqual({ mock: 24 });
    expect(library.visibleCount).toBe(24);
    expect(library.allExpired).toBe(false);
    expect(library.accounts).toHaveLength(1);
    expect(library.accounts[0]).toMatchObject({
      id: d.account.id,
      platform: "mock",
      username: "demo.creator",
      status: "connected",
      postCount: 24,
      stale: false,
    });
  });

  it("gives a post without a stored thumbnail a null thumbnailSrc", async () => {
    const d = await syncedDemo();
    const post05 = await postNumber(d.account.id, "05");
    await updatePosts({ thumbnailUrl: null }, eq(socialPost.id, post05.id));
    const { posts } = await listLibraryPosts(d.actor, {});
    expect(posts.find((p) => p.id === post05.id)?.thumbnailSrc).toBeNull();
    expect(
      posts.filter((p) => p.id !== post05.id).map((p) => p.thumbnailSrc),
    ).toEqual(
      posts
        .filter((p) => p.id !== post05.id)
        .map((p) => thumbnailSrcOf(p.id, p.thumbnailVersion)),
    );
  });
});

describe("filters (07 D48)", () => {
  it("narrows to one platform with ?platform=, while the chips count every platform", async () => {
    const d = await syncedDemo();
    const youtube = await insertSocialAccount(
      { id: d.account.creatorId },
      { provider: "youtube", username: "yt.creator" },
    );
    // Posted now: newer than every mock post.
    const short = await insertSocialPost(youtube, {
      mediaType: "short",
      title: "A YouTube short",
      thumbnailUrl: "https://i.ytimg.com/vi/abc/hqdefault.jpg",
    });

    const all = await listLibraryPosts(d.actor, {});
    expect(all.posts[0]?.id).toBe(short.id);
    expect(all.posts).toHaveLength(24);
    expect(all.nextCursor).not.toBeNull();
    expect(all.platformCounts).toEqual({ mock: 24, youtube: 1 });

    const mock = await listLibraryPosts(
      d.actor,
      filterOf({ platform: "mock" }),
    );
    expect(mock.posts.map(postNo)).toEqual(MOCK_POST_NUMBERS);
    expect(mock.posts.every((p) => p.platform === "mock")).toBe(true);
    expect(mock.nextCursor).toBeNull();
    expect(mock.platformCounts).toEqual({ mock: 24, youtube: 1 });

    const yt = await listLibraryPosts(
      d.actor,
      filterOf({ platform: "youtube" }),
    );
    expect(ids(yt.posts)).toEqual([short.id]);
    expect(yt.posts[0]).toMatchObject({
      platform: "youtube",
      kind: "short",
      title: "A YouTube short",
      accountUsername: "yt.creator",
    });
    expect(yt.nextCursor).toBeNull();

    expect(
      (await queryLibraryPage(d.actor, { platform: "tiktok" })).posts,
    ).toEqual([]);
  });

  it("narrows to one account with ?account=; another creator's account reads no posts", async () => {
    const { first, second } = await twoSyncedDemos();
    for (const [demo, username] of [
      [first, "demo.creator"],
      [second, "demo.creator.2"],
    ] as const) {
      const only = await listLibraryPosts(
        first.actor,
        filterOf({ account: demo.account.id }),
      );
      expect(only.posts.map(postNo)).toEqual(MOCK_POST_NUMBERS);
      expect(new Set(only.posts.map((p) => p.accountUsername))).toEqual(
        new Set([username]),
      );
      expect(new Set(ids(only.posts))).toEqual(
        new Set(ids(await postsOf(demo.account.id))),
      );
      expect(only.nextCursor).toBeNull();
      // The chips and the strip still show everything.
      expect(only.platformCounts).toEqual({ mock: 48 });
      expect(only.accounts).toHaveLength(2);
    }

    const other = await syncedDemo();
    for (const account of [other.account.id, randomUUID()]) {
      const foreign = await listLibraryPosts(
        first.actor,
        filterOf({ account }),
      );
      expect(foreign.posts).toEqual([]);
      expect(foreign.nextCursor).toBeNull();
    }
    expect(
      (
        await listLibraryPosts(
          other.actor,
          filterOf({ account: first.account.id }),
        )
      ).posts,
    ).toEqual([]);
  });

  it("searches captions case-insensitively, after trimming", async () => {
    const d = await syncedDemo();
    for (const q of ["SNOW", "snow", "  Snow "]) {
      const found = await listLibraryPosts(d.actor, filterOf({ q }));
      expect(found.posts.map(postNo), q).toEqual(["01"]);
      expect(found.posts[0]?.captionExcerpt).toBe(SNOW_CAPTION);
    }
    expect(
      (await listLibraryPosts(d.actor, filterOf({ q: "zzzz" }))).posts,
    ).toEqual([]);
  });

  it("treats %, _ and \\ in q literally, and searches titles too", async () => {
    const { creator, actor } = await bareCreator();
    const account = await insertSocialAccount(creator);
    const captions = [
      "100% real",
      "100 real",
      "snake_case",
      "snakeXcase",
      "back\\slash",
      "backslash",
    ];
    const idOf = new Map<string, string>();
    for (const caption of captions) {
      idOf.set(caption, (await insertSocialPost(account, { caption })).id);
    }
    const titled = await insertSocialPost(account, {
      title: "Weekend VLOG in Lisbon",
      caption: null,
    });
    const found = async (q: string) => {
      const f = filterOf({ q });
      expect(f.q).toBe(q);
      return new Set(ids((await listLibraryPosts(actor, f)).posts));
    };
    const only = (...keys: string[]) => new Set(keys.map((k) => idOf.get(k)));

    expect(await found("100%")).toEqual(only("100% real"));
    expect(await found("e_c")).toEqual(only("snake_case"));
    expect(await found("k\\s")).toEqual(only("back\\slash"));
    expect(await found("vlog")).toEqual(new Set([titled.id]));
    // The controls: without escaping, each pattern above would also match its look-alike.
    expect(await found("real")).toEqual(only("100% real", "100 real"));
    expect(await found("snake")).toEqual(only("snake_case", "snakeXcase"));
    expect(await found("slash")).toEqual(only("back\\slash", "backslash"));
  });
});

describe("keyset paging (03 §7.2)", () => {
  it("pages 48 posts (two Demo accounts) with no duplicates or gaps, posted_at desc then id desc", async () => {
    const { first, second } = await twoSyncedDemos();
    const pages = await readAllPages(first.actor);
    expect(pages.map((page) => page.length)).toEqual([24, 24]);

    const posts = pages.flat();
    const rows = [
      ...(await postsOf(first.account.id)),
      ...(await postsOf(second.account.id)),
    ];
    expect(new Set(ids(posts)).size).toBe(48);
    expect(new Set(ids(posts))).toEqual(new Set(ids(rows)));
    const jsOrder = libraryOrder(
      rows.map((r) => ({
        id: r.id,
        postedAt: r.postedAt?.toISOString() ?? null,
      })),
    );
    expect(ids(posts)).toEqual(ids(jsOrder));
    // Both accounts post at the same times, so every posted_at is a tie the id breaks.
    expect(posts.map(postNo)).toEqual(MOCK_POST_NUMBERS.flatMap((n) => [n, n]));

    // The page's first read hands out the same cursor.
    const library = await listLibraryPosts(first.actor, {});
    expect(ids(library.posts)).toEqual(ids(posts.slice(0, 24)));
    expect(library.nextCursor).toBe(cursorAfter(posts[23]));
  });

  it.each([25, 49])(
    "pages %i posts with the same posted_at by id alone, with no duplicates or gaps",
    async (n) => {
      const { creator, actor } = await bareCreator();
      const account = await insertSocialAccount(creator);
      const postedAt = new Date("2026-09-01T12:00:00.123Z");
      const inserted = await Promise.all(
        Array.from({ length: n }, () =>
          insertSocialPost(account, { postedAt }),
        ),
      );
      const pages = await readAllPages(actor);
      expect(pages.map((page) => page.length)).toEqual(
        n === 25 ? [24, 1] : [24, 24, 1],
      );
      const posts = pages.flat();
      expect(new Set(ids(posts)).size).toBe(n);
      expect(ids(posts)).toEqual(ids(inserted).sort().reverse());
      expect(new Set(posts.map((p) => p.postedAt))).toEqual(
        new Set([postedAt.toISOString()]),
      );
    },
  );

  it("reads the first page for a cursor that isn't one of ours", async () => {
    const d = await syncedDemo();
    const { posts } = await listLibraryPosts(d.actor, {});
    const valid = cursorAfter(posts[11]);
    expect(filterOf({ cursor: valid })).toEqual({ cursor: valid });
    expect(
      (await listLibraryPosts(d.actor, filterOf({ cursor: valid }))).posts.map(
        postNo,
      ),
    ).toEqual(MOCK_POST_NUMBERS.slice(12));

    for (const garbage of [
      "garbage",
      "%%%",
      `${valid}=`,
      Buffer.from(JSON.stringify({ p: "yesterday", i: "x" })).toString(
        "base64url",
      ),
    ]) {
      const f = filterOf({ cursor: garbage });
      expect(f, garbage).toEqual({});
      const page = await listLibraryPosts(d.actor, f);
      expect(page.posts.map(postNo), garbage).toEqual(MOCK_POST_NUMBERS);
    }
    // queryLibraryPage also reads a cursor it can't decode as none.
    expect(
      (await queryLibraryPage(d.actor, { cursor: "garbage" })).posts.map(
        postNo,
      ),
    ).toEqual(MOCK_POST_NUMBERS);
  });
});

describe("the 30-day rule and allExpired (07 D13)", () => {
  it("hides a post a sync last saw 31 days ago from the posts, the chips and the post count", async () => {
    const d = await syncedDemo();
    const post01 = await postNumber(d.account.id, "01");
    const post02 = await postNumber(d.account.id, "02");
    await updatePosts({ fetchedAt: DAYS_AGO_31 }, eq(socialPost.id, post01.id));
    await updatePosts(
      { fetchedAt: sql`now() - interval '29 days'` },
      eq(socialPost.id, post02.id),
    );

    const library = await listLibraryPosts(d.actor, {});
    expect(library.posts.map(postNo)).toEqual(MOCK_POST_NUMBERS.slice(1));
    expect(library.platformCounts).toEqual({ mock: 23 });
    expect(library.accounts.map((a) => a.postCount)).toEqual([23]);
    expect(library.allExpired).toBe(false);
    expect(
      (await listLibraryPosts(d.actor, filterOf({ q: "snow" }))).posts,
    ).toEqual([]);
  });

  it("says allExpired when the rule hides every post", async () => {
    const d = await syncedDemo();
    await updatePosts(
      { fetchedAt: DAYS_AGO_31 },
      eq(socialPost.socialAccountId, d.account.id),
    );
    const library = await listLibraryPosts(d.actor, {});
    expect(library).toMatchObject({
      posts: [],
      nextCursor: null,
      allExpired: true,
    });
    // Exact: inside toMatchObject an empty object matches any. The linked platform keeps its chip at 0 (05 §6.1).
    expect(library.platformCounts).toEqual({ mock: 0 });
    expect(library.visibleCount).toBe(0);
    expect(library.accounts.map((a) => a.postCount)).toEqual([0]);
  });

  it("is not allExpired when only stale or removed rows remain, or when there are no posts", async () => {
    const d = await syncedDemo();
    const rows = await postsOf(d.account.id);
    await updatePosts(
      { status: "removed", removedAt: new Date(), fetchedAt: DAYS_AGO_31 },
      inArray(socialPost.id, ids(rows.slice(0, 12))),
    );
    await updatePosts(
      { status: "stale", postedAt: null, fetchedAt: DAYS_AGO_31 },
      inArray(socialPost.id, ids(rows.slice(12))),
    );
    const hidden = await listLibraryPosts(d.actor, {});
    expect(hidden).toMatchObject({
      posts: [],
      nextCursor: null,
      allExpired: false,
    });
    expect(hidden.platformCounts).toEqual({ mock: 0 });
    expect(hidden.visibleCount).toBe(0);

    // A connected account that never synced: no posts at all.
    const never = await demoAccount();
    const empty = await listLibraryPosts(never.actor, {});
    expect(empty).toMatchObject({
      posts: [],
      nextCursor: null,
      allExpired: false,
    });
    expect(empty.platformCounts).toEqual({ mock: 0 });
    expect(empty.visibleCount).toBe(0);

    const { actor } = await bareCreator();
    expect(await listLibraryPosts(actor, {})).toEqual({
      posts: [],
      nextCursor: null,
      accounts: [],
      platformCounts: {},
      visibleCount: 0,
      allExpired: false,
    });
  });
});

describe("what the creator sees", () => {
  it("never shows another creator's posts, accounts or counts", async () => {
    const mine = await syncedDemo();
    const theirs = await syncedDemo();
    const myIds = new Set(ids(await postsOf(mine.account.id)));

    const library = await listLibraryPosts(mine.actor, {});
    expect(new Set(ids(library.posts))).toEqual(myIds);
    expect(library.accounts.map((a) => a.id)).toEqual([mine.account.id]);
    expect(library.platformCounts).toEqual({ mock: 24 });

    const snow = await listLibraryPosts(mine.actor, filterOf({ q: "snow" }));
    expect(ids(snow.posts)).toEqual([
      (await postNumber(mine.account.id, "01")).id,
    ]);

    // A cursor taken from the other creator's list still reads only mine.
    const theirPage = await listLibraryPosts(theirs.actor, {});
    const after = await queryLibraryPage(mine.actor, {
      cursor: cursorAfter(theirPage.posts[11]),
    });
    expect(after.posts.length).toBeGreaterThan(0);
    expect(after.posts.every((p) => myIds.has(p.id))).toBe(true);
  });

  it("leaves out removed and stale rows", async () => {
    const d = await syncedDemo();
    const removed = await postNumber(d.account.id, "02");
    const scrubbed = await postNumber(d.account.id, "03");
    const stale = await postNumber(d.account.id, "04");
    await updatePosts(
      { status: "removed", removedAt: new Date() },
      eq(socialPost.id, removed.id),
    );
    // The stale scrub clears posted_at (07 D47); a stale row that kept it is still left out.
    await updatePosts(
      { status: "stale", postedAt: null },
      eq(socialPost.id, scrubbed.id),
    );
    await updatePosts({ status: "stale" }, eq(socialPost.id, stale.id));

    const library = await listLibraryPosts(d.actor, {});
    expect(library.posts.map(postNo)).toEqual(
      MOCK_POST_NUMBERS.filter((n) => !["02", "03", "04"].includes(n)),
    );
    expect(library.platformCounts).toEqual({ mock: 21 });
    expect(library.accounts.map((a) => a.postCount)).toEqual([21]);
    for (const post of [removed, scrubbed, stale]) {
      expect(await getLibraryPost(d.actor, post.id)).toBeNull();
    }
  });
});

describe("video: a verified posting only (07 D72)", () => {
  it("fills video from a verified posting, never from an unverified or released one", async () => {
    const d = await syncedDemo();
    const [p1, p2, p3, p4] = await Promise.all(
      ["01", "02", "03", "04"].map((n) => postNumber(d.account.id, n)),
    );

    const draft = await insertLibraryVideo(d.account, p1);
    const live = await publishVideo(
      (await insertLibraryVideo(d.account, p4)).video,
    );
    // Post 02: only an upload's unverified posting points at it.
    const upload = await insertUploadVideo({ id: d.account.creatorId });
    await insertVideoPosting(upload, {
      platform: "mock",
      url: p2.permalink,
      linkKey: p2.linkKey,
      socialAccountId: d.account.id,
      socialPostId: p2.id,
    });
    // Post 03: a Library video whose source posting was released.
    await insertLibraryVideo(d.account, p3, {
      posting: { verification: "unverified", unverifiedReason: "released" },
    });
    // Post 01 also has an unverified posting from the upload: still one tile, with the verified video.
    await insertVideoPosting(upload, {
      platform: "mock",
      url: p1.permalink,
      linkKey: p1.linkKey,
      socialAccountId: d.account.id,
      socialPostId: p1.id,
    });

    const library = await listLibraryPosts(d.actor, {});
    expect(library.posts).toHaveLength(24);
    expect(new Set(ids(library.posts)).size).toBe(24);
    const byNo = new Map(library.posts.map((p) => [postNo(p), p.video]));
    expect(byNo.get("01")).toEqual({ id: draft.video.id, status: "draft" });
    expect(byNo.get("02")).toBeNull();
    expect(byNo.get("03")).toBeNull();
    expect(byNo.get("04")).toEqual({ id: live.id, status: "published" });
    expect(library.posts.filter((p) => p.video !== null).map(postNo)).toEqual([
      "01",
      "04",
    ]);

    expect((await getLibraryPost(d.actor, p1.id))?.video).toEqual({
      id: draft.video.id,
      status: "draft",
    });
    expect((await getLibraryPost(d.actor, p2.id))?.video).toBeNull();
    expect((await getLibraryPost(d.actor, p3.id))?.video).toBeNull();
  });
});

describe("re-syncing the same posts (J3.8)", () => {
  it("keeps 24 unique posts after a second sync and after upserting the same posts again", async () => {
    const d = await syncedDemo();
    const before = ids((await listLibraryPosts(d.actor, {})).posts);
    expect(new Set(before).size).toBe(24);

    expect(await syncSocialAccount(d.account.id, d.actor)).toMatchObject({
      ok: true,
      added: 0,
    });

    // The same 24 posts once more, straight through upsertPosts.
    const token = mockTokensFor(d.userId, "again").accessToken;
    const listed: SocialPost[] = [];
    let cursor: string | null = null;
    do {
      const page = await mockProvider.listPosts(token, { cursor });
      listed.push(...page.posts);
      cursor = page.nextCursor;
    } while (cursor);
    expect(listed).toHaveLength(24);
    expect(await upsertPosts(db, d.account, listed, new Date())).toEqual({
      upserted: 24,
      added: 0,
    });

    const after = await listLibraryPosts(d.actor, {});
    expect(ids(after.posts)).toEqual(before);
    expect(after.platformCounts).toEqual({ mock: 24 });
    expect(await postsOf(d.account.id)).toHaveLength(24);
  });
});

describe("getLibraryPost (built with the Library, owner answer Q-27)", () => {
  it("reads the creator's own visible post with its account status; null for anyone else's, an unknown, a non-uuid or an expired one", async () => {
    const d = await syncedDemo();
    const other = await syncedDemo();
    const post01 = await postNumber(d.account.id, "01");
    const { posts } = await listLibraryPosts(d.actor, {});

    expect(await getLibraryPost(d.actor, post01.id)).toEqual({
      ...posts[0],
      accountStatus: "connected",
      accountDisplayName: "Demo Creator",
      accountConnectedAt: d.account.connectedAt.toISOString(),
    });
    await db
      .update(socialAccount)
      .set({ status: "needs_reconnect" })
      .where(eq(socialAccount.id, d.account.id));
    expect(await getLibraryPost(d.actor, post01.id)).toMatchObject({
      id: post01.id,
      accountStatus: "needs_reconnect",
    });

    expect(await getLibraryPost(other.actor, post01.id)).toBeNull();
    expect(await getLibraryPost(d.actor, randomUUID())).toBeNull();
    // Not a uuid: null before any query (Postgres would refuse it).
    for (const id of ["abc", ""]) {
      expect(await getLibraryPost(d.actor, id)).toBeNull();
    }

    const post02 = await postNumber(d.account.id, "02");
    await updatePosts({ fetchedAt: DAYS_AGO_31 }, eq(socialPost.id, post02.id));
    expect(await getLibraryPost(d.actor, post02.id)).toBeNull();
  });
});

describe("getLibraryPost: the account fields the Source page adds (P11, 03 §7.4)", () => {
  it("carries the account's display name and last connect with the whole caption; the tile DTO has neither", async () => {
    const d = await syncedDemo();
    const post01 = await postNumber(d.account.id, "01");
    const reconnectedAt = new Date("2026-10-12T09:30:00.000Z");
    await db
      .update(socialAccount)
      .set({ displayName: null, connectedAt: reconnectedAt })
      .where(eq(socialAccount.id, d.account.id));

    expect(await getLibraryPost(d.actor, post01.id)).toMatchObject({
      id: post01.id,
      platform: "mock",
      accountUsername: "demo.creator",
      captionExcerpt: SNOW_CAPTION,
      accountStatus: "connected",
      accountDisplayName: null,
      accountConnectedAt: "2026-10-12T09:30:00.000Z",
    });
    const { posts } = await listLibraryPosts(d.actor, {});
    const tile = posts.find((p) => p.id === post01.id);
    expect(tile).toBeDefined();
    for (const key of [
      "accountStatus",
      "accountDisplayName",
      "accountConnectedAt",
    ]) {
      expect(tile).not.toHaveProperty(key);
    }
  });
});

describe("listAccountSummaries: stale (07 D13)", () => {
  it("is stale when the last good sync is more than 24 h old, not when fresh or never synced", async () => {
    const d = await syncedDemo();
    const syncedAgo = async (interval: string) => {
      await db
        .update(socialAccount)
        .set({
          lastSyncedAt: sql`now() - ${sql.raw(`interval '${interval}'`)}`,
        })
        .where(eq(socialAccount.id, d.account.id));
      const [summary] = await listAccountSummaries(d.actor);
      return summary?.stale;
    };

    const [fresh] = await listAccountSummaries(d.actor);
    expect(fresh).toMatchObject({ id: d.account.id, stale: false });
    expect(await syncedAgo("23 hours")).toBe(false);
    expect(await syncedAgo("25 hours")).toBe(true);
    expect(await syncedAgo("3 days")).toBe(true);
    expect((await listLibraryPosts(d.actor, {})).accounts[0]?.stale).toBe(true);

    const never = await demoAccount();
    expect(await listAccountSummaries(never.actor)).toMatchObject([
      { lastSyncedAt: null, stale: false },
    ]);
  });
});

describe("LibraryFilterSchema (07 D48)", () => {
  const cursor = encodeLibraryCursor({
    postedAt: new Date(MOCK_ANCHOR),
    id: randomUUID(),
  });

  it("drops a q of 1 or 101 characters and keeps 2 to 100, trimmed", () => {
    expect(filterOf({ q: "a" })).toEqual({});
    expect(filterOf({ q: " a " })).toEqual({});
    expect(filterOf({ q: "a".repeat(101) })).toEqual({});
    expect(filterOf({ q: "ab" })).toEqual({ q: "ab" });
    expect(filterOf({ q: "a".repeat(100) })).toEqual({ q: "a".repeat(100) });
    expect(filterOf({ q: "  snow  " })).toEqual({ q: "snow" });
  });

  it("drops a repeated param", () => {
    const account = randomUUID();
    expect(
      filterOf({
        platform: ["mock", "youtube"],
        account: [account, account],
        q: ["snow", "rain"],
        cursor: [cursor, cursor],
      }),
    ).toEqual({});
    expect(filterOf({ platform: ["mock"], q: "snow" })).toEqual({ q: "snow" });
  });

  it("maps ?account= to accountId and drops each invalid param on its own", () => {
    const account = randomUUID();
    expect(
      filterOf({
        platform: "mock",
        account,
        q: "snow",
        cursor,
        connected: "x",
      }),
    ).toEqual({ platform: "mock", accountId: account, q: "snow", cursor });
    expect(
      filterOf({
        platform: "facebook",
        account: "not-a-uuid",
        q: "snow",
        cursor: "garbage",
      }),
    ).toEqual({ q: "snow" });
    expect(filterOf({})).toEqual({});
  });
});
