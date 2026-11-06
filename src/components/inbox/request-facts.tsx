"use client";

import { type Fact, FactList } from "@/components/ui/fact-list";
import { useViewerDeadline } from "@/components/ui/use-viewer-deadline";
import { formatMoney } from "@/lib/format";
import { INBOX_COPY } from "@/lib/licensing/inbox";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import { formatMultiplier } from "@/lib/pricing/multiplier";

const FACT = INBOX_COPY.facts;

/**
 * A request's facts for its creator (04 §9.11; 05 §6.3 callout 8, §6.4): the buyer's entries, never their email (07
 * D47). What the hold means and the deadline only while the request waits, and what the creator gets only while it
 * waits or once approved: after a decision, or past the deadline before the expiry is stored (it reads Expired, owner
 * answer Q-142 a), they would no longer be true (owner answer Q-128 a). The deadline is in the viewer's zone, after
 * mount. An exclusive request names its premium after its scope (04 §11.5); a standard one has no such row.
 */
export function RequestFacts({ request }: { request: CreatorRequest }) {
  const deadline = useViewerDeadline(request.expiresAt);
  const waiting =
    request.status === "awaiting_approval" &&
    request.displayStatus !== "expired";
  const facts: Fact[] = [
    { label: FACT.licensedTo, value: request.licenseeName },
    { label: FACT.contact, value: request.contactName },
  ];
  if (request.intendedUse) {
    facts.push({ label: FACT.plannedUse, value: request.intendedUse });
  }
  facts.push({ label: FACT.scope, value: request.scope });
  if (request.exclusive) {
    facts.push({
      label: FACT.licenseType,
      value: INBOX_COPY.licenseTypeFact(
        formatMultiplier(request.exclusiveMultiplierBps),
      ),
    });
  }
  if (waiting || request.status === "approved") {
    facts.push({
      label: FACT.youGet,
      value: INBOX_COPY.youGetFact(
        formatMoney(request.licensePriceCents, request.currency),
        formatMoney(request.amountTotalCents, request.currency),
      ),
    });
  }
  if (waiting) {
    facts.push(
      { label: FACT.payment, value: INBOX_COPY.paymentFact },
      { label: FACT.answerBy, value: INBOX_COPY.answerByFact(deadline) },
    );
  }
  return <FactList facts={facts} className="wrap-anywhere" />;
}
