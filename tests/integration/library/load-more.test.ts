import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMoreLibraryPosts } from "../../../src/app/(dashboard)/dashboard/library/actions";
import {
  type ActionResult,
  GENERIC_ERROR_MESSAGE,
} from "../../../src/lib/result";
import { listLibraryPosts } from "../../../src/server/library/queries";
import { redirectTo } from "../../helpers/actions";
import {
  mockNextHeaders,
  type SignedInCreator,
  signedInCreator,
} from "../../helpers/auth";
import { postNumber, postsOf } from "../../helpers/connect-flow";
import { resetDb } from "../../helpers/db";
import { insertSocialAccount, insertSocialPost } from "../../helpers/factories";
import {
  cursorAfter,
  ids,
  libraryOrder,
  MOCK_POST_NUMBERS,
  postNo,
  syncedDemo,
  twoSyncedDemos,
} from "../../helpers/library";

// Show more (05 §6.1 callout 14): the Server Action that reads the next page for the same filters, called as the
// client island calls it, with the session read through the mocked next/headers.
vi.mock("next/headers", () => import("../../helpers/next-headers"));

afterAll(resetDb);
beforeEach(() => mockNextHeaders(null));

const INVALID_INPUT = {
  ok: false,
  error: { code: "invalid_input", message: GENERIC_ERROR_MESSAGE },
};

/** What a client can post: anything at all. */
const loadMoreUntyped = loadMoreLibraryPosts as (
  input: unknown,
) => ReturnType<typeof loadMoreLibraryPosts>;

/** The action's data, failing the test on a refusal. */
function dataOf<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`refused: ${result.error.code}`);
  return result.data;
}

/** The signed-in creator (the current session) with both Demo accounts synced: 48 posts. */
async function signedInWithTwoDemos() {
  const me = await signedInCreator();
  const demos = await twoSyncedDemos({ id: me.creatorId, userId: me.userId });
  return { me, ...demos };
}

const ownerOf = (me: SignedInCreator) => ({
  id: me.creatorId,
  userId: me.userId,
});

