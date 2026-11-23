import type { DataColumn } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { ADMIN_COLUMNS, MONEY_COPY } from "@/lib/admin/copy";
import { licenseStatusPill } from "@/lib/licensing/license-record";
import { MY_LICENSES_COPY } from "@/lib/licensing/my-licenses-copy";
import {
  adminLicenseMoney,
  type MoneyPart,
} from "@/lib/licensing/revoke-display";
import { cn } from "@/lib/utils";
import type { AdminLicenseRow } from "@/server/admin/queries";
import { AdminDate, EXCLUSIVE_TAG, LicenseCode, NONE } from "./admin-cells";
import { LicenseRowAction } from "./license-row-action";
import { RetryMoneyMovementButton } from "./retry-money-movement-button";

const COLUMN = ADMIN_COLUMNS.licenses;

/**
 * The Money cell (05 §7 callouts 7–9; owner answer Q-209): adminLicenseMoney's parts, " · " between them (in the text,
 * hidden from screen readers; a wrapped part starts with its "·"), a part with a Retry (its movement failed) in danger
 * text and followed by that Retry, which wraps with its part. Each part is keyed by its movement's kind, so a refresh
 * that changes its words (a new failure code) keeps its Retry and the open sheet. The cell wraps like the table's
 * others; a Retry keeps its 44 px target.
 */
function Money({
  parts,
  l,
}: {
  parts: readonly MoneyPart[];
  l: AdminLicenseRow;
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
      {parts.map((part, i) => (
        <span
          key={part.kind}
          className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"
        >
          <span>
            {i > 0 ? (
              <span aria-hidden="true">{MONEY_COPY.separator}</span>
            ) : null}
            <span className={cn(part.retry && "text-danger-text")}>
              {part.text}
            </span>
          </span>
          {part.retry ? (
            <RetryMoneyMovementButton
              movement={{
                id: part.retry.movementId,
                kind: part.kind,
                amountCents: part.retry.amountCents,
                currency: l.currency,
                licenseCode: l.code,
                creatorHandle: l.creatorHandle,
              }}
            />
          ) : null}
        </span>
      ))}
    </span>
  );
}

/**
 * The Licenses tab (`?tab=licenses`; 03 §7.9, 05 §7, design §6.6): the code (the row's focus anchor, where the focus
 * lands when a Revoke or a Retry that worked leaves the row), the status the creator list computes, «Exclusive» or
 * "Standard" (05 §7 callout 11), the issue time, the downloads, the money (the transfer, or a revoke's refund and
 * take-back, with Retry), the revoke time, and Revoke while the license isn't revoked. P22b+ add the renewal columns.
 */
export const LICENSE_COLUMNS: readonly DataColumn<AdminLicenseRow>[] = [
  {
    header: COLUMN.code,
    cell: (l) => <LicenseCode code={l.code} anchor />,
  },
  { header: COLUMN.licensedTo, cell: (l) => l.licenseeName },
  { header: COLUMN.video, cell: (l) => l.videoTitle },
  {
    header: COLUMN.status,
    cell: (l) => {
      const pill = licenseStatusPill(l.status);
      return <StatusPill tone={pill.tone}>{pill.label}</StatusPill>;
    },
  },
  {
    header: COLUMN.type,
    cell: (l) => (l.exclusive ? EXCLUSIVE_TAG : MY_LICENSES_COPY.standard),
  },
  { header: COLUMN.issued, cell: (l) => <AdminDate iso={l.issuedAt} /> },
  { header: COLUMN.downloads, numeric: true, cell: (l) => l.downloads },
  {
    header: COLUMN.money,
    empty: NONE,
    cell: (l) => {
      const parts = adminLicenseMoney(l);
      return parts ? <Money parts={parts} l={l} /> : null;
    },
  },
  {
    header: COLUMN.revoked,
    empty: NONE,
    cell: (l) => (l.revokedAt ? <AdminDate iso={l.revokedAt} /> : null),
  },
  {
    header: COLUMN.action,
    action: true,
    align: "end",
    cell: (l) =>
      l.revokedAt ? null : (
        <LicenseRowAction
          license={{
            id: l.id,
            code: l.code,
            creatorHandle: l.creatorHandle,
            licensePriceCents: l.licensePriceCents,
            amountTotalCents: l.amountTotalCents,
            currency: l.currency,
            transferStatus: l.transfer?.status ?? null,
          }}
        />
      ),
  },
];
