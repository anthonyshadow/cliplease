import { formatLicenseDate } from "@/lib/format";
import {
  LICENSE_RECORD_COPY,
  type RecordStatus,
} from "@/lib/licensing/license-record";
import { LicenseDownloads } from "./license-downloads";

const COPY = LICENSE_RECORD_COPY.buyer;

/**
 * A license's files on /l and /licenses/[licenseId] (04 §10.2 item 6, §9.37; 05 §4.4, §4.10; 07 D16): LicenseDownloads
 * while valid or expired, through the page's own routes; for a revoked license why there are none, instead of both.
 * `failed`: a route sent the buyer back with `?download=failed` (owner answer Q-185).
 */
export function LicenseFiles({
  status,
  revokedAt,
  original,
  pdfHref,
  failed,
}: {
  status: RecordStatus;
  /** license.revoked_at. */
  revokedAt: Date | null;
  /** The original's route, its type as the label names it ("MP4") and its size. */
  original: { href: string; type: string; bytes: number };
  pdfHref: string;
  failed: boolean;
}) {
  return status === "revoked" ? (
    <RevokedMessage revokedAt={revokedAt} />
  ) : (
    <LicenseDownloads
      status={status}
      original={original}
      pdfHref={pdfHref}
      failed={failed}
    />
  );
}

/** 05 §4.4 callout 12 (owner answer Q-186): what replaces both downloads; the date in UTC (07 D84), never the reason. */
function RevokedMessage({ revokedAt }: { revokedAt: Date | null }) {
  if (!revokedAt)
    throw new Error("LicenseFiles: a revoked license has its revoked_at");
  return (
    <div className="flex flex-col gap-1">
      <p className="text-body text-ink">
        {COPY.revokedOn(formatLicenseDate(revokedAt))}
      </p>
      <p className="text-callout text-ink-2">{COPY.revoked}</p>
    </div>
  );
}
