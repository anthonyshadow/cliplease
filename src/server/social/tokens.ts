import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { socialAccount } from "../../db/schema";
import type { NewSocialAccount, SocialAccount } from "../../db/schema/types";
import type { SocialProviderId } from "../../lib/domain/values";
import { DAY_MS, MINUTE_MS } from "../../lib/time";
import { writeAudit } from "../audit";
import { decryptSecret, encryptSecret } from "../crypto/token-cipher";
import { isLockTimeout } from "../db-errors";
import { errorName, logEvent } from "../log";
import { SocialAuthError, SocialUpstreamError } from "./errors";
import { getProvider } from "./registry";
import type { TokenSet } from "./types";

// Platform tokens at rest (02 §5.3, §7.3, §7.4; 03 §3.5): sealed per column and row, so a payload can't be moved to
// another row or column. The only module that decrypts platform tokens, and markNeedsReconnect is the only writer of
// status 'needs_reconnect' (07 D02, D12). Nothing here logs a token.

export const accessTokenAad = (accountId: string) =>
  `social_account.access_token:${accountId}`;
export const refreshTokenAad = (accountId: string) =>
  `social_account.refresh_token:${accountId}`;

type TokenColumns = Pick<
  NewSocialAccount,
  | "accessTokenEnc"
  | "refreshTokenEnc"
  | "accessTokenExpiresAt"
  | "refreshTokenExpiresAt"
  | "scopes"
  | "tokenRefreshedAt"
>;

/** The sealed token columns for an INSERT; the account id must exist first, because it is part of the AAD. */
export function sealTokenColumns(
  accountId: string,
  t: TokenSet,
  now = new Date(),
): TokenColumns {
  return {
    accessTokenEnc: encryptSecret(t.accessToken, accessTokenAad(accountId)),
    refreshTokenEnc:
      t.refreshToken === null
        ? null
        : encryptSecret(t.refreshToken, refreshTokenAad(accountId)),
    accessTokenExpiresAt: t.accessTokenExpiresAt,
    refreshTokenExpiresAt: t.refreshTokenExpiresAt,
    scopes: t.scopes,
    tokenRefreshedAt: now,
  };
}

/** The columns for an UPDATE: a token set without a refresh token keeps the stored one and its expiry (03 §7.2). */
export function tokenUpdateColumns(
  accountId: string,
  t: TokenSet,
  now = new Date(),
): Partial<TokenColumns> {
  const columns = sealTokenColumns(accountId, t, now);
  if (t.refreshToken !== null) return columns;
  const {
    refreshTokenEnc: _token,
    refreshTokenExpiresAt: _expiry,
    ...kept
  } = columns;
  return kept;
}

/** Stores a new token set on an existing row: both expiries, the scopes and token_refreshed_at = now. */
export async function storeTokens(
  tx: Pick<typeof db, "update">,
  accountId: string,
  t: TokenSet,
  now = new Date(),
): Promise<void> {
  await tx
    .update(socialAccount)
    .set(tokenUpdateColumns(accountId, t, now))
    .where(eq(socialAccount.id, accountId));
}

const INSTAGRAM_REFRESH_WINDOW_MS = 30 * DAY_MS;
const INSTAGRAM_MIN_TOKEN_AGE_MS = DAY_MS;
const REFRESH_MARGIN_MS = 5 * MINUTE_MS;
const REFRESH_TIMEOUT_MS = 10_000;

/**
 * What to do with a stored access token (02 §7.4 step 2, 07 D12). Instagram refreshes a long-lived token in its last
 * 30 days, at most once a day, and can't revive an expired one; TikTok, YouTube and the mock refresh in the last 5 minutes.
 * A token without an expiry is used as it is.
 */
export function refreshDecision(
  provider: SocialProviderId,
  row: { accessTokenExpiresAt: Date | null; tokenRefreshedAt: Date | null },
  now: Date,
): "use" | "refresh" | "reconnect" {
  if (!row.accessTokenExpiresAt) return "use";
  const left = row.accessTokenExpiresAt.getTime() - now.getTime();
  if (provider !== "instagram") {
    return left < REFRESH_MARGIN_MS ? "refresh" : "use";
  }
  if (left <= 0) return "reconnect";
  const refreshedLongAgo =
    row.tokenRefreshedAt === null ||
    row.tokenRefreshedAt.getTime() <=
      now.getTime() - INSTAGRAM_MIN_TOKEN_AGE_MS;
  return left < INSTAGRAM_REFRESH_WINDOW_MS && refreshedLongAgo
    ? "refresh"
    : "use";
}

