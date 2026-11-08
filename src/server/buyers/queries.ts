import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { license, licenseRequest } from "@/db/schema";
import {
  type RecordStatus,
  recordStatus,
} from "@/lib/licensing/license-record";
import { normalizeEmail } from "@/lib/validation/email";
import { isUuid } from "@/lib/validation/uuid";
import type { SessionUser } from "../auth/session";
import {
  type BuyerLicense,
  readBuyerLicense,
} from "../licensing/buyer-license";
import { rethrowRedacted } from "../rethrow-redacted";
import { ownedBy } from "./owned-by";

// My licenses (S30, S31; 03 §7.11, §7.6; 07 D126): a signed-in buyer's licenses, matched by the session's email in its
// stored form (normalizeEmail, which license_request_buyer_email_lower holds every row to) on approved requests only.
// Never through the buyer key: this module doesn't import it (02 §9.5). Every query's error goes through
// rethrowRedacted, since its message would carry the email (02 §9.9, 07 D47).

/** 03 §7.11: the newest 100 (license_request_buyer_email_created_idx). */
const LIST_LIMIT = 100;

/** One My licenses row (02 §5.14; owner answer Q-192: no amount). Dates are ISO 8601. */
export type BuyerLicenseRow = {
  licenseId: string;
  videoId: string;
  code: string;
  /** The snapshot's, as the record keeps them (07 D71). */
  videoTitle: string;
  creatorHandle: string;
  /** publicStatus at the time of the read; `upcoming` comes with P22b (07 D117). */
  status: RecordStatus;
  exclusive: boolean;
  startsAt: string;
  /** null = perpetual. */
  endsAt: string | null;
  /** The renewal plan, from P22b. */
  renewal: null;
};

/** A license on /licenses/[licenseId] and its two download routes: /l's shape plus its status at the request's time. */
export type BuyerLicenseDetail = BuyerLicense & { status: RecordStatus };

/** The buyer's licenses, newest request first (the id breaks a tie), at most 100. */
export async function listBuyerLicenses(
  user: Pick<SessionUser, "email">,
): Promise<BuyerLicenseRow[]> {
  const rows = await db
    .select({
      licenseId: license.id,
      videoId: license.videoId,
      code: license.code,
      videoTitle: sql<string>`${license.snapshot}->'video'->>'title'`,
      creatorHandle: sql<string>`${license.snapshot}->'creator'->>'handle'`,
      exclusive: license.exclusive,
      startsAt: license.startsAt,
      endsAt: license.endsAt,
      revokedAt: license.revokedAt,
    })
    .from(licenseRequest)
    .innerJoin(license, eq(license.licenseRequestId, licenseRequest.id))
    .where(ownedBy(user))
    .orderBy(desc(licenseRequest.createdAt), desc(licenseRequest.id))
    .limit(LIST_LIMIT)
    .catch((error: unknown) => rethrowRedacted(error, "buyers.list_failed"));
  const now = new Date();
  return rows.map(({ revokedAt, startsAt, endsAt, ...row }) => ({
    ...row,
    status: recordStatus({ revokedAt, endsAt }, now),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt?.toISOString() ?? null,
    renewal: null,
  }));
}

/**
 * The buyer's license `licenseId`, or null for an id that isn't a uuid (checked before the query), an unknown id,
 * another email's license or a request that isn't approved: the same answer for each, so an id tells a guesser nothing.
 */
export async function getBuyerLicense(
  user: Pick<SessionUser, "email">,
  licenseId: string,
): Promise<BuyerLicenseDetail | null> {
  if (!isUuid(licenseId)) return null;
  const found = await readBuyerLicense(
    eq(license.id, licenseId),
    eq(licenseRequest.buyerEmail, normalizeEmail(user.email)),
  ).catch((error: unknown) =>
    rethrowRedacted(error, "buyers.license_read_failed"),
  );
  if (!found) return null;
  return { ...found, status: recordStatus(found.license, new Date()) };
}
