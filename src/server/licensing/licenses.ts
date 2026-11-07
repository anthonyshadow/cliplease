import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  downloadEvent,
  license,
  licenseRequest,
  moneyMovement,
  video,
} from "@/db/schema";
import type { Currency } from "@/lib/domain/values";
import type { RecordStatus } from "@/lib/licensing/license-record";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import { scopeLabel } from "@/lib/licensing/selection";

// The creator's licenses, /dashboard/licenses (S22; 03 §7.8 as far as P20's schema goes, 07 D116): the renewal plan,
// open renewal and reservation joins come with P22b/P22g, the refund join ("Revoked · refunded") with P21b. Scoped to
// the caller's creator id, which comes from requireCreator, never from the URL; the licensee's name only, never the
// buyer's email or the contact (07 D47).

/** 03 §7.8: the newest 50 (license_creator_created_idx). */
const LIST_LIMIT = 50;

/**
 * publicStatus (src/lib/licensing/public-status.ts) in SQL, on the database's clock: revoked wins over expired, and a
 * license is expired from the instant it ends. No `upcoming` until P22b adds it to both (07 D117).
 */
const statusColumn = sql<RecordStatus>`case
  when ${license.revokedAt} <= now() then 'revoked'
  when ${license.endsAt} <= now() then 'expired'
  else 'valid' end`;

/** Every download of either kind (J9.5: one row per tap), counted on download_event_license_created_idx. */
const downloadsColumn = sql<number>`(select count(*)::int from ${downloadEvent} d where d.license_id = ${license}.id)`;

/** One row of the list: what the page prints, mapped field by field. */
export type CreatorLicense = {
  id: string;
  code: string;
  status: RecordStatus;
  exclusive: boolean;
  licenseeName: string;
  /** The video's title as it is now (03 §7.8): the record keeps its own. */
  title: string;
  /** "Paid social ads · 1 year · Worldwide", from the request's keys as the Inbox prints it. */
  scope: string;
  /** license.created_at (= issued_at), ISO 8601. */
  issuedAt: string;
  licensePriceCents: number;
  currency: Currency;
  /** The creator transfer, for P19b's payout line (never its Stripe id or error). */
  payout: Pick<
    CreatorRequest,
    "transferStatus" | "transferAmountCents" | "transferCurrency"
  >;
  downloads: number;
};

/** The creator's newest licenses first, each with its computed status, its payout line's transfer and its download count. */
export async function listCreatorLicenses(
  creatorId: string,
): Promise<CreatorLicense[]> {
  const rows = await db
    .select({
      id: license.id,
      code: license.code,
      status: statusColumn,
      exclusive: license.exclusive,
      createdAt: license.createdAt,
      licenseeName: licenseRequest.licenseeName,
      useKey: licenseRequest.useKey,
      termKey: licenseRequest.termKey,
      territoryKey: licenseRequest.territoryKey,
      territoryCode: licenseRequest.territoryCode,
      licensePriceCents: licenseRequest.licensePriceCents,
      currency: licenseRequest.currency,
      title: video.title,
      transferStatus: moneyMovement.status,
      transferAmountCents: moneyMovement.amountCents,
      transferCurrency: moneyMovement.currency,
      downloads: downloadsColumn,
    })
    .from(license)
    .innerJoin(licenseRequest, eq(licenseRequest.id, license.licenseRequestId))
    .innerJoin(video, eq(video.id, license.videoId))
    // money_movement_request_kind_uidx: at most one transfer, so each license stays one row.
    .leftJoin(
      moneyMovement,
      and(
        eq(moneyMovement.licenseRequestId, license.licenseRequestId),
        eq(moneyMovement.kind, "creator_transfer"),
      ),
    )
    .where(eq(license.creatorId, creatorId))
    .orderBy(desc(license.createdAt), desc(license.id))
    .limit(LIST_LIMIT);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    status: r.status,
    exclusive: r.exclusive,
    licenseeName: r.licenseeName,
    title: r.title,
    scope: scopeLabel(r),
    issuedAt: r.createdAt.toISOString(),
    licensePriceCents: r.licensePriceCents,
    currency: r.currency,
    payout: {
      transferStatus: r.transferStatus,
      transferAmountCents: r.transferAmountCents,
      transferCurrency: r.transferCurrency,
    },
    downloads: r.downloads,
  }));
}
