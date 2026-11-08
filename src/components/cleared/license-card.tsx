import { useId } from "react";
import { PosterThumb } from "@/components/license/poster-thumb";
import { VerifiedOwnerBadge } from "@/components/license/verified-owner-badge";
import {
  type RecordStatus,
  snapshotBadge,
} from "@/lib/licensing/license-record";
import type { LicenseSnapshotV1 } from "@/lib/licensing/snapshot";
import { LICENSE_FACTS_CARD, LicenseFacts } from "./license-facts";

/**
 * 04 §10.2 item 5 LicenseCard (05 §4.4 callouts 4 and 13; 07 D71, D98, D113): the license as its snapshot records it,
 * never live video, posting or account data. A 48 × 64 poster from the bare poster route (no `?v=`: the record keeps no
 * poster key, the one exception to posterSrc; PosterThumb shows its `fill` block when the video's poster is gone), the
 * title and the sm ownership badge; then LicenseFacts: the facts, the code with its Copy, and "Paid {total}" with its
 * currency line. `status` is publicStatus's answer; `amountTotalCents` the request's, in the snapshot's currency.
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
  return (
    <section aria-labelledby={titleId} className={LICENSE_FACTS_CARD}>
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
      <LicenseFacts
        snapshot={snapshot}
        status={status}
        amountTotalCents={amountTotalCents}
      />
    </section>
  );
}
