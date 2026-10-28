import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { licenseRequest } from "@/db/schema";
import type { LicenseRequest } from "@/db/schema/types";
import { isUuid } from "@/lib/validation/uuid";
import { bytesEqual } from "../crypto/hmac";
import { decryptSecret, encryptSecret } from "../crypto/token-cipher";

// The buyer's private link key (02 §5.11, §9.5; 07 D14): 32 random bytes in base64url. The row keeps its sha256 for
// lookups and a sealed copy for building links; the key itself is never stored or logged. Only the email sender (P17)
// and the dev-only fake checkout (owner answer Q-118 a, src/server/payments/fake-checkout.ts) reveal it.

/** 32 bytes in base64url: 43 characters of A–Z, a–z, 0–9, "-" and "_". */
const BUYER_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The sealed copy's AAD: it names the column and the row, so a copy moved to another row never opens. */
export const buyerTokenAad = (requestId: string) =>
  `license_request.buyer_token:${requestId}`;

/** A new key for request `requestId`, its hash and its sealed copy (`v1.…`). */
export function generateBuyerToken(requestId: string): {
  token: string;
  hash: string;
  enc: string;
} {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: hashBuyerToken(token),
    enc: encryptSecret(token, buyerTokenAad(requestId)),
  };
}

/** sha256(token), lowercase hex: the value buyer_token_hash stores. */
export function hashBuyerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** The key behind a row's sealed copy. Throws TokenCipherError when the copy doesn't belong to that row. */
export function revealBuyerToken(
  row: Pick<LicenseRequest, "id" | "buyerTokenEnc">,
): string {
  return decryptSecret(row.buyerTokenEnc, buyerTokenAad(row.id));
}

/**
 * The request a buyer link opens: the row by its id, then its stored hash against the key's in constant time. null for
 * a wrong key, an unknown id or anything that can't be either (checked before the query, so a bad id never reaches
 * Postgres). The whole row: pages pass on only what they show.
 */
export async function findRequestForBuyer(
  requestId: string,
  token: string,
): Promise<LicenseRequest | null> {
  if (!isUuid(requestId) || !BUYER_TOKEN.test(token)) return null;
  const [row] = await db
    .select()
    .from(licenseRequest)
    .where(eq(licenseRequest.id, requestId));
  if (!row) return null;
  const matches = bytesEqual(
    Buffer.from(row.buyerTokenHash, "hex"),
    Buffer.from(hashBuyerToken(token), "hex"),
  );
  return matches ? row : null;
}
