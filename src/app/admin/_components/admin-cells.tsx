import type { ReactNode } from "react";
import { DataTable, type DataTableProps } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { ADMIN_COPY } from "@/lib/admin/copy";
import type { AdminStatusCell } from "@/lib/admin/labels";
import { formatLicenseDate } from "@/lib/format";
import { INBOX_COPY } from "@/lib/licensing/inbox";
import { cn } from "@/lib/utils";
import { focusAnchor } from "./focus-anchor";

// The admin tables' shared cells and frame (05 §7; design/P21-admin-view.md §4.8, §4.10, §6): server-rendered, so each
// cell renders once in the stacked rows and once in the table and carries no id.

/** A table's or an empty line's card on canvas-alt (design §6): a hairline box; the table's last row drops its line. */
const ADMIN_CARD =
  "overflow-hidden rounded-md border border-hairline bg-surface [&_tbody>tr:last-child]:border-b-0";

/** The table's "—" for a cell with nothing to show; a stacked row leaves the label out instead. */
export const NONE = <span className="text-ink-2">{ADMIN_COPY.none}</span>;

/** A time in UTC, "19 Nov 2026, 14:32 UTC" (01 G.7; design §4.10), in ink-2 unless its row is flagged. */
export function AdminDate({ iso }: { iso: string }) {
  return (
    <span className="tabular-nums text-ink-2 group-data-[tone=danger]/row:text-danger-text">
      {formatLicenseDate(new Date(iso))}
    </span>
  );
}

/** A stored value printed as it is (a status 04 has no pill for, a reason code, an audit action): footnote. */
export function RawValue({
  muted = false,
  children,
}: {
  muted?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cn("text-footnote", muted && "text-ink-2")}>
      {children}
    </span>
  );
}

/** A status cell: its 04 §9.9 pill, or the raw value in ink-2 where 04 has none (design §4.8). */
export function StatusCell({ cell }: { cell: AdminStatusCell }) {
  return cell.kind === "pill" ? (
    <StatusPill tone={cell.tone} dot={cell.dot}>
      {cell.label}
    </StatusPill>
  ) : (
    <RawValue muted>{cell.text}</RawValue>
  );
}

/**
 * A Stripe or row id: whole in a stacked row; cut with an ellipsis in the table (design §6.5, §6.7), the whole id still
 * in the page for copying and in its tooltip.
 */
export function IdValue({ id }: { id: string }) {
  return (
    <span
      title={id}
      className="text-footnote lg:inline-block lg:max-w-28 lg:truncate lg:align-bottom"
    >
      {id}
    </span>
  );
}

/**
 * A license code on one line with its code tracking, "CL-7K3M-9QXA". `anchor`: the row's own code (the Licenses tab),
 * in semibold and the row's focus anchor, where the focus lands when the row's action leaves it.
 */
export function LicenseCode({
  code,
  anchor = false,
}: {
  code: string;
  anchor?: boolean;
}) {
  return (
    <span
      {...(anchor ? focusAnchor("row") : {})}
      className={cn(
        "whitespace-nowrap tracking-code tabular-nums",
        anchor && "font-semibold outline-none",
      )}
    >
      {code}
    </span>
  );
}

/** A row as its type and id, "license_request 9a2b44…" (design §6.7). */
export function EntityValue({ type, id }: { type: string; id: string }) {
  return (
    <span className="text-footnote">
      {type} <IdValue id={id} />
    </span>
  );
}

/** An exclusive request's or license's neutral tag (04 §9.9). */
export const EXCLUSIVE_TAG = <StatusPill>{INBOX_COPY.exclusiveTag}</StatusPill>;

/** "Nothing here yet." in the card, in place of a tab's table (`list`: an Events list's, smaller; design §6.10). */
function AdminEmpty({ list = false }: { list?: boolean }) {
  return (
    <div
      className={cn(
        ADMIN_CARD,
        list ? "px-3 py-4" : "flex justify-center px-6 py-12",
      )}
    >
      <p className={cn("text-ink-2", list ? "text-callout" : "text-body")}>
        {ADMIN_COPY.empty}
      </p>
    </div>
  );
}

export type AdminTableProps<Row extends { id: string }> = Omit<
  DataTableProps<Row>,
  "className" | "rowKey"
> & {
  /** One of the Events lists: its empty line is the smaller one. */
  list?: boolean;
};

/**
 * One admin table in its card (04 §9.31; design §6), its rows keyed by their id: stacked rows below lg, the table from
 * lg; with no rows, the empty line instead. Its cells wrap so it fits the 1200 px column at 1280, keeping the row's
 * action in view; `nowrap` (the Requests tab, drawn wider than its box) keeps each cell on one line and scrolls inside
 * the card instead.
 */
export function AdminTable<Row extends { id: string }>({
  list = false,
  ...table
}: AdminTableProps<Row>) {
  if (table.rows.length === 0) return <AdminEmpty list={list} />;
  return (
    <DataTable {...table} rowKey={(row) => row.id} className={ADMIN_CARD} />
  );
}
