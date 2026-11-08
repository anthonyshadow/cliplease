import "server-only";
import { and, eq, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { license, licenseRequest } from "@/db/schema";
import type { License, LicenseRequest } from "@/db/schema/types";
import { LicenseSnapshotV1Schema } from "@/lib/licensing/snapshot";

// A buyer's license as /l, My licenses, their download routes and the license PDF read it (03 §7.6): one column list
// and one snapshot check for the buyer link (findLicenseForBuyer, by the key's hash) and the session (getBuyerLicense,
// by the license id and the signed-in email). Only the match differs, and each caller builds its own.

/** A buyer's approved license and the request facts its record prints (03 §7.6; P20, P20b). */
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
 * The license of the approved request that every condition in `match` picks (at least one, a unique column of
 * license_request or license among them), or null when there is none: a request that isn't approved never opens one. 03 §7.6's renewal
 * plan and refund columns come with P22b and P21b.
 */
export async function readBuyerLicense(
  ...match: [SQL, ...SQL[]]
): Promise<BuyerLicense | null> {
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
    .where(and(...match, eq(licenseRequest.status, "approved")));
  if (!row) return null;
  const snapshot = LicenseSnapshotV1Schema.parse(row.license.snapshot);
  return { license: { ...row.license, snapshot }, request: row.request };
}
