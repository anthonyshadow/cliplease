import type { DataColumn } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { ADMIN_COLUMNS } from "@/lib/admin/copy";
import { transferLabel } from "@/lib/admin/labels";
import { licenseStatusPill } from "@/lib/licensing/license-record";
import { MY_LICENSES_COPY } from "@/lib/licensing/my-licenses-copy";
import { cn } from "@/lib/utils";
import type { AdminLicenseRow } from "@/server/admin/queries";
import { AdminDate, EXCLUSIVE_TAG, NONE } from "./admin-cells";

const COLUMN = ADMIN_COLUMNS.licenses;

/**
 * The Licenses tab (`?tab=licenses`; 03 §7.9, design §6.6): the status the creator list computes, «Exclusive» or
 * "Standard" (05 §7 callout 11), the issue time, the downloads, the transfer and the revoke time. P21b adds refunds and
 * Revoke; P22b+ the renewal columns.
 */
export const LICENSE_COLUMNS: readonly DataColumn<AdminLicenseRow>[] = [
  {
    header: COLUMN.code,
    cell: (l) => (
      <span className="whitespace-nowrap font-semibold tracking-code tabular-nums">
        {l.code}
      </span>
    ),
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
    header: COLUMN.transfer,
    empty: NONE,
    // The creator transfer's line (05 §7 callout 7), a failed one in danger text.
    cell: (l) => {
      const label = transferLabel(l.transfer);
      return label ? (
        <span
          className={cn(
            "tabular-nums",
            l.transfer?.status === "failed" && "text-danger-text",
          )}
        >
          {label}
        </span>
      ) : null;
    },
  },
  {
    header: COLUMN.revoked,
    empty: NONE,
    cell: (l) => (l.revokedAt ? <AdminDate iso={l.revokedAt} /> : null),
  },
];
