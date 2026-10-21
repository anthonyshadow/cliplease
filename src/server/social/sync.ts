import "server-only";
import {
  and,
  asc,
  eq,
  exists,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  min,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { db } from "../../db/client";
import { socialAccount, socialPost, videoPosting } from "../../db/schema";
import type { NewSocialPostRow, SocialAccount } from "../../db/schema/types";
import { isOneOf, SOCIAL_POST_MEDIA_TYPES } from "../../lib/domain/values";
import { writeAudits } from "../audit";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { errorName, logEvent } from "../log";
import { SYNC_LEASE_MS } from "./connection-state";
import { SocialAuthError, SocialRateLimitError } from "./errors";
import { profileColumns } from "./link";
import { getProvider } from "./registry";
import { markNeedsReconnect, withAccessToken } from "./tokens";
import type { SocialPost, SocialProvider } from "./types";

// On-demand sync into social_post (02 §7.5; 03 §7.2 "Sync writes"; 06 §3; 07 D02, D13, D68, D72). Nothing calls it on
// page open: the OAuth callback, Sync now, Sync all and Load older videos do. The adapter's DTO names map to columns
// here only (03 DB1), from the posts the registry has cleaned (text.ts). Relative imports: the P09 seed loads
// upsertPosts under tsx.

/** The newest kept videos one account holds (owner answer OQ-16). */
export const SOCIAL_SYNC_MAX_POSTS = 200;
/** Hard cap of platform list pages per run (07 D13). */
export const SOCIAL_SYNC_MAX_PAGES = 10;
/** Posts not seen by a sync for this long are hidden at once; the purge cron deletes them (P27, 07 D13). */
export const SOCIAL_CACHE_TTL_DAYS = 30;

const OLDER_MAX_POSTS = 50; // Load older videos (07 D13)
const DEFAULT_BUDGET_MS = 20_000;
const SYNC_ALL_BUDGET_MS = 25_000;
const CAPTION_MAX_CHARS = 500;
const LEASE = sql.raw(`interval '${SYNC_LEASE_MS / 1000} seconds'`);
const CACHE_TTL = sql.raw(`interval '${SOCIAL_CACHE_TTL_DAYS} days'`);
const IG_PROFESSIONAL_TYPES = ["Business", "Media_Creator"] as const;

export type SyncMode = "recent" | "older";

/**
 * 02 §5.3, plus `added` (rows new to the cache: P09's "3 new"). fetched = usable items the platform listed (the registry
 * drops a post whose ids hold a NUL, so it never counts, takes a maxPosts slot or bounds the sweep); kept = videos counted
 * toward maxPosts; upserted = rows written; removed = rows deleted or marked removed by the sweep.
 */
export type SyncResult =
  | {
      ok: true;
      fetched: number;
      kept: number;
      upserted: number;
      added: number;
      removed: number;
      hasOlder: boolean;
    }
  | {
      ok: false;
      reason:
        | "already_syncing"
        | "rate_limited"
        | "needs_reconnect"
        | "upstream_error"
        | "not_found";
      retryAfterSec?: number;
    };

type PostOwner = Pick<SocialAccount, "id" | "creatorId" | "provider">;

/** A platform post as a social_post row (03 DB1). `now` stamps fetched_at, so one run's rows share one clock. */
export function toSocialPostRow(
  account: PostOwner,
  post: SocialPost,
  now: Date,
): NewSocialPostRow {
  return {
    socialAccountId: account.id,
    creatorId: account.creatorId,
    provider: account.provider,
    providerPostId: post.externalId,
    linkKey: post.linkKey,
    mediaType: post.kind,
    visibility: post.visibility,
    title: post.title,
    caption:
      post.caption === null
        ? null
        : Array.from(post.caption).slice(0, CAPTION_MAX_CHARS).join(""),
    permalink: post.permalink,
    thumbnailUrl: post.thumbnailUrl,
    thumbnailExpiresAt: post.thumbnailExpiresAt,
    thumbnailFetchedAt: now,
    postedAt: post.publishedAt,
    durationSec: post.durationSec,
    width: post.width,
    height: post.height,
    viewCount: post.viewCount,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    shareCount: post.shareCount,
    status: "available",
    removedAt: null,
    fetchedAt: now,
  };
}

/** Whether the cache keeps this post: videos, reels and shorts only. */
export function isKeptVideo(post: { kind: string }): boolean {
  return isOneOf(SOCIAL_POST_MEDIA_TYPES, post.kind);
}

/** An Instagram account that stopped being professional must reconnect (07 D13); no other platform has the rule. */
export function lostProfessionalAccount(
  platform: SocialAccount["provider"],
  accountType: string | null,
): boolean {
  return (
    platform === "instagram" &&
    (accountType === null || !isOneOf(IG_PROFESSIONAL_TYPES, accountType))
  );
}

const excluded = (column: { name: string }) =>
  sql.raw(`excluded.${column.name}`);

/** Every column a later sync refreshes; the owner columns and the key never change. */
const UPSERT_SET = {
  mediaType: excluded(socialPost.mediaType),
  visibility: excluded(socialPost.visibility),
  title: excluded(socialPost.title),
  caption: excluded(socialPost.caption),
  permalink: excluded(socialPost.permalink),
  linkKey: excluded(socialPost.linkKey),
  thumbnailUrl: excluded(socialPost.thumbnailUrl),
  thumbnailExpiresAt: excluded(socialPost.thumbnailExpiresAt),
  thumbnailFetchedAt: excluded(socialPost.thumbnailFetchedAt),
  postedAt: excluded(socialPost.postedAt),
  durationSec: excluded(socialPost.durationSec),
  width: excluded(socialPost.width),
  height: excluded(socialPost.height),
  viewCount: excluded(socialPost.viewCount),
  likeCount: excluded(socialPost.likeCount),
  commentCount: excluded(socialPost.commentCount),
  shareCount: excluded(socialPost.shareCount),
  fetchedAt: excluded(socialPost.fetchedAt),
  status: "available",
  removedAt: null,
} as const;

/**
 * Writes posts by (social_account_id, provider_post_id) (03 §7.2); a removed post that is listed again is available
 * again. `added` counts the rows that are new (xmax = 0). A post listed twice in one batch is written once.
 */
export async function upsertPosts(
  exec: Pick<typeof db, "insert">,
  account: PostOwner,
  posts: readonly SocialPost[],
  now: Date,
): Promise<{ upserted: number; added: number }> {
  const rows = [
    ...new Map(
      posts.map((post) => [
        post.externalId,
        toSocialPostRow(account, post, now),
      ]),
    ).values(),
  ];
  if (rows.length === 0) return { upserted: 0, added: 0 };
  const written = await exec
    .insert(socialPost)
    .values(rows)
    .onConflictDoUpdate({
      target: [socialPost.socialAccountId, socialPost.providerPostId],
      set: UPSERT_SET,
    })
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  return {
    upserted: written.length,
    added: written.filter((row) => row.inserted).length,
  };
}

/** A creator's available posts, split by the 30-day rule (07 D13): seen by a sync within SOCIAL_CACHE_TTL_DAYS or not. */
function availablePostsWhere(creatorId: string, fresh: boolean): SQL {
  const seen = sql`${socialPost.fetchedAt} > now() - ${CACHE_TTL}`;
  return sql`${socialPost.creatorId} = ${creatorId} and ${socialPost.status} = 'available' and ${fresh ? seen : sql`not (${seen})`}`;
}

/** The posts a creator can see: available and seen by a sync within SOCIAL_CACHE_TTL_DAYS (07 D13). */
export const visiblePostsWhere = (creatorId: string) =>
  availablePostsWhere(creatorId, true);

/** The available posts the 30-day rule hides (the Library's "saved list expired"). */
export const expiredPostsWhere = (creatorId: string) =>
  availablePostsWhere(creatorId, false);

/** A video_posting points at the post: the post is "referenced" (07 D72). Correlated with the outer social_post. */
export const postingOfPost = db
  .select({ one: sql`1` })
  .from(videoPosting)
  .where(eq(videoPosting.socialPostId, socialPost.id));

/** The Connections order (03 §7.3): by platform, oldest connect first. */
export const CONNECTIONS_ORDER = [
  asc(socialAccount.provider),
  asc(socialAccount.connectedAt),
];

type Run = {
  account: SocialAccount;
  provider: SocialProvider;
  actor: Actor;
  mode: SyncMode;
  maxPosts: number;
  deadline: number;
  /**
   * This run's lease. Every write checks the account is still connected and still holds it (owner answer Q-17 a): the
   * account's own UPDATEs in their WHERE, the post writes under a share lock (whileStillMine).
   */
  leasedAt: Date;
};

/** A run that must stop before writing: the account was disconnected, must reconnect, or another run took over. */
class RunStopped extends Error {
  constructor(readonly result: SyncResult) {
    super("sync_run_stopped");
    this.name = "RunStopped";
  }
}

/**
 * Seconds until sync_blocked_until by the database's clock, the one that set it (as listAccountSummaries reads it);
 * null when the account isn't blocked, 0 or less once the block has passed.
 */
const BLOCKED_SEC = sql<
  number | null
>`ceil(extract(epoch from (${socialAccount.syncBlockedUntil} - now())))::int`;

/** Why the account can't be synced now (02 §7.5 step 1: gone, must reconnect, or rate-limited), or null. */
export function refusalReason(
  row:
    | { status: SocialAccount["status"]; blockedSec: number | null }
    | undefined,
): SyncResult | null {
  if (!row || row.status === "disconnected") {
    return { ok: false, reason: "not_found" };
  }
  if (row.status === "needs_reconnect") {
    return { ok: false, reason: "needs_reconnect" };
  }
  if (row.blockedSec !== null && row.blockedSec > 0) {
    return { ok: false, reason: "rate_limited", retryAfterSec: row.blockedSec };
  }
  return null;
}

/** Why the run must stop writing (the account was disconnected, must reconnect, or another run took over), or null. */
function stopReason(
  run: Run,
  row: Pick<SocialAccount, "status" | "syncStartedAt"> | undefined,
): SyncResult | null {
  if (!row || row.status === "disconnected") {
    return { ok: false, reason: "not_found" };
  }
  if (row.status === "needs_reconnect") {
    return { ok: false, reason: "needs_reconnect" };
  }
  if (row.syncStartedAt?.getTime() !== run.leasedAt.getTime()) {
    return { ok: false, reason: "already_syncing" };
  }
  return null;
}

const accountGuard = {
  status: socialAccount.status,
  syncStartedAt: socialAccount.syncStartedAt,
};

/**
 * Runs the post writes `write` in a transaction that first re-reads the account under a share lock (owner answer Q-17
 * a): a Disconnect that committed first stops the run before it writes anything back (03 §9.1, §9.3), and one that
 * comes later waits for this short write and then deletes what it wrote.
 */
async function whileStillMine<T>(
  run: Run,
  write: (tx: Pick<typeof db, "insert" | "update" | "delete">) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select(accountGuard)
      .from(socialAccount)
      .where(eq(socialAccount.id, run.account.id))
      .for("share");
    const stop = stopReason(run, row);
    if (stop) throw new RunStopped(stop);
    return write(tx);
  });
}