describe("loadMoreLibraryPosts (Show more)", () => {
  it("returns the next 24 after the first page, and no next page after the last (48 posts, two accounts)", async () => {
    const { me, first, second } = await signedInWithTwoDemos();
    const page1 = await listLibraryPosts(me.actor, {});
    expect(page1.posts).toHaveLength(24);
    expect(page1.nextCursor).toEqual(expect.any(String));

    const page2 = dataOf(
      await loadMoreLibraryPosts({ cursor: page1.nextCursor as string }),
    );
    expect(page2.posts).toHaveLength(24);
    expect(page2.nextCursor).toBeNull();
    expect(page2.posts.map(postNo)).toEqual(
      MOCK_POST_NUMBERS.slice(12).flatMap((n) => [n, n]),
    );

    const all = [...page1.posts, ...page2.posts];
    expect(new Set(ids(all)).size).toBe(48);
    expect(new Set(ids(all))).toEqual(
      new Set(
        ids([
          ...(await postsOf(first.account.id)),
          ...(await postsOf(second.account.id)),
        ]),
      ),
    );
    expect(ids(all)).toEqual(ids(libraryOrder(all)));

    // From the middle of the second page: the rest, then nothing.
    const rest = dataOf(
      await loadMoreLibraryPosts({ cursor: cursorAfter(all[29]) }),
    );
    expect(ids(rest.posts)).toEqual(ids(all.slice(30)));
    expect(rest.nextCursor).toBeNull();
    const none = dataOf(
      await loadMoreLibraryPosts({ cursor: cursorAfter(all[47]) }),
    );
    expect(none).toEqual({ posts: [], nextCursor: null });
  });

  it("refuses a missing, empty or garbage cursor, or any other bad input, with invalid_input", async () => {
    const { me } = await signedInWithTwoDemos();
    const page1 = await listLibraryPosts(me.actor, {});
    const cursor = page1.nextCursor as string;
    for (const input of [
      undefined,
      null,
      {},
      { cursor: "" },
      { cursor: "garbage" },
      { cursor: 42 },
      { cursor: [cursor] },
      { cursor: `${cursor}=` },
      { platform: "mock" },
      { cursor, q: "a" },
      { cursor, q: "a".repeat(101) },
      { cursor, platform: "facebook" },
      { cursor, account: "not-a-uuid" },
      { cursor, accountId: randomUUID() },
    ]) {
      expect(await loadMoreUntyped(input), JSON.stringify(input)).toEqual(
        INVALID_INPUT,
      );
    }
  });

  it("sends a signed-out caller to sign in", async () => {
    const { me } = await signedInWithTwoDemos();
    const { nextCursor } = await listLibraryPosts(me.actor, {});
    mockNextHeaders(null);
    await expect(
      loadMoreLibraryPosts({ cursor: nextCursor as string }),
    ).rejects.toMatchObject(redirectTo("/sign-in?next=%2Fdashboard%2Flibrary"));
  });

  it("honors the platform filter", async () => {
    const { me } = await signedInWithTwoDemos();
    const youtube = await insertSocialAccount(
      { id: me.creatorId },
      { provider: "youtube" },
    );
    // Posted now: newer than every mock post.
    const short = await insertSocialPost(youtube, { mediaType: "short" });

    // All platforms: 49 posts, so the second page has a next page of its own.
    const all1 = await listLibraryPosts(me.actor, {});
    expect(all1.posts[0]?.id).toBe(short.id);
    const all2 = dataOf(
      await loadMoreLibraryPosts({ cursor: all1.nextCursor as string }),
    );
    expect(all2.posts).toHaveLength(24);
    expect(all2.nextCursor).not.toBeNull();

    // Demo only: 48, and the second page is the last.
    const mock1 = await listLibraryPosts(me.actor, { platform: "mock" });
    const mock2 = dataOf(
      await loadMoreLibraryPosts({
        platform: "mock",
        cursor: mock1.nextCursor as string,
      }),
    );
    expect(mock2.posts).toHaveLength(24);
    expect(mock2.posts.every((p) => p.platform === "mock")).toBe(true);
    expect(mock2.nextCursor).toBeNull();
    expect(new Set(ids([...mock1.posts, ...mock2.posts])).size).toBe(48);

    // YouTube only: its one post is newer than the cursor.
    const yt = dataOf(
      await loadMoreLibraryPosts({
        platform: "youtube",
        cursor: mock1.nextCursor as string,
      }),
    );
    expect(yt).toEqual({ posts: [], nextCursor: null });
  });

  it("honors the account filter", async () => {
    const { me, second } = await signedInWithTwoDemos();
    const only = await listLibraryPosts(me.actor, {
      accountId: second.account.id,
    });
    expect(only.nextCursor).toBeNull();
    const more = dataOf(
      await loadMoreLibraryPosts({
        account: second.account.id,
        cursor: cursorAfter(only.posts[11]),
      }),
    );
    expect(more.posts.map(postNo)).toEqual(MOCK_POST_NUMBERS.slice(12));
    expect(new Set(more.posts.map((p) => p.accountUsername))).toEqual(
      new Set(["demo.creator.2"]),
    );
    expect(more.nextCursor).toBeNull();
  });

  it("honors the search, and the filters together", async () => {
    const { me, first } = await signedInWithTwoDemos();
    const snow = await listLibraryPosts(me.actor, { q: "snow" });
    expect(snow.posts.map(postNo)).toEqual(["01", "01"]);

    const more = dataOf(
      await loadMoreLibraryPosts({
        q: "SNOW",
        cursor: cursorAfter(snow.posts[0]),
      }),
    );
    expect(ids(more.posts)).toEqual([snow.posts[1]?.id]);
    expect(more.nextCursor).toBeNull();

    // A cursor newer than every post: all three filters at once leave only the first account's post 01.
    const youtube = await insertSocialAccount(
      { id: me.creatorId },
      { provider: "youtube" },
    );
    const short = await insertSocialPost(youtube, {
      caption: "snow on the ridge",
    });
    const together = dataOf(
      await loadMoreLibraryPosts({
        platform: "mock",
        account: first.account.id,
        q: "snow",
        cursor: cursorAfter({
          id: short.id,
          postedAt: short.postedAt?.toISOString() ?? null,
        }),
      }),
    );
    expect(ids(together.posts)).toEqual([
      (await postNumber(first.account.id, "01")).id,
    ]);
    expect(together.nextCursor).toBeNull();
  });

  it("reads no posts for another creator's account, and only the caller's own posts", async () => {
    const theirs = await syncedDemo();
    const theirIds = new Set(ids(await postsOf(theirs.account.id)));
    const { me, first, second } = await signedInWithTwoDemos();
    const myIds = new Set(
      ids([
        ...(await postsOf(first.account.id)),
        ...(await postsOf(second.account.id)),
      ]),
    );
    const { nextCursor } = await listLibraryPosts(me.actor, {});
    const cursor = nextCursor as string;

    const foreign = dataOf(
      await loadMoreLibraryPosts({ account: theirs.account.id, cursor }),
    );
    expect(foreign).toEqual({ posts: [], nextCursor: null });

    const mine = dataOf(await loadMoreLibraryPosts({ cursor }));
    expect(mine.posts).toHaveLength(24);
    expect(mine.posts.every((p) => myIds.has(p.id))).toBe(true);
    expect(mine.posts.some((p) => theirIds.has(p.id))).toBe(false);

    // A creator with no accounts gets nothing for the same cursor.
    const empty = await signedInCreator();
    expect(empty.creatorId).not.toBe(me.creatorId);
    expect(dataOf(await loadMoreLibraryPosts({ cursor }))).toEqual({
      posts: [],
      nextCursor: null,
    });

    // Another creator with posts, signed in, pages through their own with my cursor, never mine.
    const other = await signedInCreator();
    await syncedDemo(ownerOf(other));
    const otherMore = dataOf(await loadMoreLibraryPosts({ cursor }));
    expect(otherMore.posts.length).toBeGreaterThan(0);
    expect(otherMore.posts.some((p) => myIds.has(p.id))).toBe(false);
  });
});
