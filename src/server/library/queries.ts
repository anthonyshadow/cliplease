import "server-only";
import {
  and,
  countDistinct,
  desc,
  eq,
  ilike,
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { db } from "../../db/client";
import {
  socialAccount,
  socialPost,
  video,
  videoPosting,
} from "../../db/schema";
import type {
  SocialAccountStatus,
  SocialProviderId,
} from "../../lib/domain/values";
import {
  decodeLibraryCursor,
  encodeLibraryCursor,
  escapeLike,
  LIBRARY_PAGE_SIZE,
  type LibraryFilter,
} from "../../lib/library/filter";
import type { LibraryPostDTO } from "../../lib/library/post";
import { isUuid } from "../../lib/validation/uuid";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { deriveConnectionState } from "../social/connection-state";
import {
  CONNECTIONS_ORDER,
  expiredPostsWhere,
  visiblePostsWhere,
} from "../social/sync";

// Library reads (02 §5.4). P06 started the account summaries the connect step and Connections show, P07 added the sync
// fields and P08 completes the DTO; P09 adds the posts. The filter, cursor and post DTO live in src/lib/library (the
// client islands use them too) and are re-exported here, where 02 §5.4 lists them.

export {
  decodeLibraryCursor,
  encodeLibraryCursor,
  escapeLike,
  type LibraryFilter,
  LibraryFilterSchema,
} from "../../lib/library/filter";
export type { LibraryPostDTO } from "../../lib/library/post";

/** 02 §5.4's AccountSummaryDTO; P08 adds accountType, connectedAt, syncing and blockedMinutes for the cards. */
export type AccountSummaryDTO = {
  id: string;
  platform: SocialProviderId;
  username: string | null;
  displayName: string | null;
  /** The avatar proxy (07 D42), never the platform's URL; null when the platform gave none. */
  avatarSrc: string | null;
  status: SocialAccountStatus;
  /** ISO time of the last sync that finished. */
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  /** 07 D02's derived "Sync problem". */
  syncProblem: boolean;
  hasOlder: boolean;
  /** The account's posts the creator can see (visiblePostsWhere). */
  postCount: number;
  /** Instagram: "Business" | "Media_Creator"; the mock reports "Media_Creator". */
  accountType: string | null;
  connectedAt: string;
  /** A sync holds the 2-minute lease. */
  syncing: boolean;
  /** Minutes until the platform lets us sync again; null when not rate-limited. */
  blockedMinutes: number | null;
  /** The last good sync is more than 24 h old (07 D13): the Library's quiet stale banner. */
  stale: boolean;
};

/** The creator's linked accounts (not disconnected), in the UI's platform order, oldest connect first (03 §7.3). */
export async function listAccountSummaries(
  a: Actor,
): Promise<AccountSummaryDTO[]> {
  const actor = requireCreatorActor(a);
  const rows = await db
    .select({
      id: socialAccount.id,
      platform: socialAccount.provider,
      username: socialAccount.username,
      displayName: socialAccount.displayName,
      avatarUrl: socialAccount.avatarUrl,
      status: socialAccount.status,
      lastSyncedAt: socialAccount.lastSyncedAt,
      lastSyncError: socialAccount.lastSyncError,
      lastSyncErrorAt: socialAccount.lastSyncErrorAt,
      syncStartedAt: socialAccount.syncStartedAt,
      syncBlockedUntil: socialAccount.syncBlockedUntil,
      hasOlder: socialAccount.hasOlder,
      accountType: socialAccount.accountType,
      connectedAt: socialAccount.connectedAt,
      postCount: db.$count(
        socialPost,
        and(
          eq(socialPost.socialAccountId, socialAccount.id),
          visiblePostsWhere(actor.creatorId),
        ),
      ),
      // The database's clock, the one that set sync_blocked_until and sync_started_at. A raw timestamptz comes back
      // as text; mapWith reads it the way a timestamp column does.
      now: sql`now()`.mapWith((value: string) => new Date(value)),
    })
    .from(socialAccount)
    .where(
      and(
        eq(socialAccount.creatorId, actor.creatorId),
        ne(socialAccount.status, "disconnected"),
      ),
    )
    .orderBy(...CONNECTIONS_ORDER);
  return rows.map(({ avatarUrl, now, ...row }) => {
    const state = deriveConnectionState(row, now);
    return {
      id: row.id,
      platform: row.platform,
      username: row.username,
      displayName: row.displayName,
      avatarSrc: avatarUrl ? `/api/connections/avatars/${row.id}` : null,
      status: row.status,
      lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
      lastSyncError: row.lastSyncError,
      syncProblem: state.syncProblem,
      hasOlder: row.hasOlder,
      postCount: row.postCount,
      accountType: row.accountType,
      connectedAt: row.connectedAt.toISOString(),
      syncing: state.syncing,
      blockedMinutes: state.blockedMinutes,
      stale: state.stale,
    };
  });
}

/** The tile columns of a post row, with its verified posting's video (03 §7.2). */
const POST_COLUMNS = {
  id: socialPost.id,
  platform: socialPost.provider,
  accountUsername: socialAccount.username,
  kind: socialPost.mediaType,
  title: socialPost.title,
  captionExcerpt: socialPost.caption,
  permalink: socialPost.permalink,
  thumbnailUrl: socialPost.thumbnailUrl,
  thumbnailFetchedAt: socialPost.thumbnailFetchedAt,
  width: socialPost.width,
  height: socialPost.height,
  postedAt: socialPost.postedAt,
  durationSec: socialPost.durationSec,
  viewCount: socialPost.viewCount,
  likeCount: socialPost.likeCount,
  commentCount: socialPost.commentCount,
  visibility: socialPost.visibility,
  fetchedAt: socialPost.fetchedAt,
  accountStatus: socialAccount.status,
  videoId: video.id,
  videoStatus: video.status,
};

/** Posts with their account and, through a VERIFIED posting only, their video (07 D72; video_posting_social_post_idx). */
function selectPosts() {
  return db
    .select(POST_COLUMNS)
    .from(socialPost)
    .innerJoin(socialAccount, eq(socialAccount.id, socialPost.socialAccountId))
    .leftJoin(
      videoPosting,
      and(
        eq(videoPosting.socialPostId, socialPost.id),
        eq(videoPosting.verification, "verified"),
      ),
    )
    .leftJoin(video, eq(video.id, videoPosting.videoId));
}

type PostRow = Awaited<ReturnType<typeof selectPosts>>[number];

function toPostDTO({
  thumbnailUrl,
  thumbnailFetchedAt,
  videoId,
  videoStatus,
  postedAt,
  fetchedAt,
  accountStatus: _,
  ...row
}: PostRow): LibraryPostDTO {
  const thumbnailVersion = thumbnailFetchedAt?.toISOString() ?? null;
  // The proxy streams the stored URL (07 D42); with none, the tile shows its failed state without asking. The version
  // in the query (the route ignores it) gets past the proxy's hour of browser cache once a sync stores a new image.
  const version = thumbnailVersion
    ? `?v=${encodeURIComponent(thumbnailVersion)}`
    : "";
  return {
    ...row,
    fetchedAt: fetchedAt.toISOString(),
    thumbnailSrc: thumbnailUrl
      ? `/api/library/thumbnails/${row.id}${version}`
      : null,
    thumbnailVersion,
    postedAt: postedAt?.toISOString() ?? null,
    video: videoId && videoStatus ? { id: videoId, status: videoStatus } : null,
  };
}

/**
 * One page of the creator's visible posts, newest first (03 §7.2): keyset on (posted_at, id), LIMIT 24 + 1. The
 * platform, account and caption/title search narrow it; a cursor that isn't one of ours reads the first page. Show more
 * calls it alone, without the account summaries and chip counts the page adds.
 */
export async function queryLibraryPage(
  a: Actor,
  f: LibraryFilter,
): Promise<{ posts: LibraryPostDTO[]; nextCursor: string | null }> {
  const { creatorId } = requireCreatorActor(a);
  const cursor = f.cursor ? decodeLibraryCursor(f.cursor) : null;
  const pattern = f.q ? `%${escapeLike(f.q)}%` : null;
  const rows = await selectPosts()
    .where(
      and(
        visiblePostsWhere(creatorId),
        // Available rows always have posted_at (only the stale scrub clears it, 07 D47); the keyset needs it.
        isNotNull(socialPost.postedAt),
        f.platform ? eq(socialPost.provider, f.platform) : undefined,
        f.accountId ? eq(socialPost.socialAccountId, f.accountId) : undefined,
        pattern
          ? or(
              ilike(socialPost.title, pattern),
              ilike(socialPost.caption, pattern),
            )
          : undefined,
        // posted_at is written from JS Dates (millisecond precision), so the ISO in the cursor compares exactly.
        cursor
          ? sql`(${socialPost.postedAt}, ${socialPost.id}) < (${cursor.p}::timestamptz, ${cursor.i}::uuid)`
          : undefined,
      ),
    )
    // desc() is NULLS FIRST, the order of the social_post_library_* indexes.
    .orderBy(desc(socialPost.postedAt), desc(socialPost.id))
    .limit(LIBRARY_PAGE_SIZE + 1);
  const page = rows.slice(0, LIBRARY_PAGE_SIZE);
  const last = page.at(-1);
  return {
    posts: page.map(toPostDTO),
    nextCursor:
      rows.length > LIBRARY_PAGE_SIZE && last?.postedAt
        ? encodeLibraryCursor({ postedAt: last.postedAt, id: last.id })
        : null,
  };
}

/** The creator has available posts that the 30-day rule hides. */
async function hasExpiredPosts(creatorId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(socialPost)
    .where(expiredPostsWhere(creatorId))
    .limit(1);
  return row !== undefined;
}

/**
 * The Library (02 §5.4, 03 §7.2): one page of posts, the accounts for the strip and banners, the chip counts, and
 * `allExpired` (the creator has posts but the 30-day rule hides every one, 07 D13). The chips add up the accounts'
 * visible-post counts (03 §7.2's chip query with the 30-day rule, so "All" matches the sync line; a disconnected
 * account's posts are gone or stale); only an empty Library asks whether anything expired. Nothing syncs.
 */
export async function listLibraryPosts(
  a: Actor,
  f: LibraryFilter,
): Promise<{
  posts: LibraryPostDTO[];
  nextCursor: string | null;
  accounts: AccountSummaryDTO[];
  allExpired: boolean;
  platformCounts: Partial<Record<SocialProviderId, number>>;
  visibleCount: number;
}> {
  const { creatorId } = requireCreatorActor(a);
  const [page, accounts] = await Promise.all([
    queryLibraryPage(a, f),
    listAccountSummaries(a),
  ]);
  const platformCounts: Partial<Record<SocialProviderId, number>> = {};
  for (const account of accounts) {
    platformCounts[account.platform] =
      (platformCounts[account.platform] ?? 0) + account.postCount;
  }
  const visibleCount = accounts.reduce(
    (n, account) => n + account.postCount,
    0,
  );
  return {
    ...page,
    accounts,
    platformCounts,
    visibleCount,
    allExpired:
      accounts.length > 0 &&
      visibleCount === 0 &&
      (await hasExpiredPosts(creatorId)),
  };
}

/**
 * One of the creator's visible posts with its account's status, for the Source page (P11, 07 D39), or null. Built with
 * the Library so the two read posts the same way (owner answer Q-27).
 */
export async function getLibraryPost(
  a: Actor,
  postId: string,
): Promise<(LibraryPostDTO & { accountStatus: SocialAccountStatus }) | null> {
  const { creatorId } = requireCreatorActor(a);
  if (!isUuid(postId)) return null;
  const [row] = await selectPosts()
    .where(and(eq(socialPost.id, postId), visiblePostsWhere(creatorId)))
    .limit(1);
  return row ? { ...toPostDTO(row), accountStatus: row.accountStatus } : null;
}

/**
 * The Disconnect sheet's "{n} live videos came from @{username}" for every account, in one query: published videos with
 * a verified posting, counted per account (07 D72).
 */
export async function countLiveVideosByAccount(
  a: Actor,
): Promise<ReadonlyMap<string, number>> {
  const { creatorId } = requireCreatorActor(a);
  const rows = await db
    .select({
      accountId: videoPosting.socialAccountId,
      live: countDistinct(video.id),
    })
    .from(videoPosting)
    .innerJoin(video, eq(video.id, videoPosting.videoId))
    .where(
      and(
        eq(videoPosting.creatorId, creatorId),
        eq(videoPosting.verification, "verified"),
        eq(video.status, "published"),
      ),
    )
    .groupBy(videoPosting.socialAccountId);
  return new Map(
    rows.flatMap((r) => (r.accountId ? [[r.accountId, r.live] as const] : [])),
  );
}
