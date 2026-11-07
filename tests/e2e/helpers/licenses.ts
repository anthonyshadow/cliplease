import type { Locator, Page } from "@playwright/test";
import { DAY_MS } from "../../../src/lib/time";
import { withTestDb } from "./test-db";

// Licenses a spec forces into a state no check let through (P19g; 07 D111), or one the app has no way to reach yet (P20:
// revoked is P21b's admin action, expired takes 30 days; owner answer Q-188): only the test database, never the app's.

/** Organic social repost · 30 days · Worldwide. */
export const ORGANIC_30_WORLDWIDE = {
  use: "organic_social",
  term: "d30",
  territory: "worldwide",
} as const;

/** A license date as the record prints it, UTC (07 D84): "15 Oct 2026, 14:32 UTC". */
export const LICENSE_DATE = String.raw`\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC`;

/** A FactList row's value (04 §9.31): the <dd> after the <dt> that reads `label`. */
export const fact = (scope: Locator, label: string) =>
  scope
    .locator("dt")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator("xpath=following-sibling::dd[1]");

/** /dashboard/licenses' rows in the form the tier shows (DataTable renders both, 04 §9.31). */
export const licenseRows = (page: Page) =>
  page
    .locator("main")
    .locator("[data-table-stacked] > li, [data-table-wide] tbody > tr")
    .filter({ visible: true });

/** What forceLicenseRevoked stores as the admin's note: a public page must never show it (03: revoked_note). */
export const REVOKED_NOTE = "Admin note: e2e dispute ch_e2e_lost_4410";

/** Updates request `requestId`'s one license with `sql` (its $1 is the request id), or throws naming `helper`. */
async function updateLicense(
  helper: string,
  requestId: string,
  sql: string,
  values: unknown[] = [],
): Promise<void> {
  const { rowCount } = await withTestDb((client) =>
    client.query(sql, [requestId, ...values]),
  );
  if (rowCount !== 1) throw new Error(`${helper}: no license for ${requestId}`);
}

/**
 * Makes request `requestId`'s issued license exclusive, as a running exclusive license the availability checks missed:
 * the state Approve's re-check under the video lock exists to catch. The column and the snapshot's flag, as issueLicense
 * writes both (07 D111), so the Inbox's re-check and /dashboard/licenses (the column) agree with /l, /verify and the PDF
 * (the snapshot, 07 D113).
 */
export async function forceLicenseExclusive(requestId: string): Promise<void> {
  await updateLicense(
    "forceLicenseExclusive",
    requestId,
    `update license set exclusive = true, snapshot = jsonb_set(snapshot, '{exclusive}', 'true')
      where license_request_id = $1`,
  );
}

/**
 * Revokes request `requestId`'s license a minute ago on the database's clock (/dashboard/licenses reads that clock),
 * as P21b's admin Revoke will: `payment_reversed` (no refund line, 07 D86) and REVOKED_NOTE.
 */
export async function forceLicenseRevoked(requestId: string): Promise<void> {
  await updateLicense(
    "forceLicenseRevoked",
    requestId,
    `update license set revoked_at = now() - interval '1 minute', revoked_reason = 'payment_reversed',
      revoked_note = $2 where license_request_id = $1`,
    [REVOKED_NOTE],
  );
}

/**
 * Ends request `requestId`'s license yesterday, as a 30-day term that started 31 days ago (license_dates: ends_at >
 * starts_at), its snapshot's dates with it so the record's words agree with its columns.
 */
export async function forceLicenseExpired(requestId: string): Promise<void> {
  const endsAt = new Date(Date.now() - DAY_MS);
  const startsAt = new Date(endsAt.getTime() - 30 * DAY_MS);
  await updateLicense(
    "forceLicenseExpired",
    requestId,
    `update license set starts_at = $2, ends_at = $3,
      snapshot = jsonb_set(jsonb_set(snapshot, '{startsAt}', to_jsonb($4::text)), '{endsAt}', to_jsonb($5::text))
      where license_request_id = $1`,
    [startsAt, endsAt, startsAt.toISOString(), endsAt.toISOString()],
  );
}

/** How many download_event rows request `requestId`'s license has, of either kind (01 J9.5: one per answered tap). */
export async function downloadCount(requestId: string): Promise<number> {
  const { rows } = await withTestDb((client) =>
    client.query<{ count: number }>(
      `select count(*)::int as count from download_event d
        join license l on l.id = d.license_id where l.license_request_id = $1`,
      [requestId],
    ),
  );
  return rows[0]?.count ?? 0;
}
