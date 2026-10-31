import { declinedView } from "@/lib/licensing/request-status";
import { EmailLayout } from "./components/email-layout";
import { REQUEST_EMAIL_COPY as COPY } from "./request-copy";

export type RequestDeclinedProps = {
  handle: string;
  title: string;
  scope: string;
  /** license_request.status_reason: why it was declined (declinedView). */
  statusReason: string | null;
  /** The buyer's /r link, with its key: never logged. */
  url: string;
};

/**
 * request-declined, to the buyer once Stripe has released the hold (05 §8; 01 J8.4, §4.8; 07 D25, D28): /r's "Not
 * approved" body for the reason, then the title and scope. It prints no date and no amount, so it reads no zone.
 */
export function RequestDeclined(p: RequestDeclinedProps) {
  return (
    <EmailLayout
      audience="buyer"
      headline={COPY.declinedSubject}
      paragraphs={[COPY.declinedBody[declinedView(p.statusReason)](p.handle)]}
      context={[p.title, p.scope]}
      button={{ label: COPY.seeRequestStatus, url: p.url }}
    />
  );
}