/** An access token in the clear, with the token_refreshed_at it was read with (for withAccessToken's retry). */
type HeldToken = { token: string; refreshedAt: Date | null };

const tokenColumns = {
  provider: socialAccount.provider,
  status: socialAccount.status,
  scopes: socialAccount.scopes,
  accessTokenEnc: socialAccount.accessTokenEnc,
  refreshTokenEnc: socialAccount.refreshTokenEnc,
  accessTokenExpiresAt: socialAccount.accessTokenExpiresAt,
  refreshTokenExpiresAt: socialAccount.refreshTokenExpiresAt,
  tokenRefreshedAt: socialAccount.tokenRefreshedAt,
};

type TokenRow = NonNullable<Awaited<ReturnType<typeof readTokenRow>>>;

/** The row's tokens in the clear: the inverse of sealTokenColumns. The row must hold an access token. */
function openTokenSet(accountId: string, row: TokenRow): TokenSet {
  if (row.accessTokenEnc === null) throw new SocialAuthError();
  return {
    accessToken: decryptSecret(row.accessTokenEnc, accessTokenAad(accountId)),
    accessTokenExpiresAt: row.accessTokenExpiresAt,
    refreshToken:
      row.refreshTokenEnc === null
        ? null
        : decryptSecret(row.refreshTokenEnc, refreshTokenAad(accountId)),
    refreshTokenExpiresAt: row.refreshTokenExpiresAt,
    scopes: row.scopes,
  };
}

/** The row's access token, or null unless the account is connected. */
function heldToken(
  accountId: string,
  row: Pick<SocialAccount, "status" | "accessTokenEnc" | "tokenRefreshedAt">,
): HeldToken | null {
  if (row.status !== "connected" || row.accessTokenEnc === null) return null;
  return {
    token: decryptSecret(row.accessTokenEnc, accessTokenAad(accountId)),
    refreshedAt: row.tokenRefreshedAt,
  };
}

async function readTokenRow(accountId: string) {
  const [row] = await db
    .select(tokenColumns)
    .from(socialAccount)
    .where(eq(socialAccount.id, accountId));
  return row ?? null;
}

/** Rejects with SocialUpstreamError after `ms`; the timer never outlives the call. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SocialUpstreamError()), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 02 §7.4 step 3: the row lock serializes refreshes, so a rotated refresh token is used once (ADR-13). Only the lock
 * holder calls the platform; a waiter re-checks the locked row and takes the token the holder stored. Inside, only `tx`
 * runs queries: every caller may be holding a pool connection while it waits. The platform call is the only external
 * call allowed inside a transaction (07 D12, D24).
 */
