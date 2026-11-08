import type { RecordStatus } from "../../src/lib/licensing/license-record";
import type { SessionUser } from "../../src/server/auth/session";
import type { BuyerLicenseDetail } from "../../src/server/buyers/queries";
import { FIRST_SNOW } from "./license-snapshot-fixtures";

// The signed-in buyer and their license as getBuyerLicense answers it, for the unit tests of /licenses/[licenseId] and
// its two session download routes (P20b): FIRST_SNOW's license, an 84 MB MP4 original, a CA$1,732.50 request. No
// database: a test passes the status and states only what it changes.

export const BUYER: SessionUser = {
  id: "user-ana",
  email: "ana.buyer@studio.com",
  name: "",
  role: "creator",
};

export const LICENSE_ID = "0b8f4c1e-6a2d-4e8b-9f3a-5c7d1e2f3a4b";

/** The license's own copy of the original's key (DB13). */
export const KEY = "originals/creator/video.mp4";

/** getBuyerLicense's answer at `status` (revokedAt set when revoked). */
export function buyerLicenseDetail(
  status: RecordStatus = "valid",
  over: Partial<BuyerLicenseDetail["license"]> = {},
): BuyerLicenseDetail {
  return {
    license: {
      id: LICENSE_ID,
      code: FIRST_SNOW.code,
      startsAt: new Date(FIRST_SNOW.startsAt),
      endsAt: FIRST_SNOW.endsAt ? new Date(FIRST_SNOW.endsAt) : null,
      revokedAt:
        status === "revoked" ? new Date("2026-10-20T09:15:00.000Z") : null,
      createdAt: new Date(FIRST_SNOW.issuedAt),
      exclusive: false,
      snapshot: FIRST_SNOW,
      originalObjectKey: KEY,
      originalBytes: 84 * 1024 ** 2,
      originalMime: "video/mp4",
      ...over,
    },
    request: {
      id: "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      territoryCode: null,
      termsAcceptedAt: new Date(FIRST_SNOW.startsAt),
      amountTotalCents: 173_250,
      currency: "cad",
      buyerEmail: BUYER.email,
    },
    status,
  };
}
