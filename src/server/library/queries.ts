import "server-only";
import { and, countDistinct, eq, ne, sql } from "drizzle-orm";
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
import { type Actor, requireCreatorActor } from "../auth/actor";
import { deriveConnectionState } from "../social/connection-state";
import { CONNECTIONS_ORDER, visiblePostsWhere } from "../social/sync";

// Library reads (02 §5.4). P06 started the account summaries the connect step and Connections show, P07 added the sync
// fields and P08 completes the DTO; P09 adds the posts.

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
      // The database's clock, the one that set sync_blocked_until and sync_started_at.
      now: sql<Date>`now()`,
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
    const state = deriveConnectionState(row, new Date(now));
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
    };
  });
}

/** Published videos with a verified posting, counted per account (07 D72); `accountId` narrows it to one. */
async function liveVideoCounts(
  creatorId: string,
  accountId?: string,
): Promise<Map<string, number>> {
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
        accountId ? eq(videoPosting.socialAccountId, accountId) : undefined,
      ),
    )
    .groupBy(videoPosting.socialAccountId);
  return new Map(
    rows.flatMap((r) => (r.accountId ? [[r.accountId, r.live] as const] : [])),
  );
}

/** The Disconnect sheet's "{n} live videos came from @{username}" for every account, in one query. */
export async function countLiveVideosByAccount(
  a: Actor,
): Promise<ReadonlyMap<string, number>> {
  return liveVideoCounts(requireCreatorActor(a).creatorId);
}

/** The same count for one account. */
export async function countLiveVideosFromAccount(
  a: Actor,
  accountId: string,
): Promise<number> {
  const counts = await liveVideoCounts(
    requireCreatorActor(a).creatorId,
    accountId,
  );
  return counts.get(accountId) ?? 0;
}
