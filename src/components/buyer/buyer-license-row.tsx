import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { PosterThumb } from "@/components/license/poster-thumb";
import { StatusPill } from "@/components/ui/status-pill";
import { formatPostDate } from "@/lib/format";
import { INBOX_COPY } from "@/lib/licensing/inbox";
import {
  LICENSE_RECORD_COPY,
  licenseStatusPill,
} from "@/lib/licensing/license-record";
import { myLicensePath } from "@/lib/urls";
import type { BuyerLicenseRow as BuyerLicenseRowData } from "@/server/buyers/queries";

const COPY = LICENSE_RECORD_COPY.myLicenses;

/**
 * Line 3 (04 §9.37, §11.11), each day formatPostDate's UTC day (AD-64): "15 Oct 2026 – 15 Oct 2027 (UTC)", Perpetual
 * "From 15 Oct 2026 · No end date".
 */
function datesText({
  startsAt,
  endsAt,
}: Pick<BuyerLicenseRowData, "startsAt" | "endsAt">): string {
  const start = formatPostDate(new Date(startsAt));
  return endsAt
    ? COPY.dates(start, formatPostDate(new Date(endsAt)))
    : COPY.perpetual(start);
}

/**
 * 04 §9.37 BuyerLicenseRow, one `<li>` of /licenses' list (05 §4.9; 07 D126; owner answer Q-192: no amount). The whole
 * row is one link to the license's page, never prefetched (a list holds up to 100, and each prefetch would run the
 * buyer layout's reads): min-h 88, padding 16, `fill` on hover, the focus ring inside the row. The 48 × 64 poster from
 * the bare poster route (its `fill` block when the poster is gone or private, as /l's LicenseCard); line 1 the title (2
 * lines at most) with the status pill on the right; line 2 "@{handle} · {code}" and «Exclusive» or "Standard"; line 3
 * the UTC days. Its name is "{title}, {code}, {status}" (04 §9.37), lines 2–3 its description. The divider above every
 * row after the first is inset 16 px.
 */
export function BuyerLicenseRow({ license }: { license: BuyerLicenseRowData }) {
  const pill = licenseStatusPill(license.status);
  const metaId = `license-meta-${license.licenseId}`;
  return (
    <li className="mx-4 border-hairline [&+&]:border-t">
      <Link
        href={myLicensePath(license.licenseId)}
        prefetch={false}
        aria-label={`${license.videoTitle}, ${license.code}, ${pill.label}`}
        aria-describedby={metaId}
        data-focus="inset"
        className="-mx-4 flex min-h-22 items-center gap-3 rounded-lg p-4 hover:bg-fill"
      >
        <PosterThumb src={`/api/media/posters/${license.videoId}`} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <p className="line-clamp-2 min-w-0 text-body font-semibold text-ink wrap-anywhere">
              {license.videoTitle}
            </p>
            <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
          </div>
          <div
            id={metaId}
            className="flex flex-col gap-1 text-footnote text-ink-2 tabular-nums"
          >
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 wrap-anywhere">
                {`@${license.creatorHandle} · `}
                <span className="tracking-code whitespace-nowrap">
                  {license.code}
                </span>
              </span>
              {license.exclusive ? (
                <StatusPill>{INBOX_COPY.exclusiveTag}</StatusPill>
              ) : (
                <span>{COPY.standard}</span>
              )}
            </p>
            <p>{datesText(license)}</p>
          </div>
        </div>
        <ChevronRight
          aria-hidden
          size={20}
          strokeWidth={2}
          className="shrink-0 text-ink-2"
        />
      </Link>
    </li>
  );
}
