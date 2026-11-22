import type { DataColumn } from "@/components/ui/data-table";
import { ADMIN_COLUMNS } from "@/lib/admin/copy";
import { adminRequestStatus, autoApproveLabel } from "@/lib/admin/labels";
import { formatMoney } from "@/lib/format";
import type { AdminRequestRow } from "@/server/admin/queries";
import {
  AdminDate,
  EXCLUSIVE_TAG,
  IdValue,
  NONE,
  RawValue,
  StatusCell,
} from "./admin-cells";
import { DeadlineCell } from "./deadline-cell";

const COLUMN = ADMIN_COLUMNS.requests;

/** An amount in the request's own currency (07 D95, D98). */
const money = (cents: number, r: AdminRequestRow) => (
  <span className="tabular-nums">{formatMoney(cents, r.currency)}</span>
);

/** A Stripe id, or nothing before Stripe gave one. */
const stripeId = (id: string | null) => (id ? <IdValue id={id} /> : null);

/**
 * The Requests tab (`?tab=requests`; 03 §7.9, 05 §7, design §6.5): the buyer's email (admins only, 07 D47), «Exclusive»
 * for an exclusive request and nothing for a standard one (04 §9.31), the amounts in the request's currency, the Stripe
 * ids, Processing… for a claimed waiting request, the stored reason raw, auto-approve's "on · fell back" (07 D81), and
 * the deadline while the request waits, in the viewer's own zone. Wide: it scrolls inside its card.
 */
export const REQUEST_COLUMNS: readonly DataColumn<AdminRequestRow>[] = [
  {
    header: COLUMN.licensee,
    cell: (r) => <span className="font-semibold">{r.licenseeName}</span>,
  },
  { header: COLUMN.buyerEmail, cell: (r) => r.buyerEmail },
  { header: COLUMN.video, cell: (r) => r.videoTitle },
  { header: COLUMN.scope, cell: (r) => r.scope },
  { header: COLUMN.type, cell: (r) => (r.exclusive ? EXCLUSIVE_TAG : null) },
  {
    header: COLUMN.license,
    numeric: true,
    cell: (r) => money(r.licensePriceCents, r),
  },
  {
    header: COLUMN.fee,
    numeric: true,
    cell: (r) => money(r.platformFeeCents, r),
  },
  {
    header: COLUMN.total,
    numeric: true,
    cell: (r) => money(r.amountTotalCents, r),
  },
  {
    header: COLUMN.checkout,
    empty: NONE,
    cell: (r) => stripeId(r.stripeCheckoutSessionId),
  },
  {
    header: COLUMN.paymentIntent,
    empty: NONE,
    cell: (r) => stripeId(r.stripePaymentIntentId),
  },
  {
    header: COLUMN.charge,
    empty: NONE,
    cell: (r) => stripeId(r.stripeChargeId),
  },
  {
    header: COLUMN.status,
    cell: (r) => <StatusCell cell={adminRequestStatus(r)} />,
  },
  {
    header: COLUMN.reason,
    empty: NONE,
    cell: (r) =>
      r.statusReason ? <RawValue muted>{r.statusReason}</RawValue> : null,
  },
  {
    header: COLUMN.autoApprove,
    empty: NONE,
    cell: (r) => autoApproveLabel(r),
  },
  {
    header: COLUMN.deadline,
    empty: NONE,
    cell: (r) =>
      r.status === "awaiting_approval" && r.expiresAt ? (
        <DeadlineCell iso={r.expiresAt} />
      ) : null,
  },
  { header: COLUMN.created, cell: (r) => <AdminDate iso={r.createdAt} /> },
];