/**
 * Syncs one account (02 §7.5 steps 1–6). A platform failure never throws: it is recorded on the row (07 D02) and
 * returned. Only a database outage before the lease is taken reaches the caller.
 * mode 'recent' lists from the newest; 'older' lists before the oldest post held (Load older videos). maxPosts counts
 * kept videos (default 200, 'older' 50); budgetMs bounds the paging and the sweep's confirmations.
 */
export async function syncSocialAccount(
  accountId: string,
  a: Actor,
  opts: { mode?: SyncMode; maxPosts?: number; budgetMs?: number } = {},
): Promise<SyncResult> {
  const mode = opts.mode ?? "recent";
  const [account] = await db
    .select({ ...getTableColumns(socialAccount), blockedSec: BLOCKED_SEC })
    .from(socialAccount)
    .where(eq(socialAccount.id, accountId));
  const provider = account ? getProvider(account.provider) : null;
  const allowed =
    a.kind === "system" ||
    (a.kind === "creator" && a.creatorId === account?.creatorId);
  if (!account || !provider || !allowed) {
    return { ok: false, reason: "not_found" };
  }
  const refused = refusalReason(account);
  if (refused) return refused;

  const leasedAt = await takeLease(account);
  if (!leasedAt) return leaseRefusal(account.id);
  let result: SyncResult;
  try {
    result = await runSync({
      account,
      provider,
      actor: a,
      mode,
      maxPosts:
        opts.maxPosts ??
        (mode === "older" ? OLDER_MAX_POSTS : SOCIAL_SYNC_MAX_POSTS),
      deadline: Date.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS),
      leasedAt,
    });
  } catch (error) {
    result = failure(account, error);
  }
  // Every path ends here: the result is recorded on the row and the lease released.
  await finishRun(account.id, leasedAt, result);
  return result;
}

