import { CircleAlert, Clock } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { ClearedSeal } from "@/components/cleared/cleared-seal";
import { READING_COLUMN } from "@/components/layout/gutter";
import { PostingList } from "@/components/license/posting-list";
import { VerifiedOwnerBadge } from "@/components/license/verified-owner-badge";
import { type Fact, FactList } from "@/components/ui/fact-list";
import { INLINE_LINK } from "@/components/ui/inline-link";
import { formatLicenseDate, formatPostDate } from "@/lib/format";
import { LICENSE_V1_DISPLAY_TITLE } from "@/lib/legal/license-v1-summary";
import {
  endDateText,
  exclusionRows,
  LICENSE_RECORD_COPY,
  type RecordStatus,
  rightsLabel,
  territoryText,
} from "@/lib/licensing/license-record";
import { BUYER_POSTINGS_COPY } from "@/lib/postings/buyer-rows";
import type { PublicPostingDTO } from "@/lib/postings/types";
import { creatorUrl } from "@/lib/urls";
import { cn } from "@/lib/utils";
import type { PublicLicenseView } from "@/server/licensing/verify";
import { RecordFooter } from "./record-footer";
import { SupportText } from "./support-text";

const COPY = LICENSE_RECORD_COPY;
const FACTS = COPY.verify.facts;

/**
 * S05, a license's public record (05 §4.5; 04 §10.2; 01 J10.1–J10.5; 07 D113): the status row, the code, the public
 * facts, "Where it was posted" as its own section after them (as 05 draws it), and the footer. One centered
 * max-w-reading column at every tier; the FactList's label column comes in at md. No amount anywhere (07 D94).
 */
export function PublicRecord({
  view,
  domain,
}: {
  view: PublicLicenseView;
  domain: string;
}) {
  return (
    <div className={READING_COLUMN}>
      <StatusRow status={view.status} sentence={view.sentence} />
      <div className="flex flex-col gap-4">
        <p className="whitespace-nowrap text-title-2 font-semibold tracking-code tabular-nums text-ink">
          {view.code}
        </p>
        <FactList facts={recordFacts(view)} className="wrap-anywhere" />
      </div>
      <RecordPostings postings={view.postings} />
      <RecordFooter domain={domain} />
    </div>
  );
}

/**
 * 04 §10.2: valid is the static 40 px seal on a `cleared-tint` row; expired a neutral Clock disc and revoked a
 * `danger-text` CircleAlert, on a plain hairline row (`cleared-tint` is valid's only). The words carry the meaning.
 */
function StatusRow({
  status,
  sentence,
}: {
  status: RecordStatus;
  sentence: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg p-4 wrap-anywhere lg:p-6",
        status === "valid" ? "bg-cleared-tint" : "border border-hairline",
      )}
    >
      <div className="flex items-center gap-3">
        <StatusMark status={status} />
        <h1 className="text-title-1 text-ink">{COPY.verify.heading[status]}</h1>
      </div>
      <p className="text-body text-ink">
        <SupportText text={sentence} />
      </p>
    </div>
  );
}

function StatusMark({ status }: { status: RecordStatus }) {
  if (status === "valid") return <ClearedSeal size={40} />;
  if (status === "revoked") {
    return (
      <CircleAlert
        aria-hidden
        size={40}
        className="shrink-0 text-danger-text"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-fill text-ink-2"
    >
      <Clock size={20} strokeWidth={2} />
    </span>
  );
}

/** 05 §4.5's rows, in its order; the exclusion rows only when flagged (owner answer Q-186). */
function recordFacts(view: PublicLicenseView): Fact[] {
  const shared = COPY.buyer.facts;
  return [
    { label: shared.licensedTo, value: view.licenseeName },
    { label: FACTS.licensedBy, value: <LicensedBy creator={view.creator} /> },
    {
      label: FACTS.ownership,
      value: <VerifiedOwnerBadge {...view.badge} />,
      alignTop: true,
    },
    { label: FACTS.video, value: view.video.title },
    { label: shared.use, value: view.scope.useLabel },
    { label: shared.term, value: view.scope.termLabel },
    { label: shared.territory, value: territoryText(view.scope) },
    { label: FACTS.starts, value: formatLicenseDate(new Date(view.startsAt)) },
    { label: FACTS.ends, value: endDateText(view.endsAt) },
    { label: COPY.rights.label, value: rightsLabel(view) },
    { label: FACTS.issued, value: formatPostDate(new Date(view.issuedAt)) },
    ...exclusionRows(view.exclusions),
    {
      label: FACTS.terms,
      value: (
        <Link
          href={`/legal/license/${view.termsVersion}`}
          className={cn(INLINE_LINK, "hit-44")}
        >
          {LICENSE_V1_DISPLAY_TITLE}
        </Link>
      ),
    },
  ];
}

/** "Maya R. (@maya)", the handle linking to /@maya (research/license.md §6.3), as the license page links it. */
function LicensedBy({ creator }: { creator: PublicLicenseView["creator"] }) {
  return (
    <>
      {`${creator.displayName} (`}
      <Link
        href={creatorUrl(creator.handle)}
        prefetch={false}
        className={cn(INLINE_LINK, "hit-44")}
      >
        {`@${creator.handle}`}
      </Link>
      {")"}
    </>
  );
}

/** The snapshot's postings (07 D71); a video with none reads "Uploaded file" under the same heading (05 §4.5 callout 5). */
function RecordPostings({ postings }: { postings: PublicPostingDTO[] }) {
  const titleId = useId();
  if (postings.length > 0) return <PostingList postings={postings} />;
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-2">
      <h2 id={titleId} className="text-callout font-semibold text-ink">
        {BUYER_POSTINGS_COPY.title}
      </h2>
      <p className="text-callout text-ink-2">{COPY.uploadedFile}</p>
    </section>
  );
}
