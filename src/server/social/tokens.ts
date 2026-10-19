import "server-only";
import { eq } from "drizzle-orm";
import type { db } from "../../db/client";
import { socialAccount } from "../../db/schema";
import type { NewSocialAccount } from "../../db/schema/types";
import { encryptSecret } from "../crypto/token-cipher";
import type { TokenSet } from "./types";

// Platform tokens at rest (02 §5.3, §7.3; 03 §3.5): sealed per column and row, so a payload can't be moved to another
// row or column. The only module that decrypts platform tokens; P07's getFreshAccessToken arrives here.

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
