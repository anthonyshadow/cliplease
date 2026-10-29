import type { Currency } from "@/lib/domain/values";
import { formatEmailDateTime, formatMoney } from "@/lib/format";
import { EmailLayout } from "./components/email-layout";
import { REQUEST_EMAIL_COPY as COPY } from "./request-copy";

export type RequestReceivedProps = {
  handle: string;
  title: string;
  scope: string;
  amountTotalCents: number;
  currency: Currency;
  expiresAt: Date;
  /** The buyer's zone (license_request.buyer_time_zone, 07 D84). */
  timeZone: string;
  /** The buyer's /r link, with its key: never logged. */
  url: string;
};

/** request-received, to the buyer when the hold is placed (05 §8; 01 §4.8). */
export function RequestReceived(p: RequestReceivedProps) {
  const deadline = formatEmailDateTime(p.expiresAt, p.timeZone);
  return (
    <EmailLayout
      audience="buyer"
      headline={COPY.receivedSubject(p.handle)}
      paragraphs={[
        COPY.receivedBody(
          p.handle,
          formatMoney(p.amountTotalCents, p.currency),
          deadline,
        ),
      ]}
      context={[p.title, p.scope]}
      button={{ label: COPY.seeRequestStatus, url: p.url }}
    />
  );
}
