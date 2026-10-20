// Library [int] helpers (P09): synced Demo accounts, and the Library read page by page the way Show more reads it.
import type { CreatorProfile } from "../../src/db/schema/types";
import type { Actor } from "../../src/server/auth/actor";
import {
  encodeLibraryCursor,
  type LibraryFilter,
  type LibraryPostDTO,
  queryLibraryPage,
} from "../../src/server/library/queries";
import { MOCK_POSTS } from "../../src/server/social/providers/mock-data";
import { syncSocialAccount } from "../../src/server/social/sync";
import { accountRow, type Demo, demoAccount } from "./connect-flow";

type Owner = Pick<CreatorProfile, "id" | "userId">;

/** `d`'s creator, to give it another account. */
export const ownerOf = (d: Demo): Owner => ({
  id: d.account.creatorId,
  userId: d.userId,
});

/** A Demo account (of a new creator unless `owner` is given) after its first sync: 24 available posts. */
export async function syncedDemo(
  owner?: Owner,
  opts: { second?: boolean } = {},
): Promise<Demo> {
  const d = await demoAccount(owner, opts);
  const result = await syncSocialAccount(d.account.id, d.actor);
  if (!result.ok) throw new Error(`setup sync failed: ${result.reason}`);
  return { ...d, account: await accountRow(d.account.id) };
}

/** Both Demo accounts of one creator (new unless given), synced: 48 posts, two at each posted_at. */
export async function twoSyncedDemos(
  owner?: Owner,
): Promise<{ first: Demo; second: Demo }> {
  const first = await syncedDemo(owner);
  const second = await syncedDemo(ownerOf(first), { second: true });
  return { first, second };
}

/** The cursor after `post`, as the Library builds it. */
export const cursorAfter = (post: Pick<LibraryPostDTO, "id" | "postedAt">) =>
  encodeLibraryCursor({
    postedAt: new Date(post.postedAt as string),
    id: post.id,
  });

/** Every page for `f`, following nextCursor; more than `maxPages` pages fails instead of looping. */
export async function readAllPages(
  actor: Actor,
  f: LibraryFilter = {},
  maxPages = 10,
): Promise<LibraryPostDTO[][]> {
  const pages: LibraryPostDTO[][] = [];
  let cursor: string | undefined;
  do {
    if (pages.length === maxPages) {
      throw new Error(`more than ${maxPages} pages`);
    }
    const page = await queryLibraryPage(actor, { ...f, cursor });
    pages.push(page.posts);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return pages;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `posts` in the Library's order, computed in JS: posted_at desc, then id desc. */
export function libraryOrder<T extends { id: string; postedAt: string | null }>(
  posts: readonly T[],
): T[] {
  return [...posts].sort(
    (a, b) =>
      compare(b.postedAt ?? "", a.postedAt ?? "") || compare(b.id, a.id),
  );
}

/** The mock posts' two-digit numbers, newest first. */
export const MOCK_POST_NUMBERS = MOCK_POSTS.map((row) =>
  String(row.n).padStart(2, "0"),
);

/** The posts' ids, in order. */
export const ids = (posts: readonly { id: string }[]) => posts.map((p) => p.id);

/** A mock post's two-digit number, from the end of its permalink ("…_01" → "01"). */
export const postNo = (post: Pick<LibraryPostDTO, "permalink">) =>
  post.permalink.slice(-2);