/**
 * 03 §7.2's single-flight lease (2 minutes). Its value is the database clock cut to milliseconds, so it reads back as a
 * JS Date equal to the stored value and finishRun can fence on it (a plain now() keeps microseconds and never matches).
 */
async function takeLease(account: SocialAccount): Promise<Date | null> {
  const [lease] = await db
    .update(socialAccount)
    .set({ syncStartedAt: sql`date_trunc('milliseconds', now())` })
    .where(
      and(
        eq(socialAccount.id, account.id),
        eq(socialAccount.creatorId, account.creatorId),
        eq(socialAccount.status, "connected"),
        or(
          isNull(socialAccount.syncStartedAt),
          lt(socialAccount.syncStartedAt, sql`now() - ${LEASE}`),
        ),
        or(
          isNull(socialAccount.syncBlockedUntil),
          lte(socialAccount.syncBlockedUntil, sql`now()`),
        ),
      ),
    )
    .returning({ leasedAt: socialAccount.syncStartedAt });
  return lease?.leasedAt ?? null;
}

/**
 * Why takeLease refused, read again: the account changed since the first read, its block hasn't passed by the
 * database's clock, or another run holds the lease.
 */
async function leaseRefusal(accountId: string): Promise<SyncResult> {
  const [row] = await db
    .select({ status: socialAccount.status, blockedSec: BLOCKED_SEC })
    .from(socialAccount)
    .where(eq(socialAccount.id, accountId));
  return refusalReason(row) ?? { ok: false, reason: "already_syncing" };
}

