import type { DataColumn } from "@/components/ui/data-table";
import { ADMIN_COLUMNS } from "@/lib/admin/copy";
import { adminPayoutsStatus } from "@/lib/admin/labels";
import { currencyLabel } from "@/lib/money/currency";
import type { AdminCreatorRow } from "@/server/admin/queries";
import { AdminDate, StatusCell } from "./admin-cells";

const COLUMN = ADMIN_COLUMNS.creators;

/**
 * The Creators tab (`?tab=creators`; 03 §7.9, design §6.2): no age band, no payout country, never a date of birth
 * (07 D93, D94).
 */
export const CREATOR_COLUMNS: readonly DataColumn<AdminCreatorRow>[] = [
  {
    header: COLUMN.handle,
    cell: (c) => <span className="font-semibold">@{c.handle}</span>,
  },
  { header: COLUMN.name, cell: (c) => c.displayName },
  {
    header: COLUMN.email,
    cell: (c) => <span className="wrap-anywhere">{c.email}</span>,
  },
  {
    header: COLUMN.payoutCurrency,
    cell: (c) => currencyLabel(c.payoutCurrency),
  },
  {
    header: COLUMN.payouts,
    cell: (c) => <StatusCell cell={adminPayoutsStatus(c.payoutsStatus)} />,
  },
  { header: COLUMN.videos, numeric: true, cell: (c) => c.videoCount },
  { header: COLUMN.created, cell: (c) => <AdminDate iso={c.createdAt} /> },
];
