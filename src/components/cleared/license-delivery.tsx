import { Music, Users } from "lucide-react";
import Link from "next/link";
import { READING_COLUMN } from "@/components/layout/gutter";
import { LicenseSummary } from "@/components/license/license-summary";
import { PostingList } from "@/components/license/posting-list";
import { Button } from "@/components/ui/button";
import { CopyLinkField } from "@/components/ui/copy-link-field";
import { Disclosure } from "@/components/ui/disclosure";
import { FocusedHeading } from "@/components/ui/focused-heading";
import { Notice } from "@/components/ui/notice";
import { ShareButton } from "@/components/ui/share-button";
import { formatLicenseDate, formatMoney, formatPostDate } from "@/lib/format";
import { LICENSE_PAGE_COPY } from "@/lib/licensing/license-page";
import {
  LICENSE_RECORD_COPY,
  licenseSummaryInput,
  type RecordStatus,
  snapshotPostings,
} from "@/lib/licensing/license-record";
import type { LicenseSnapshotV1 } from "@/lib/licensing/snapshot";
import { licenseSummary } from "@/lib/licensing/summary";
import { ClearedSeal } from "./cleared-seal";
import { CopyText } from "./copy-text";
import { LicenseCard } from "./license-card";
import { LicenseFiles } from "./license-files";

const COPY = LICENSE_RECORD_COPY.buyer;

const HEADING = "text-display text-ink";

/**
 * The links /l builds from the buyer's key, the code and the license id; never logged. `manage` is the license in My
 * licenses through the sign-in (owner answer Q-193): `/sign-in?next=%2Flicenses%2F{id}`.
 */
export type DeliveryLinks = {
  original: string;
  pdf: string;
  verify: string;
  manage: string;
};

/**
 * S04, the buyer's file and license (01 J9; 04 §10.2, §11.4; 05 §4.4; 07 D16, D98, D113): one centered column at every
 * tier, from the snapshot, the license columns and the request's facts that never change (owner answer Q-183), never
 * live data. The static seal (72, 88 from lg), the two-tone headline, which takes the focus only on a license issued in
 * the last 24 h (05 §4.4 Fresh) and not back from a failed download (Q-185), and the approval line; the LicenseCard; the
 * downloads, or for a revoked license why there are none (P21b adds the refund line), then the tertiary **Manage in
 * My licenses** in every state (owner answer Q-193; P22g puts a chain's in its renewal block); the credit line, "Where
 * it was posted", the music and people notices and the summary under "What you can do" (its currency line left out:
 * the card says "Amounts in …", 07 D98); the public record's link; the receipt.
 */
export function LicenseDelivery({
  snapshot,
  status,
  revokedAt,
  original,
  territoryCode,
  amountTotalCents,
  maskedEmail,
  links,
  fresh,
  downloadFailed,
}: {
  snapshot: LicenseSnapshotV1;
  status: RecordStatus;
  /** license.revoked_at. */
  revokedAt: Date | null;
  /** The original's type as its button names it ("MP4") and its size. */
  original: { type: string; bytes: number };
  /** license_request.territory_code: the summary's "in the United States" (Q-115 a). */
  territoryCode: string | null;
  /** license_request.amount_total_cents, in the snapshot's currency. */
  amountTotalCents: number;
  /** The buyer's email as maskEmail shows it. */
  maskedEmail: string;
  links: DeliveryLinks;
  fresh: boolean;
  /** Back from a download route that failed (owner answer Q-185). */
  downloadFailed: boolean;
}) {
  const headline = (
    <>
      {`${COPY.headline.lead} `}
      <span className="text-ink-2">{COPY.headline.rest}</span>
    </>
  );
  const total = formatMoney(amountTotalCents, snapshot.amounts.currency);
  const startsAt = new Date(snapshot.startsAt);
  // Back from a failed download, the line under the downloads takes the focus (Q-185); a revoked license has none.
  const failedLine = downloadFailed && status !== "revoked";
  return (
    <div className={READING_COLUMN}>
      <div className="flex flex-col items-center gap-4 text-center">
        <ClearedSeal size={72} className="lg:size-22" />
        {fresh && !failedLine ? (
          <FocusedHeading className={HEADING}>{headline}</FocusedHeading>
        ) : (
          <h1 tabIndex={-1} className={HEADING}>
            {headline}
          </h1>
        )}
        <p className="text-callout text-ink-2">
          {COPY.approvedLine(
            snapshot.creator.handle,
            formatLicenseDate(startsAt),
          )}
        </p>
      </div>
      <LicenseCard
        snapshot={snapshot}
        status={status}
        amountTotalCents={amountTotalCents}
      />
      <div className="flex flex-col gap-3">
        <LicenseFiles
          status={status}
          revokedAt={revokedAt}
          original={{ href: links.original, ...original }}
          pdfHref={links.pdf}
          failed={downloadFailed}
        />
        {/* Never prefetched: /l asks nothing of the sign-in until the tap, and the page reads no session (Q-193). */}
        <Button asChild variant="tertiary" className="w-full">
          <Link href={links.manage} prefetch={false}>
            {LICENSE_RECORD_COPY.myLicenses.manage}
          </Link>
        </Button>
      </div>
      <Notice title={COPY.credit}>
        <CopyText
          text={snapshot.creditLine}
          name={COPY.copyNames.credit}
          on="fill"
        />
      </Notice>
      <PostingList postings={snapshotPostings(snapshot).postings} />
      {snapshot.exclusions.music ? (
        <Notice icon={Music} title={LICENSE_PAGE_COPY.music.title}>
          {LICENSE_PAGE_COPY.music.body}
        </Notice>
      ) : null}
      {snapshot.exclusions.people ? (
        <Notice icon={Users}>{LICENSE_PAGE_COPY.people}</Notice>
      ) : null}
      <Disclosure label={COPY.whatYouCanDo}>
        <LicenseSummary
          summary={licenseSummary(licenseSummaryInput(snapshot, territoryCode))}
        />
      </Disclosure>
      <div className="flex flex-col gap-2">
        <p className="text-callout text-ink">{COPY.verifyLead}</p>
        <CopyLinkField url={links.verify} label={COPY.verifyLink} />
        <ShareButton url={links.verify} />
      </div>
      <p className="text-footnote text-ink-2 tabular-nums">
        {COPY.receipt(total, formatPostDate(startsAt), maskedEmail)}
      </p>
    </div>
  );
}
