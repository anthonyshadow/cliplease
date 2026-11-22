import type { DataColumn } from "@/components/ui/data-table";
import { ADMIN_COLUMNS, ADMIN_COPY } from "@/lib/admin/copy";
import { auditActorLabel } from "@/lib/admin/labels";
import { CURRENCY_DISPLAY } from "@/lib/money/currency";
import type {
  AdminAuditRow,
  AdminEvents,
  AdminFailedEmailRow,
  AdminStripeEventRow,
} from "@/server/admin/queries";
import {
  AdminDate,
  AdminTable,
  type AdminTableProps,
  EntityValue,
  IdValue,
  NONE,
  RawValue,
} from "./admin-cells";

const AUDIT = ADMIN_COLUMNS.auditEvents;
const EMAIL = ADMIN_COLUMNS.failedEmails;
const STRIPE = ADMIN_COLUMNS.stripeEvents;

/** An audit row's redacted data as JSON: in the table it wraps inside a capped width instead of widening the table. */
function Details({ json }: { json: string }) {
  return (
    <span className="text-footnote lg:block lg:max-w-sm lg:whitespace-normal lg:wrap-anywhere">
      {json}
    </span>
  );
}

/**
 * The audit rows (design §4.9, §6.7): the action verbatim, the actor's type with the user's email or the system's
 * source, the target row, the redacted data. A flagged action reads in danger text with the warning icon and "Flagged"
 * for screen readers.
 */
const AUDIT_COLUMNS: readonly DataColumn<AdminAuditRow>[] = [
  {
    header: AUDIT.time,
    cell: (e) => <AdminDate iso={e.createdAt} />,
  },
  { header: AUDIT.action, cell: (e) => <RawValue>{e.action}</RawValue> },
  {
    header: AUDIT.actor,
    cell: (e) => <span className="wrap-anywhere">{auditActorLabel(e)}</span>,
  },
  {
    header: AUDIT.target,
    cell: (e) => <EntityValue type={e.entityType} id={e.entityId} />,
  },
  { header: AUDIT.details, cell: (e) => <Details json={e.details} /> },
];

/** Failed emails (design §6.7): never the recipient. */
const EMAIL_COLUMNS: readonly DataColumn<AdminFailedEmailRow>[] = [
  { header: EMAIL.time, cell: (m) => <AdminDate iso={m.createdAt} /> },
  { header: EMAIL.template, cell: (m) => <RawValue>{m.template}</RawValue> },
  {
    header: EMAIL.entity,
    cell: (m) => <EntityValue type={m.entityType} id={m.entityId} />,
  },
  { header: EMAIL.attempts, numeric: true, cell: (m) => m.attempts },
  {
    header: EMAIL.error,
    empty: NONE,
    cell: (m) => (m.error ? <RawValue>{m.error}</RawValue> : null),
  },
];

/** Unprocessed Stripe events (03 §7.9; 07 D96): with the platform account's currency. */
const STRIPE_COLUMNS: readonly DataColumn<AdminStripeEventRow>[] = [
  { header: STRIPE.received, cell: (s) => <AdminDate iso={s.receivedAt} /> },
  { header: STRIPE.id, cell: (s) => <IdValue id={s.id} /> },
  { header: STRIPE.type, cell: (s) => <RawValue>{s.type}</RawValue> },
  {
    header: STRIPE.currency,
    cell: (s) => CURRENCY_DISPLAY[s.platformCurrency].code,
  },
  {
    header: STRIPE.account,
    empty: NONE,
    cell: (s) => (s.account ? <IdValue id={s.account} /> : null),
  },
  { header: STRIPE.attempts, numeric: true, cell: (s) => s.attempts },
  {
    header: STRIPE.lastError,
    empty: NONE,
    cell: (s) => (s.lastError ? <RawValue>{s.lastError}</RawValue> : null),
  },
];

/** One Events list: its heading, then its table (named by the heading) or "Nothing here yet.". */
function EventsList<Row extends { id: string }>({
  heading,
  ...table
}: { heading: string } & Omit<AdminTableProps<Row>, "caption" | "list">) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="mt-2 text-body font-semibold text-ink">{heading}</h2>
      <AdminTable list caption={heading} {...table} />
    </section>
  );
}

/** The Events tab (`?tab=events`; design §4.9, §6.7): the latest audit rows, failed emails, unprocessed Stripe events. */
export function EventsLists({ events }: { events: AdminEvents }) {
  return (
    <>
      <EventsList
        heading={ADMIN_COPY.latestEventsHeading}
        columns={AUDIT_COLUMNS}
        rows={events.audit}
        rowFlag={(e) => (e.flagged ? ADMIN_COPY.flagged : null)}
      />
      <EventsList
        heading={ADMIN_COPY.failedEmailsHeading}
        columns={EMAIL_COLUMNS}
        rows={events.failedEmails}
      />
      <EventsList
        heading={ADMIN_COPY.stripeEventsHeading}
        columns={STRIPE_COLUMNS}
        rows={events.stripeEvents}
      />
    </>
  );
}