async function refreshUnderLock(
  accountId: string,
): Promise<{ tokens: TokenSet; refreshedAt: Date | null }> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '12s'`);
      const [row] = await tx
        .select(tokenColumns)
        .from(socialAccount)
        .where(eq(socialAccount.id, accountId))
        .for("update");
      const now = new Date();
      const decision = row ? refreshDecision(row.provider, row, now) : null;
      if (row?.status !== "connected" || decision === "reconnect") {
        throw new SocialAuthError();
      }
      const current = openTokenSet(accountId, row);
      if (decision === "use") {
        return { tokens: current, refreshedAt: row.tokenRefreshedAt };
      }

      const provider = getProvider(row.provider);
      if (!provider) throw new SocialUpstreamError();
      const next = await withTimeout(
        provider.refreshToken(current),
        REFRESH_TIMEOUT_MS,
      );
      // The scopes stay those granted at connect (03 §7.2's refresh UPDATE leaves them alone), and a set without a
      // refresh token keeps the stored one (storeTokens).
      const stored: TokenSet = {
        ...next,
        ...(next.refreshToken === null
          ? {
              refreshToken: current.refreshToken,
              refreshTokenExpiresAt: current.refreshTokenExpiresAt,
            }
          : {}),
        scopes: row.scopes,
      };
      await storeTokens(tx, accountId, stored, now);
      return { tokens: stored, refreshedAt: now };
    });
  } catch (error) {
    throw isLockTimeout(error) ? new SocialUpstreamError() : error;
  }
}

async function freshToken(accountId: string): Promise<HeldToken> {
  const row = await readTokenRow(accountId);
  const held = row ? heldToken(accountId, row) : null;
  const decision = row ? refreshDecision(row.provider, row, new Date()) : null;
  if (!held || decision === "reconnect") throw new SocialAuthError();
  if (decision === "use") return held;
  const { tokens, refreshedAt } = await refreshUnderLock(accountId);
  return { token: tokens.accessToken, refreshedAt };
}

/**
 * 07 D02's one rule, in one place: a SocialAuthError that leaves this module means the account must reconnect. It runs
 * after any refresh transaction has ended, and markNeedsReconnect does nothing to an account that isn't connected.
 */
async function orReconnect<T>(
  accountId: string,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SocialAuthError) await markNeedsReconnect(accountId);
    throw error;
  }
}

/**
 * A usable access token for a connected account, refreshed first when it is due (02 §7.4). Throws SocialAuthError when
 * the account isn't connected or must reconnect (the account is then needs_reconnect), SocialUpstreamError when the
 * refresh timed out or waited too long for the lock.
 */
export async function getFreshAccessToken(accountId: string): Promise<string> {
  return orReconnect(
    accountId,
    async () => (await freshToken(accountId)).token,
  );
}

/**
 * Runs one platform call with a fresh token (02 §7.4 step 3b, 07 D12b). On SocialAuthError it re-reads the row: when
 * another request refreshed the token meanwhile, it retries once with that token; otherwise, or when the retry fails the
 * same way, the account becomes needs_reconnect and the error is rethrown.
 */
export async function withAccessToken<T>(
  accountId: string,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  return orReconnect(accountId, async () => {
    const held = await freshToken(accountId);
    try {
      return await fn(held.token);
    } catch (error) {
      if (!(error instanceof SocialAuthError)) throw error;
      const row = await readTokenRow(accountId);
      const current = row ? heldToken(accountId, row) : null;
      const refreshedMeanwhile =
        current !== null &&
        current.refreshedAt?.getTime() !== held.refreshedAt?.getTime();
      if (!refreshedMeanwhile) throw error;
      return fn(current.token);
    }
  });
}

/**
 * The tokens in the clear for Disconnect's best-effort revoke (03 §9.3 step 1). A connected account's expired access
 * token is refreshed first, under the lock (07 D12); an expired token on an account that must reconnect can't be.
 * Null when there is nothing to revoke or anything fails. It never marks the account: Disconnect wipes it next.
 */
export async function getTokenSetForRevoke(
  accountId: string,
): Promise<TokenSet | null> {
  try {
    const row = await readTokenRow(accountId);
    if (!row?.accessTokenEnc || row.status === "disconnected") return null;
    const expired =
      row.accessTokenExpiresAt !== null &&
      row.accessTokenExpiresAt.getTime() <= Date.now();
    if (!expired) return openTokenSet(accountId, row);
    if (row.status !== "connected") return null;
    return (await refreshUnderLock(accountId)).tokens;
  } catch (error) {
    logEvent("warn", "social.revoke_tokens_failed", {
      socialAccountId: accountId,
      error: errorName(error),
    });
    return null;
  }
}

/**
 * The account must reconnect (07 D02): status 'needs_reconnect', only while it is connected, with an ids-only audit row
 * (07 D47). The tokens stay sealed in place until a reconnect or a disconnect. Every other module calls this.
 */
export async function markNeedsReconnect(accountId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(socialAccount)
      .set({ status: "needs_reconnect" })
      .where(
        and(
          eq(socialAccount.id, accountId),
          eq(socialAccount.status, "connected"),
        ),
      )
      .returning({ id: socialAccount.id });
    if (!row) return;
    await writeAudit(
      tx,
      { kind: "system", source: "lazy" },
      {
        action: "social_account.needs_reconnect",
        entityType: "social_account",
        entityId: row.id,
        data: { socialAccountId: row.id },
      },
    );
  });
}
