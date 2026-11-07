import { useId } from "react";
import { PosterThumb } from "@/components/license/poster-thumb";
import { VerifiedOwnerBadge } from "@/components/license/verified-owner-badge";
import { FactList } from "@/components/ui/fact-list";
import { StatusPill } from "@/components/ui/status-pill";
import { formatMoney } from "@/lib/format";
import {
  amountsIn,
  LICENSE_RECORD_COPY,
  licenseStatusPill,
  type RecordStatus,
  rightsLabel,
  snapshotBadge,
  termText,
  territoryText,
} from "@/lib/licensing/license-record";
import type { LicenseSnapshotV1 } from "@/lib/licensing/snapshot";
import { CopyText } from "./copy-text";

const COPY = LICENSE_RECORD_COPY;

/**
 * 04 §10.2 item 5 LicenseCard (05 §4.4 callouts 4 and 13; 07 D71, D98, D113): the license as its snapshot records it,
 * never live video, posting or account data. A 48 × 64 poster from the bare poster route (no `?v=`: the record keeps no
 * poster key, the one exception to posterSrc; PosterThumb shows its `fill` block when the video's poster is gone), the
 * title and the sm ownership badge; then the facts, the code with its Copy, and "Paid {total}" with its currency line.
 * `status` is publicStatus's answer; `amountTotalCents` the request's, in the snapshot's currency.
 */
export function LicenseCard({
  snapshot,
  status,
  amountTotalCents,
}: {
  snapshot: LicenseSnapshotV1;
  status: RecordStatus;
  amountTotalCents: number;
}) {
  const titleId = useId();
  const facts = COPY.buyer.facts;
  const pill = licenseStatusPill(status);
  const { currency } = snapshot.amounts;
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-lg border border-hairline bg-surface p-5"
    >
      <div className="flex items-start gap-3">
        <PosterThumb src={`/api/media/posters/${snapshot.video.id}`} />
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            id={titleId}
            className="text-body font-semibold text-ink wrap-anywhere"
          >
            {snapshot.video.title}
          </h2>
          <VerifiedOwnerBadge {...snapshotBadge(snapshot, "sm")} />
        </div>
      </div>
      <hr className="border-hairline" />
      <FactList
        facts={[
          {
            label: facts.license,
            value: (
              <CopyText
                text={snapshot.code}
                name={COPY.buyer.copyNames.code}
                on="surface"
                textClassName="text-title-2 tracking-code tabular-nums"
              />
            ),
          },
          {
            label: facts.status,
            value: <StatusPill tone={pill.tone}>{pill.label}</StatusPill>,
          },
          { label: facts.use, value: snapshot.scope.useLabel },
          { label: facts.term, value: termText(snapshot) },
          { label: facts.territory, value: territoryText(snapshot.scope) },
          { label: COPY.rights.label, value: rightsLabel(snapshot) },
          { label: facts.licensedTo, value: snapshot.licensee.name },
          {
            label: facts.paid,
            value: formatMoney(amountTotalCents, currency),
          },
        ]}
        className="wrap-anywhere"
      />
      <p className="text-footnote text-ink-2">{amountsIn(currency)}</p>
    </section>
  );
}
