import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
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
// status 'needs_reconnect' (07 D02, D12). A token the platform refused marks the account only while the row still holds
// it (token_refreshed_at, 07 D12b), so a reconnect that lands meanwhile stays connected. Nothing here logs a token.

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

/** The token_refreshed_at of the tokens the last platform call used: the ones a SocialAuthError says are dead. */
type Seen = { refreshedAt?: Date | null };

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

/**
 * 02 §7.4 step 3: the row lock serializes refreshes, so a rotated refresh token is used once (ADR-13). Only the lock
 * holder calls the platform; a waiter re-checks the locked row and takes the token the holder stored. Inside, only `tx`
 * runs queries: every caller may be holding a pool connection while it waits. The platform call is the only external
 * call allowed inside a transaction (07 D12, D24). Its 10 s deadline aborts the request itself, so a token set that
 * does arrive is always stored, never dropped after the platform rotated the refresh token.
 */
async function refreshUnderLock(
  accountId: string,
  seen?: Seen,
): Promise<{ tokens: TokenSet; refreshedAt: Date | null }> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '12s'`);
      const [row] = await tx
        .select(tokenColumns)
        .from(socialAccount)
        .where(eq(socialAccount.id, accountId))
        .for("update");
      if (seen && row) seen.refreshedAt = row.tokenRefreshedAt;
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
      const next = await provider.refreshToken(current, {
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      });
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

async function freshToken(accountId: string, seen: Seen): Promise<HeldToken> {
  const row = await readTokenRow(accountId);
  if (row) seen.refreshedAt = row.tokenRefreshedAt;
  const held = row ? heldToken(accountId, row) : null;
  const decision = row ? refreshDecision(row.provider, row, new Date()) : null;
  if (!held || decision === "reconnect") throw new SocialAuthError();
  if (decision === "use") return held;
  const { tokens, refreshedAt } = await refreshUnderLock(accountId, seen);
  return { token: tokens.accessToken, refreshedAt };
}

/**
 * 07 D02's one rule, in one place: a SocialAuthError that leaves this module means the account must reconnect. It runs
 * after any refresh transaction has ended, and markNeedsReconnect does nothing to an account that isn't connected or
 * no longer holds the tokens `work` saw refused. When a reconnect stored new tokens meanwhile, the error becomes a
 * SocialUpstreamError: the account is fine, so nobody is told to reconnect it.
 */
async function orReconnect<T>(
  accountId: string,
  work: (seen: Seen) => Promise<T>,
): Promise<T> {
  const seen: Seen = {};
  try {
    return await work(seen);
  } catch (error) {
    if (
      error instanceof SocialAuthError &&
      !(await markNeedsReconnect(accountId, seen.refreshedAt)) &&
      (await readTokenRow(accountId))?.status === "connected"
    ) {
      // A reconnect replaced the refused tokens meanwhile: the account is fine, only this call failed.
      throw new SocialUpstreamError("tokens replaced during the call");
    }
    throw error;
  }
}

/**
 * A usable access token for a connected account, refreshed first when it is due (02 §7.4). Throws SocialAuthError when
 * the account isn't connected or must reconnect (the account is then needs_reconnect), SocialUpstreamError when the
 * refresh timed out, waited too long for the lock, or was refused while a reconnect stored new tokens.
 */
export async function getFreshAccessToken(accountId: string): Promise<string> {
  return orReconnect(
    accountId,
    async (seen) => (await freshToken(accountId, seen)).token,
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
  return orReconnect(accountId, async (seen) => {
    const held = await freshToken(accountId, seen);
    seen.refreshedAt = held.refreshedAt;
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
      seen.refreshedAt = current.refreshedAt;
      return fn(current.token);
    }
  });
}

/**
 * The tokens in the clear for Disconnect's best-effort revoke (03 §9.3 step 1). A connected account's expired access
 * token is refreshed first, under the lock (07 D12); an expired token on an account that must reconnect can't be.
 * 'none' when there is nothing to revoke (no token left, or only an expired one that can't be refreshed), 'failed' when
 * reading or refreshing them fails. It never marks the account: Disconnect wipes it next.
 */
export async function getTokenSetForRevoke(
  accountId: string,
): Promise<TokenSet | "none" | "failed"> {
  try {
    const row = await readTokenRow(accountId);
    if (!row?.accessTokenEnc || row.status === "disconnected") return "none";
    const expired =
      row.accessTokenExpiresAt !== null &&
      row.accessTokenExpiresAt.getTime() <= Date.now();
    if (!expired) return openTokenSet(accountId, row);
    if (row.status !== "connected") return "none";
    return (await refreshUnderLock(accountId)).tokens;
  } catch (error) {
    logEvent("warn", "social.revoke_tokens_failed", {
      socialAccountId: accountId,
      error: errorName(error),
    });
    return "failed";
  }
}

/**
 * The account must reconnect (07 D02): status 'needs_reconnect', only while it is connected, with an ids-only audit row
 * (07 D47). Given `tokenRefreshedAt`, only while the row still holds those tokens: a reconnect or refresh that stored
 * new ones meanwhile wins. The tokens stay sealed in place until a reconnect or a disconnect. Every other module calls
 * this. True when it marked the account.
 */
export async function markNeedsReconnect(
  accountId: string,
  tokenRefreshedAt?: Date | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(socialAccount)
      .set({ status: "needs_reconnect" })
      .where(
        and(
          eq(socialAccount.id, accountId),
          eq(socialAccount.status, "connected"),
          tokenRefreshedAt === undefined
            ? undefined
            : tokenRefreshedAt === null
              ? isNull(socialAccount.tokenRefreshedAt)
              : eq(socialAccount.tokenRefreshedAt, tokenRefreshedAt),
        ),
      )
      .returning({ id: socialAccount.id });
    if (!row) return false;
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
    return true;
  });
}
