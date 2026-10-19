import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, ne, or } from "drizzle-orm";
import { db } from "../../db/client";
import { creatorProfile, socialAccount } from "../../db/schema";
import type { SocialProviderId } from "../../lib/domain/values";
import { writeAudit } from "../audit";
import type { Actor } from "../auth/actor";
import { uniqueViolationConstraint } from "../db-errors";
import { logEvent } from "../log";
import { AlreadyLinkedError } from "./errors";
import { sealTokenColumns, tokenUpdateColumns } from "./tokens";
import type { SocialProfile, SocialProvider, TokenSet } from "./types";

// Linking a platform account to a creator (02 §5.3, §7.2; 03 §5.4, §7.2; 07 D37). The adapter's DTO names map to
// columns once, here (03 DB1): externalAccountId → provider_account_id.

type LinkResult = { socialAccountId: string; created: boolean };

type LinkInput = {
  creatorId: string;
  platform: SocialProviderId;
  tokens: TokenSet;
  profile: SocialProfile;
};

/**
 * Creates the account row, or updates this creator's own row for the same platform account in any status (a reconnect
 * keeps the id, so postings and posts stay attached), in one transaction with its audit row. Throws AlreadyLinkedError
 * when the platform account is live for another creator. No upsert: the token AAD names the row id, which must exist
 * before the tokens are sealed.
 */
export async function linkAccount(i: LinkInput): Promise<LinkResult> {
  try {
    return await linkOnce(i);
  } catch (error) {
    const constraint = uniqueViolationConstraint(error);
    if (constraint === "social_account_live_provider_account_uidx") {
      throw new AlreadyLinkedError();
    }
    // The same creator connected twice at once: the second run finds the first one's row and updates it.
    if (constraint === "social_account_creator_provider_account_uidx") {
      return linkOnce(i);
    }
    throw error;
  }
}

function linkOnce({
  creatorId,
  platform,
  tokens,
  profile,
}: LinkInput): Promise<LinkResult> {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ userId: creatorProfile.userId })
      .from(creatorProfile)
      .where(eq(creatorProfile.id, creatorId))
      .limit(1);
    if (!owner) throw new Error(`creator ${creatorId} not found`);
    const actor: Actor = { kind: "creator", userId: owner.userId, creatorId };

    const rows = await tx
      .select({ id: socialAccount.id, creatorId: socialAccount.creatorId })
      .from(socialAccount)
      .where(
        and(
          eq(socialAccount.provider, platform),
          eq(socialAccount.providerAccountId, profile.externalAccountId),
          or(
            eq(socialAccount.creatorId, creatorId),
            ne(socialAccount.status, "disconnected"),
          ),
        ),
      );
    if (rows.some((row) => row.creatorId !== creatorId)) {
      throw new AlreadyLinkedError();
    }

    const now = new Date();
    const profileColumns = {
      username: profile.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      profileUrl: profile.profileUrl,
      accountType: profile.accountType,
    };
    const own = rows[0];
    const socialAccountId = own?.id ?? randomUUID();
    if (own) {
      // One statement: the live-has-token and disconnected-clean CHECKs need the tokens and the status together.
      await tx
        .update(socialAccount)
        .set({
          ...tokenUpdateColumns(own.id, tokens, now),
          ...profileColumns,
          status: "connected",
          connectedAt: now,
          disconnectedAt: null,
          lastSyncError: null,
          lastSyncErrorAt: null,
        })
        .where(
          and(
            eq(socialAccount.id, own.id),
            eq(socialAccount.creatorId, creatorId),
          ),
        );
    } else {
      await tx.insert(socialAccount).values({
        id: socialAccountId,
        creatorId,
        provider: platform,
        providerAccountId: profile.externalAccountId,
        ...profileColumns,
        ...sealTokenColumns(socialAccountId, tokens, now),
        status: "connected",
        connectedAt: now,
      });
    }
    const created = !own;
    // Ids only: never a username, a token or a URL.
    await writeAudit(tx, actor, {
      action: "social_account.linked",
      entityType: "social_account",
      entityId: socialAccountId,
      data: { socialAccountId, provider: platform, created },
    });
    return { socialAccountId, created };
  });
}

/** Revokes tokens we won't keep (a refused connect, 07 D37); a failure is logged without token values and swallowed. */
export async function revokeQuietly(
  provider: SocialProvider,
  tokens: TokenSet,
): Promise<void> {
  try {
    await provider.revoke(tokens);
  } catch (error) {
    logEvent("warn", "social.revoke_failed", {
      provider: provider.platform,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
