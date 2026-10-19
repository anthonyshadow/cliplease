import "server-only";
import { and, eq, ne, notExists, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { socialAccount, socialPost } from "../../db/schema";
import { writeAudit } from "../audit";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { revokeQuietly } from "./link";
import { getProvider } from "./registry";
import { postingOfPost } from "./sync";
import { getTokenSetForRevoke } from "./tokens";
import type { RevokeOutcome } from "./types";

// Disconnect (02 §7.8, 03 §9.3, 06 §12, 07 D72): a best-effort revoke at the platform, then one transaction that wipes
// the account, deletes its posts nothing references and scrubs the referenced ones. Videos and postings are never
// touched: verified postings stay verified and read "· no longer linked" (OQ-14). Relative imports, as in sync.ts.

/** 03 §9.3: the account keeps only its ids, provider and dates; the CHECK `social_account_disconnected_clean` needs it in one UPDATE. */
const WIPED_ACCOUNT = {
  status: "disconnected",
  disconnectedAt: sql`now()`,
  accessTokenEnc: null,
  refreshTokenEnc: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
  scopes: sql`'{}'`,
  username: null,
  displayName: null,
  avatarUrl: null,
  profileUrl: null,
  accountType: null,
  syncStartedAt: null,
  syncBlockedUntil: null,
  lastSyncError: null,
  lastSyncErrorAt: null,
} as const;

/** 03 §9.2's scrub: a referenced post keeps provider, provider_post_id, permalink, media_type and link_key (07 D72). */
const STALE_POST = {
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
} as const;

/**
 * Disconnects the creator's account. Null when it isn't theirs; an account already disconnected is a no-op
 * (`unsupported`, no platform call). A revoke problem never stops the disconnect: it is reported as `failed`.
 */
export async function disconnectSocialAccount(
  accountId: string,
  a: Actor,
): Promise<{ revoked: RevokeOutcome } | null> {
  const actor = requireCreatorActor(a);
  const [account] = await db
    .select({ provider: socialAccount.provider, status: socialAccount.status })
    .from(socialAccount)
    .where(
      and(
        eq(socialAccount.id, accountId),
        eq(socialAccount.creatorId, actor.creatorId),
      ),
    );
  if (!account) return null;
  if (account.status === "disconnected") return { revoked: "unsupported" };

  const revoked = await revokeBeforeWipe(accountId, account.provider);
  const wiped = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(socialAccount)
      .set(WIPED_ACCOUNT)
      .where(
        and(
          eq(socialAccount.id, accountId),
          eq(socialAccount.creatorId, actor.creatorId),
          ne(socialAccount.status, "disconnected"),
        ),
      )
      .returning({ id: socialAccount.id });
    // A Disconnect that ran at the same time got here first.
    if (!row) return false;
    await tx
      .delete(socialPost)
      .where(
        and(
          eq(socialPost.socialAccountId, accountId),
          notExists(postingOfPost),
        ),
      );
    await tx
      .update(socialPost)
      .set(STALE_POST)
      .where(eq(socialPost.socialAccountId, accountId));
    // Ids only (07 D47).
    await writeAudit(tx, actor, {
      action: "social_account.disconnected",
      entityType: "social_account",
      entityId: accountId,
      data: { socialAccountId: accountId, provider: account.provider, revoked },
    });
    return true;
  });
  return { revoked: wiped ? revoked : "unsupported" };
}

/** 03 §9.3 step 1: revoke at the platform before the tokens are wiped; never inside a transaction, never fatal. */
async function revokeBeforeWipe(
  accountId: string,
  platform: string,
): Promise<RevokeOutcome> {
  const provider = getProvider(platform);
  if (!provider?.capabilities.canRevoke) return "unsupported";
  const tokens = await getTokenSetForRevoke(accountId);
  return tokens ? revokeQuietly(provider, tokens, accountId) : "failed";
}
