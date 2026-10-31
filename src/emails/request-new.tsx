import type { Currency } from "@/lib/domain/values";
import { formatEmailDateTime, formatMoney } from "@/lib/format";
import { EmailLayout } from "./components/email-layout";
import { REQUEST_EMAIL_COPY as COPY } from "./request-copy";

export type RequestNewProps = {
  licenseeName: string;
  title: string;
  scope: string;
  licensePriceCents: number;
  currency: Currency;
  expiresAt: Date;
  /** The creator's zone (creator_profile.time_zone, 07 D84). */
  timeZone: string;
  /** False adds "Set up payouts to approve before {deadline}." (07 D74). */
  payoutsActive: boolean;
  /** auto_approve_fallback_at set: the first line is the fallback's (07 D81). */
  fellBack: boolean;
  url: string;
};

/** request-new, to the creator when a request waits for them (05 §8). Never names the buyer's email (07 D47). */
export function RequestNew(p: RequestNewProps) {
  const deadline = formatEmailDateTime(p.expiresAt, p.timeZone);
  const body = COPY.newBody(
    p.scope,
    formatMoney(p.licensePriceCents, p.currency),
    deadline,
  );
  return (
    <EmailLayout
      audience="creator"
      headline={COPY.newSubject(p.licenseeName, p.title)}
      paragraphs={[
        p.fellBack ? COPY.autoApproveFellBack(deadline) : null,
        body,
        p.payoutsActive ? null : COPY.setUpPayouts(deadline),
      ].filter((paragraph) => paragraph !== null)}
      context={[p.title, p.scope]}
      button={{ label: COPY.reviewRequest, url: p.url }}
    />
  );
}