/** The account columns that record a run's result (07 D02; 03 §7.2's end of run). */
function columnsFor(
  result: SyncResult,
): PgUpdateSetSource<typeof socialAccount> {
  if (result.ok) {
    return {
      lastSyncedAt: sql`now()`,
      lastSyncError: null,
      hasOlder: result.hasOlder,
    };
  }
  switch (result.reason) {
    case "rate_limited":
      return {
        syncBlockedUntil: sql`now() + make_interval(secs => ${result.retryAfterSec ?? 0})`,
        lastSyncError: "rate_limited",
        lastSyncErrorAt: sql`now()`,
      };
    case "upstream_error":
      return { lastSyncError: "upstream", lastSyncErrorAt: sql`now()` };
    default:
      // needs_reconnect: markNeedsReconnect already changed the status.
      return {};
  }
}

/** Records the result and ends the lease (sync_started_at = null) on every path; a failure here is logged, never thrown. */
async function finishRun(
  accountId: string,
  leasedAt: Date,
  result: SyncResult,
): Promise<void> {
  try {
    await db
      .update(socialAccount)
      .set({ ...columnsFor(result), syncStartedAt: null })
      .where(
        and(
          eq(socialAccount.id, accountId),
          eq(socialAccount.syncStartedAt, leasedAt),
        ),
      );
  } catch (error) {
    logEvent("error", "social.sync_finish_failed", {
      socialAccountId: accountId,
      error: errorName(error),
    });
  }
}

/** 07 D02: an auth failure has marked the account already; a rate limit blocks it; anything else is 'upstream'. */
function failure(account: SocialAccount, error: unknown): SyncResult {
  if (error instanceof RunStopped) return error.result;
  if (error instanceof SocialAuthError) {
    return { ok: false, reason: "needs_reconnect" };
  }
  if (error instanceof SocialRateLimitError) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSec: error.retryAfterSec,
    };
  }
  logEvent("error", "social.sync_failed", {
    socialAccountId: account.id,
    provider: account.provider,
    error: errorName(error),
  });
  return { ok: false, reason: "upstream_error" };
}

