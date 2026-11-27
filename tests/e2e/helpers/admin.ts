import { expect, type Locator, type Page } from "@playwright/test";
import { ADMIN_COPY } from "../../../src/lib/admin/copy";
import {
  type AdminStatusCell,
  adminRequestStatus,
} from "../../../src/lib/admin/labels";
import {
  ADMIN_TAB_LABELS,
  type AdminTab,
  adminTabHref,
} from "../../../src/lib/admin/tabs";
import type { LicenseRequestStatus } from "../../../src/lib/domain/values";
import { withTestDb } from "./test-db";

// The admin view as the specs read it (P21, P22: admin, demo, decline, expiry), in the setup admin's context. Every
// table holds the newest 50 rows by created_at, so under a full parallel run other specs' rows can push a spec's row out
// before its lookup: openAdminTab moves the spec's own rows to the top first, in the test database (P21's precedent: a
// row aged there, never a sleep). A spec finds its row by an id it knows.

/** The tables whose rows openAdminTab can move to the top (Events lists the newest audit rows: nothing to move). */
type MovableTab = Exclude<AdminTab, "events">;

/**
 * Each table's move to the top, `created_at` to now on the database's clock, of the rows `$1` names: creators and
 * their social accounts by handle (no "@"), videos and requests by id, licenses by their request's id. A license's issue
 * time and a request's creation time move too: no spec reads either after the move.
 */
const TO_NEWEST: Record<MovableTab, string> = {
  creators:
    "update creator_profile set created_at = now() where handle = any($1)",
  connections: `update social_account set created_at = now()
    where creator_id in (select id from creator_profile where handle = any($1))`,
  videos: "update video set created_at = now() where id = any($1::uuid[])",
  requests:
    "update license_request set created_at = now() where id = any($1::uuid[])",
  licenses:
    "update license set created_at = now() where license_request_id = any($1::uuid[])",
};

/** Moves the rows `keys` name (TO_NEWEST says by what) to the top of `tab`; throws unless each moved exactly one row. */
export async function moveToNewest(
  tab: MovableTab,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const { rowCount } = await withTestDb((client) =>
    client.query(TO_NEWEST[tab], [keys]),
  );
  if (rowCount !== keys.length) {
    throw new Error(
      `moveToNewest: ${tab} moved ${rowCount} rows for ${keys.length}`,
    );
  }
}

/** The tab row: a <nav> of six links. */
export const tabRow = (page: Page) =>
  page.getByRole("navigation", { name: ADMIN_COPY.tabsLabel, exact: true });

/**
 * Opens `tab`, its rows that `newest` names moved to its top first (moveToNewest), and waits for its segment to be the
 * current one.
 */
export async function openAdminTab(
  page: Page,
  tab: AdminTab,
  newest: readonly string[] = [],
) {
  if (tab === "events") {
    if (newest.length > 0)
      throw new Error("openAdminTab: Events moves nothing");
  } else {
    await moveToNewest(tab, newest);
  }
  await page.goto(adminTabHref(tab));
  await expect(tabRow(page).locator('[aria-current="page"]')).toHaveText(
    ADMIN_TAB_LABELS[tab],
  );
}

/**
 * A table's rows in the form the tier shows (DataTable renders both; the other is display: none), by the table's name:
 * a tab's label, or an Events list's heading.
 */
export function adminRows(page: Page, name: string): Locator {
  const main = page.locator("main");
  return main
    .getByRole("list", { name, exact: true })
    .locator(":scope > li")
    .or(main.getByRole("table", { name, exact: true }).locator("tbody > tr"));
}

/** The Requests row of request `requestId`, by its fake PaymentIntent id (07 D35: `pi_fake_<requestId>`). */
export const adminRequestRow = (page: Page, requestId: string): Locator =>
  adminRows(page, ADMIN_TAB_LABELS.requests).filter({
    hasText: `pi_fake_${requestId}`,
  });

/** A status cell's words: its pill's label, or the raw value. */
export const statusText = (cell: AdminStatusCell) =>
  cell.kind === "pill" ? cell.label : cell.text;

/** The Requests tab's status words for an unclaimed request in `status`: its pill's label ("Declined"), or the raw value. */
export const adminRequestStatusText = (status: LicenseRequestStatus) =>
  statusText(adminRequestStatus({ status, claimed: false }));
