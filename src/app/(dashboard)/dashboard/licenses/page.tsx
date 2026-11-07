import type { Metadata } from "next";
import { WIDE_COLUMN } from "@/components/layout/gutter";
import { EmptyState } from "@/components/ui/empty-state";
import { LICENSE_RECORD_COPY } from "@/lib/licensing/license-record";
import { requireCreator } from "@/server/auth/session";
import { listCreatorLicenses } from "@/server/licensing/licenses";
import { LicensesTable } from "./licenses-table";

const COPY = LICENSE_RECORD_COPY.dashboard;

/** Q-186: "Licenses" (the root template adds " · ClipLease"). */
export const metadata: Metadata = { title: COPY.title };

/**
 * S22 `/dashboard/licenses` (05 §6.10; 01 J9.5, J9.8; 07 D145, D146): everything the creator has sold, newest first, in
 * the full max-w-app width on canvas-alt: the two-tone title, then the list (stacked rows below lg, the table from lg).
 * Each row: the code, the computed status with «Exclusive» beside it, the licensee, the video and scope, the issue day,
 * what the creator got with the payout line, the download count and View public record. With none, the empty state
 * stands for the page: "Licenses. None yet." (04 §11.9).
 */
export default async function LicensesPage() {
  const { creator } = await requireCreator("/dashboard/licenses");
  const licenses = await listCreatorLicenses(creator.id);
  if (licenses.length === 0) {
    return (
      <div className={WIDE_COLUMN}>
        <EmptyState
          as="h1"
          title={
            <>
              {COPY.empty.lead}{" "}
              <span className="text-ink-2">{COPY.empty.rest}</span>
            </>
          }
          description={COPY.emptyBody}
        />
      </div>
    );
  }
  return (
    <div className={WIDE_COLUMN}>
      <h1 className="text-title-1 text-ink">
        {COPY.heading.lead}{" "}
        <span className="text-ink-2">{COPY.heading.rest}</span>
      </h1>
      <LicensesTable licenses={licenses} />
    </div>
  );
}
