import { FactList } from "@/components/ui/fact-list";
import { StatusPill } from "@/components/ui/status-pill";
import { formatMoney } from "@/lib/format";
import {
  amountsIn,
  LICENSE_RECORD_COPY,
  licenseStatusPill,
  type RecordStatus,
  rightsLabel,
  termText,
  territoryText,
} from "@/lib/licensing/license-record";
import type { LicenseSnapshotV1 } from "@/lib/licensing/snapshot";
import { CopyText } from "./copy-text";

const COPY = LICENSE_RECORD_COPY;

/** The card a license's facts sit in, on /l's LicenseCard and /licenses/[licenseId] (04 §10.2 item 5; 04 §9.37). */
export const LICENSE_FACTS_CARD =
  "flex flex-col gap-4 rounded-lg border border-hairline bg-surface p-5";

/**
 * A license's facts as its snapshot records them (04 §10.2 item 5; 05 §4.4 callout 4, §4.10 callout 3; 07 D98, D113):
 * License with the code's Copy · Status · Use · Term · Territory · Rights · Licensed to · Paid {total}, then
 * "Amounts in …". `status` is publicStatus's answer; `amountTotalCents` the request's, in the snapshot's currency.
 */
export function LicenseFacts({
  snapshot,
  status,
  amountTotalCents,
}: {
  snapshot: LicenseSnapshotV1;
  status: RecordStatus;
  amountTotalCents: number;
}) {
  const facts = COPY.buyer.facts;
  const pill = licenseStatusPill(status);
  const { currency } = snapshot.amounts;
  return (
    <>
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
            value: (
              <span className="tabular-nums">
                {formatMoney(amountTotalCents, currency)}
              </span>
            ),
          },
        ]}
        className="wrap-anywhere"
      />
      <p className="text-footnote text-ink-2">{amountsIn(currency)}</p>
    </>
  );
}