async function runSync(run: Run): Promise<SyncResult> {
  const { account, provider } = run;
  // 07 D13 "step 0": the profile first, so a renamed account shows its new name.
  const profile = await withAccessToken(account.id, (token) =>
    provider.getProfile(token),
  );
  // One UPDATE that checks the run may still write (Q-17 a); it waits for a Disconnect in progress like the lock would.
  const [saved] = await db
    .update(socialAccount)
    .set(profileColumns(profile))
    .where(
      and(
        eq(socialAccount.id, account.id),
        eq(socialAccount.status, "connected"),
        eq(socialAccount.syncStartedAt, run.leasedAt),
      ),
    )
    .returning({ id: socialAccount.id });
  if (!saved) {
    const [row] = await db
      .select(accountGuard)
      .from(socialAccount)
      .where(eq(socialAccount.id, account.id));
    throw new RunStopped(
      stopReason(run, row) ?? { ok: false, reason: "already_syncing" },
    );
  }
  if (lostProfessionalAccount(account.provider, profile.accountType)) {
    await markNeedsReconnect(account.id);
    return { ok: false, reason: "needs_reconnect" };
  }

  const runStartedAt = new Date();
  const before = run.mode === "older" ? await oldestHeldPost(account.id) : null;
  const { reachedEnd, oldestSeen, ...counts } = await listPages(
    run,
    runStartedAt,
    before,
  );
  const removed =
    reachedEnd && run.mode === "recent"
      ? await sweep(run, runStartedAt, oldestSeen)
      : 0;
  return { ok: true, ...counts, removed, hasOlder: !reachedEnd };
}

/** min(posted_at) of the account's available posts: an 'older' run lists before it, held for the whole run. */
async function oldestHeldPost(accountId: string): Promise<Date | null> {
  const [row] = await db
    .select({ oldest: min(socialPost.postedAt) })
    .from(socialPost)
    .where(
      and(
        eq(socialPost.socialAccountId, accountId),
        eq(socialPost.status, "available"),
      ),
    );
  return row?.oldest ?? null;
}

/**
 * Lists and upserts pages until the list ends, maxPosts videos are kept, SOCIAL_SYNC_MAX_PAGES pages were read or the
 * budget is spent. Cursors are never stored. The run reached the end only when the last page was taken whole.
 */
async function listPages(run: Run, now: Date, before: Date | null) {
  const { account, provider } = run;
  const totals = { fetched: 0, kept: 0, upserted: 0, added: 0 };
  let cursor: string | null = null;
  let oldestSeen: Date | null = null;
  for (let page = 1; ; page++) {
    const listing = await withAccessToken(account.id, (token) =>
      provider.listPosts(token, {
        cursor,
        ...(before ? { before } : {}),
      }),
    );
    const videos = listing.posts.filter(isKeptVideo);
    const taken = videos.slice(0, run.maxPosts - totals.kept);
    const written =
      taken.length === 0
        ? { upserted: 0, added: 0 }
        : await whileStillMine(run, (tx) =>
            upsertPosts(tx, account, taken, now),
          );
    totals.fetched += listing.posts.length;
    totals.kept += taken.length;
    totals.upserted += written.upserted;
    totals.added += written.added;
    for (const post of taken) {
      if (!oldestSeen || post.publishedAt < oldestSeen) {
        oldestSeen = post.publishedAt;
      }
    }
    const done =
      listing.nextCursor === null ||
      totals.kept >= run.maxPosts ||
      page >= SOCIAL_SYNC_MAX_PAGES ||
      Date.now() >= run.deadline;
    if (done) {
      const reachedEnd =
        listing.nextCursor === null && taken.length === videos.length;
      return { ...totals, oldestSeen, reachedEnd };
    }
    cursor = listing.nextCursor;
  }
}

