import Link from "next/link";
import { PayoutLineView } from "@/components/inbox/result-line";
import { Button } from "@/components/ui/button";
import { type DataColumn, DataTable } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { formatMoney, formatPostDate } from "@/lib/format";
import { INBOX_COPY } from "@/lib/licensing/inbox";
import {
  downloadsText,
  LICENSE_RECORD_COPY,
  licenseStatusPill,
} from "@/lib/licensing/license-record";
import { verifyPath } from "@/lib/urls";
import type { CreatorLicense } from "@/server/licensing/licenses";

const COPY = LICENSE_RECORD_COPY.dashboard;
const COLUMN = COPY.columns;

/** Its pill (Valid filled, Expired neutral, Revoked danger) and an exclusive license's neutral tag beside it (07 D127). */
function LicenseStatus({ license }: { license: CreatorLicense }) {
  const pill = licenseStatusPill(license.status);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
      {license.exclusive ? (
        <StatusPill>{INBOX_COPY.exclusiveTag}</StatusPill>
      ) : null}
    </div>
  );
}

/**
 * The prompt's columns (05 §6.10's P20 subset): Details, Type and Renewal come with P22f/P22g. What the creator got sits
 * with its payout line (P19b) under it; the downloads read "Downloaded {n} times", nothing at 0 (Q-186); the public
 * record is the row's only link.
 */
const COLUMNS: readonly DataColumn<CreatorLicense>[] = [
  {
    header: COLUMN.code,
    cell: (l) => (
      <span className="whitespace-nowrap tracking-code">{l.code}</span>
    ),
  },
  { header: COLUMN.licensedTo, cell: (l) => l.licenseeName },
  { header: COLUMN.video, cell: (l) => l.title },
  { header: COLUMN.scope, cell: (l) => l.scope },
  // A UTC day, as 05 §6.10 draws "Issued 15 Oct 2026" (AD-64).
  {
    header: COLUMN.issued,
    cell: (l) => (
      <span className="whitespace-nowrap tabular-nums">
        {formatPostDate(new Date(l.issuedAt))}
      </span>
    ),
  },
  {
    header: COLUMN.youGot,
    cell: (l) => (
      <div className="flex flex-col gap-1">
        <span className="tabular-nums">
          {formatMoney(l.licensePriceCents, l.currency)}
        </span>
        <PayoutLineView request={l.payout} />
      </div>
    ),
  },
  { header: COLUMN.status, cell: (l) => <LicenseStatus license={l} /> },
  { header: COLUMN.downloads, cell: (l) => downloadsText(l.downloads) },
  {
    header: COLUMN.publicRecord,
    action: true,
    cell: (l) => (
      <Button asChild variant="link" size="sm">
        <Link href={verifyPath(l.code)}>{COPY.viewPublicRecord}</Link>
      </Button>
    ),
  },
];

/** S22's list (05 §6.10; 04 §9.31): stacked rows below lg, the table from lg, on a surface card. */
export function LicensesTable({
  licenses,
}: {
  licenses: readonly CreatorLicense[];
}) {
  return (
    <DataTable
      caption={COPY.title}
      columns={COLUMNS}
      rows={licenses}
      rowKey={(l) => l.id}
      className="rounded-lg bg-surface lg:px-2 lg:py-1"
    />
  );
}
