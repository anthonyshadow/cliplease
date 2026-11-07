import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { license, licenseRequest } from "@/db/schema";
import type { License, LicenseRequest } from "@/db/schema/types";
import { LicenseSnapshotV1Schema } from "@/lib/licensing/snapshot";
import { isUuid } from "@/lib/validation/uuid";
import { bytesEqual } from "../crypto/hmac";
import { decryptSecret, encryptSecret } from "../crypto/token-cipher";

// The buyer's private link key (02 §5.11, §9.5; 07 D14): 32 random bytes in base64url. The row keeps its sha256 for
// lookups and a sealed copy for building links; the key itself is never stored or logged. Only the email sender (P17)
// and the dev-only fake checkout (owner answer Q-118 a, src/server/payments/fake-checkout.ts) reveal it.

/** 32 bytes in base64url: 43 characters of A–Z, a–z, 0–9, "-" and "_". */
const BUYER_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Whether `token` can be a buyer key at all: checked before any query, and before a link is built from it. */
export const isBuyerToken = (token: string) => BUYER_TOKEN.test(token);

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
  if (!isUuid(requestId) || !isBuyerToken(token)) return null;
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

/** What /l, its two download routes and the license PDF read for a buyer link (03 §7.6, P20's part). */
export type BuyerLicense = {
  /** The license columns; `snapshot` checked against LicenseSnapshotV1Schema. */
  license: Pick<
    License,
    | "id"
    | "code"
    | "startsAt"
    | "endsAt"
    | "revokedAt"
    | "createdAt"
    | "exclusive"
    | "snapshot"
    | "originalObjectKey"
    | "originalBytes"
    | "originalMime"
  >;
  /**
   * The request facts the record prints next to its snapshot, which never change after checkout (owner answer Q-183).
   * `buyerEmail` is for the masked receipt line only.
   */
  request: Pick<
    LicenseRequest,
    | "id"
    | "territoryCode"
    | "termsAcceptedAt"
    | "amountTotalCents"
    | "currency"
    | "buyerEmail"
  >;
};

/**
 * The license a buyer link opens (02 §9.5; 03 §7.6): the approved request whose stored hash is the key's
 * (license_request_buyer_token_hash_uidx; the hash of a 32-byte key, so the index lookup tells a guesser nothing), then
 * its license (license_license_request_uidx). null for anything that can't be a key (checked before the query), an
 * unknown key, a request that isn't approved, or no license. 03 §7.6's renewal plan and refund columns come with P22b
 * and P21b.
 */
export async function findLicenseForBuyer(
  token: string,
): Promise<BuyerLicense | null> {
  if (!isBuyerToken(token)) return null;
  const [row] = await db
    .select({
      license: {
        id: license.id,
        code: license.code,
        startsAt: license.startsAt,
        endsAt: license.endsAt,
        revokedAt: license.revokedAt,
        createdAt: license.createdAt,
        exclusive: license.exclusive,
        snapshot: license.snapshot,
        originalObjectKey: license.originalObjectKey,
        originalBytes: license.originalBytes,
        originalMime: license.originalMime,
      },
      request: {
        id: licenseRequest.id,
        territoryCode: licenseRequest.territoryCode,
        termsAcceptedAt: licenseRequest.termsAcceptedAt,
        amountTotalCents: licenseRequest.amountTotalCents,
        currency: licenseRequest.currency,
        buyerEmail: licenseRequest.buyerEmail,
      },
    })
    .from(licenseRequest)
    .innerJoin(license, eq(license.licenseRequestId, licenseRequest.id))
    .where(
      and(
        eq(licenseRequest.buyerTokenHash, hashBuyerToken(token)),
        eq(licenseRequest.status, "approved"),
      ),
    );
  if (!row) return null;
  const snapshot = LicenseSnapshotV1Schema.parse(row.license.snapshot);
  return { license: { ...row.license, snapshot }, request: row.request };
}