/**
 * The removal sweep (07 D13, D72), only after a 'recent' run that reached the end of the list. Posts this run didn't
 * see are deleted when nothing references them (03 §7.2, from the oldest post seen up; every available post when the
 * list was empty); a referenced one becomes 'removed' only when getPost says it is gone, and any doubt keeps it. An
 * 'older' run never sweeps: it lists only posts older than every one held, so it has nothing to judge, and must never
 * judge the newer ones it didn't list.
 */
async function sweep(
  run: Run,
  runStartedAt: Date,
  oldestSeen: Date | null,
): Promise<number> {
  const absent = and(
    eq(socialPost.socialAccountId, run.account.id),
    eq(socialPost.status, "available"),
    lt(socialPost.fetchedAt, runStartedAt),
  );
  // Disjoint sets (unreferenced vs referenced), so the two run together.
  const [deleted, suspects] = await Promise.all([
    whileStillMine(run, (tx) =>
      tx
        .delete(socialPost)
        .where(
          and(
            absent,
            oldestSeen ? gte(socialPost.postedAt, oldestSeen) : undefined,
            notExists(postingOfPost),
          ),
        )
        .returning({ id: socialPost.id }),
    ),
    db
      .select({ id: socialPost.id, providerPostId: socialPost.providerPostId })
      .from(socialPost)
      .where(and(absent, exists(postingOfPost))),
  ]);
  const gone: string[] = [];
  for (const suspect of suspects) {
    if (Date.now() >= run.deadline) break;
    if (await isGone(run, suspect.providerPostId)) gone.push(suspect.id);
  }
  return deleted.length + (await markRemoved(run, gone));
}

/** Whether getPost says the post is gone. Any error but an auth failure or a rate limit keeps the post. */
async function isGone(run: Run, providerPostId: string): Promise<boolean> {
  const { account, provider } = run;
  try {
    const post = await withAccessToken(account.id, (token) =>
      provider.getPost(token, providerPostId, account.providerAccountId),
    );
    return post === null;
  } catch (error) {
    if (
      error instanceof SocialAuthError ||
      error instanceof SocialRateLimitError
    ) {
      throw error;
    }
    logEvent("warn", "social.sweep_check_failed", {
      socialAccountId: account.id,
      provider: account.provider,
      error: errorName(error),
    });
    return false;
  }
}

async function markRemoved(run: Run, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const accountId = run.account.id;
  return whileStillMine(run, async (tx) => {
    const rows = await tx
      .update(socialPost)
      .set({ status: "removed", removedAt: new Date() })
      .where(
        and(
          inArray(socialPost.id, ids),
          eq(socialPost.socialAccountId, accountId),
          eq(socialPost.status, "available"),
        ),
      )
      .returning({ id: socialPost.id });
    // Ids only (07 D47), in one INSERT while the share lock is held; the video page shows "Original post was removed".
    await writeAudits(
      tx,
      run.actor,
      rows.map((row) => ({
        action: "social_post.removed",
        entityType: "social_post",
        entityId: row.id,
        data: { socialPostId: row.id, socialAccountId: accountId },
      })),
    );
    return rows.length;
  });
}

/** One account's outcome in Sync all; P09 names the account in its summary. */
export type AccountSyncResult = { socialAccountId: string; result: SyncResult };

/**
 * Sync all (02 §6.1): the creator's connected accounts one after another, in the Connections order, within one 25 s
 * budget. Accounts the budget didn't reach are left out of the result.
 */
export async function syncCreatorAccounts(
  a: Actor,
): Promise<AccountSyncResult[]> {
  const actor = requireCreatorActor(a);
  const accounts = await db
    .select({ id: socialAccount.id })
    .from(socialAccount)
    .where(
      and(
        eq(socialAccount.creatorId, actor.creatorId),
        eq(socialAccount.status, "connected"),
      ),
    )
    .orderBy(...CONNECTIONS_ORDER);
  const deadline = Date.now() + SYNC_ALL_BUDGET_MS;
  const results: AccountSyncResult[] = [];
  for (const { id } of accounts) {
    const left = deadline - Date.now();
    if (left <= 0) break;
    results.push({
      socialAccountId: id,
      result: await syncSocialAccount(id, actor, {
        budgetMs: Math.min(DEFAULT_BUDGET_MS, left),
      }),
    });
  }
  return results;
}
