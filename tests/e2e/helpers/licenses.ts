import { execFileSync } from "node:child_process";
import { expect, type Locator, type Page } from "@playwright/test";
import type {
  Currency,
  LicenseRequestStatus,
  MoneyMovementKind,
  MoneyMovementStatus,
} from "../../../src/lib/domain/values";
import { DAY_MS } from "../../../src/lib/time";
import { withTestDb } from "./test-db";

// Licenses a spec forces into a state no check let through (P19g; 07 D111), or one the app has no way to reach yet (P20:
// revoked is P21b's admin action, expired takes 30 days; owner answer Q-188), and a license's charge and money movements
// read, a take-back failed by hand (P21b's manual Verify, automated), or a request forced overdue (the dev clock): only
// the test database, never the app's.

/** Organic social repost · 30 days · Worldwide. */
export const ORGANIC_30_WORLDWIDE = {
  use: "organic_social",
  term: "d30",
  territory: "worldwide",
} as const;

/** A license date as the record prints it, UTC (07 D84): "15 Oct 2026, 14:32 UTC". */
export const LICENSE_DATE = String.raw`\d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC`;

/** A FactList row's label (04 §9.31): the <dt> that reads `label`. */
export const factLabel = (scope: Locator, label: string) =>
  scope.locator("dt").filter({ hasText: new RegExp(`^${label}$`) });

/** A FactList row's value (04 §9.31): the <dd> after the <dt> that reads `label`. */
export const fact = (scope: Locator, label: string) =>
  factLabel(scope, label).locator("xpath=following-sibling::dd[1]");

/** /dashboard/licenses' rows in the form the tier shows (DataTable renders both, 04 §9.31). */
export const licenseRows = (page: Page) =>
  page
    .locator("main")
    .locator("[data-table-stacked] > li, [data-table-wide] tbody > tr")
    .filter({ visible: true });

/** What forceLicenseRevoked stores as the admin's note: a public page must never show it (03: revoked_note). */
export const REVOKED_NOTE = "Admin note: e2e dispute ch_e2e_lost_4410";

/**
 * Runs `sql`, one UPDATE of the one `row` that `key` names (its $1: a request id, unless the caller says otherwise), or
 * throws naming `helper` when it updated no row or more than one.
 */
async function updateOne(
  helper: string,
  row: string,
  key: string,
  sql: string,
  values: unknown[] = [],
): Promise<void> {
  const { rowCount } = await withTestDb((client) =>
    client.query(sql, [key, ...values]),
  );
  if (rowCount !== 1) throw new Error(`${helper}: no ${row} for ${key}`);
}

/** Updates request `requestId`'s one license with `sql` (its $1 is the request id), or throws naming `helper`. */
const updateLicense = (
  helper: string,
  requestId: string,
  sql: string,
  values: unknown[] = [],
) => updateOne(helper, "license", requestId, sql, values);

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

/** What request `requestId` charged, as its license stores it, and when the license was revoked (null while it isn't). */
export type StoredLicense = {
  totalCents: number;
  priceCents: number;
  currency: Currency;
  revokedAt: Date | null;
};

/**
 * Request `requestId`'s amounts (amount_total_cents, license_price_cents, currency: what the Revoke sheet and the Money
 * cell print) and its license's revoked_at (the date /l prints), or a throw.
 */
export async function storedLicense(requestId: string): Promise<StoredLicense> {
  const { rows } = await withTestDb((client) =>
    client.query<StoredLicense>(
      `select r.amount_total_cents as "totalCents", r.license_price_cents as "priceCents", r.currency,
          l.revoked_at as "revokedAt"
        from license_request r join license l on l.license_request_id = r.id where r.id = $1`,
      [requestId],
    ),
  );
  const [row] = rows;
  if (!row) throw new Error(`storedLicense: no license for ${requestId}`);
  return row;
}

/** A money movement as a spec reads it back: never its Stripe id. */
export type StoredMovement = {
  status: MoneyMovementStatus;
  attempt: number;
  lastError: string | null;
  /** Minor units. */
  amountCents: number;
};

/** Request `requestId`'s money movement of `kind` (one at most per kind), or a throw. */
export async function storedMovement(
  requestId: string,
  kind: MoneyMovementKind,
): Promise<StoredMovement> {
  const { rows } = await withTestDb((client) =>
    client.query<StoredMovement>(
      `select status, attempt, last_error as "lastError", amount_cents as "amountCents" from money_movement
        where license_request_id = $1 and kind = $2`,
      [requestId, kind],
    ),
  );
  const [row] = rows;
  if (!row) throw new Error(`storedMovement: no ${kind} for ${requestId}`);
  return row;
}

/**
 * Waits up to 60 s for request `requestId`'s movement of `kind` to be stored succeeded (each money step runs after its
 * action's response, 07 D75), then returns it.
 */
export async function expectMovementSucceeded(
  requestId: string,
  kind: MoneyMovementKind,
): Promise<StoredMovement> {
  await expect
    .poll(async () => (await storedMovement(requestId, kind)).status, {
      timeout: 60_000,
    })
    .toBe("succeeded");
  return storedMovement(requestId, kind);
}

/**
 * The dev clock without its cron call (README "Force a request overdue"): request `requestId`'s deadline moves to 1 ms
 * after its authorization and nothing expires it yet. Checks the script's one JSON line and that the deadline is past;
 * returns that deadline (ISO 8601).
 */
export function forceRequestOverdue(requestId: string): { expiresAt: string } {
  const printed = execFileSync(
    "bunx",
    ["tsx", "scripts/dev-expire-request.ts", requestId, "--no-cron"],
    { env: { ...process.env, NODE_ENV: "test" }, encoding: "utf8" },
  );
  expect(printed.trim().split("\n")).toHaveLength(1);
  const forced = JSON.parse(printed) as { expiresAt: string };
  expect(forced).toEqual({
    requestId,
    expiresAt: expect.any(String),
    cron: null,
  });
  expect(Date.parse(forced.expiresAt)).toBeLessThan(Date.now());
  return forced;
}

/** Request `requestId`'s stored status (P22's expiry: what the cron left, before any page reads it), or a throw. */
export async function storedRequestStatus(
  requestId: string,
): Promise<LicenseRequestStatus> {
  const { rows } = await withTestDb((client) =>
    client.query<{ status: LicenseRequestStatus }>(
      "select status from license_request where id = $1",
      [requestId],
    ),
  );
  const [row] = rows;
  if (!row) throw new Error(`storedRequestStatus: no request ${requestId}`);
  return row.status;
}

/** The Stripe code forceTakeBackFailed stores, as P21b's manual Verify step does. */
export const MANUAL_TEST_ERROR = "manual_test";

/**
 * Fails request `requestId`'s take-back after it succeeded, as P21b's manual Verify step does on the dev database
 * (`last_error` MANUAL_TEST_ERROR, no `succeeded_at`), touched now: Events lists failed movements newest first. Its
 * attempt stays, so a Retry runs the next one. Throws unless there was one succeeded transfer_reversal to fail.
 */
export async function forceTakeBackFailed(requestId: string): Promise<void> {
  await updateOne(
    "forceTakeBackFailed",
    "succeeded take-back",
    requestId,
    `update money_movement set status = 'failed', last_error = $2, succeeded_at = null, updated_at = now()
      where license_request_id = $1 and kind = 'transfer_reversal' and status = 'succeeded'`,
    [MANUAL_TEST_ERROR],
  );
}
