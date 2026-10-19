import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../../db/client";
import { socialAccount, socialPost } from "../../db/schema";
import type {
  SocialAccountStatus,
  SocialProviderId,
} from "../../lib/domain/values";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { CONNECTIONS_ORDER, visiblePostsWhere } from "../social/sync";

// Library reads (02 §5.4). P06 started the account summaries the connect step and Connections show; P07 adds the sync
// fields, P08 the rest of the DTO, and P09 the posts.

/** 02 §5.4's AccountSummaryDTO, without P08's avatarSrc and syncProblem. */
export type AccountSummaryDTO = {
  id: string;
  platform: SocialProviderId;
  username: string | null;
  displayName: string | null;
  status: SocialAccountStatus;
  /** ISO time of the last sync that finished. */
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  hasOlder: boolean;
  /** The account's posts the creator can see (visiblePostsWhere). */
  postCount: number;
};

/** The creator's linked accounts (not disconnected), in the UI's platform order, oldest connect first. */
export async function listAccountSummaries(
  a: Actor,
): Promise<AccountSummaryDTO[]> {
  const actor = requireCreatorActor(a);
  const accounts = await db
    .select({
      id: socialAccount.id,
      platform: socialAccount.provider,
      username: socialAccount.username,
      displayName: socialAccount.displayName,
      status: socialAccount.status,
      lastSyncedAt: socialAccount.lastSyncedAt,
      lastSyncError: socialAccount.lastSyncError,
      hasOlder: socialAccount.hasOlder,
      postCount: db.$count(
        socialPost,
        and(
          eq(socialPost.socialAccountId, socialAccount.id),
          visiblePostsWhere(actor.creatorId),
        ),
      ),
    })
    .from(socialAccount)
    .where(
      and(
        eq(socialAccount.creatorId, actor.creatorId),
        ne(socialAccount.status, "disconnected"),
      ),
    )
    .orderBy(...CONNECTIONS_ORDER);
  return accounts.map((account) => ({
    ...account,
    lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
  }));
}
