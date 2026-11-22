import type { DataColumn } from "@/components/ui/data-table";
import { ADMIN_COLUMNS } from "@/lib/admin/copy";
import { adminAccountStatus } from "@/lib/admin/labels";
import { PLATFORM_LABELS } from "@/lib/brand";
import type { AdminConnectionRow } from "@/server/admin/queries";
import { AdminDate, NONE, RawValue, StatusCell } from "./admin-cells";

const COLUMN = ADMIN_COLUMNS.connections;

/**
 * The Accounts tab (`?tab=connections`; 05 §7, design §6.3): the derived Sync problem (05 §1.5), a disconnected account
 * raw, the last error as its code. Never a token, an avatar link or the platform's account id. View counts come with
 * P28b.
 */
export const CONNECTION_COLUMNS: readonly DataColumn<AdminConnectionRow>[] = [
  { header: COLUMN.platform, cell: (c) => PLATFORM_LABELS[c.provider] },
  {
    header: COLUMN.username,
    empty: NONE,
    cell: (c) =>
      c.username ? <span className="font-semibold">@{c.username}</span> : null,
  },
  { header: COLUMN.owner, cell: (c) => `@${c.ownerHandle}` },
  {
    header: COLUMN.status,
    cell: (c) => <StatusCell cell={adminAccountStatus(c)} />,
  },
  {
    header: COLUMN.lastSync,
    empty: NONE,
    cell: (c) => (c.lastSyncedAt ? <AdminDate iso={c.lastSyncedAt} /> : null),
  },
  {
    header: COLUMN.lastError,
    empty: NONE,
    cell: (c) =>
      c.lastSyncError ? <RawValue muted>{c.lastSyncError}</RawValue> : null,
  },
  {
    header: COLUMN.connected,
    cell: (c) => <AdminDate iso={c.connectedAt} />,
  },
  {
    header: COLUMN.disconnected,
    empty: NONE,
    cell: (c) =>
      c.disconnectedAt ? <AdminDate iso={c.disconnectedAt} /> : null,
  },
];
