import { Link } from "react-email";
import type { Currency } from "@/lib/domain/values";
import { formatMoney } from "@/lib/format";
import { currencyLabel } from "@/lib/money/currency";
import { EmailLayout } from "./components/email-layout";
import * as s from "./components/styles";
import { REQUEST_EMAIL_COPY as COPY } from "./request-copy";

export type LicenseApprovedProps = {
  handle: string;
  title: string;
  scope: string;
  code: string;
  amountTotalCents: number;
  currency: Currency;
  /** The buyer's /l link, with its key: never logged. */
  url: string;
  /** The license's public record, `{APP_URL}/verify/{code}`. */
  verifyUrl: string;
};

/**
 * license-approved, to the buyer once the license is issued (05 §8; 01 J9.3; 07 D98): the body, the amounts' currency
 * under it, the context with the license's code, Get file and license, and the public record after the hairline (the
 * period outside the link, so a copied URL normalizes). No dates, and never a posting's link (07 D70).
 */
export function LicenseApproved(p: LicenseApprovedProps) {
  return (
    <EmailLayout
      audience="buyer"
      headline={COPY.approvedSubject(p.code)}
      paragraphs={[
        COPY.approvedBody(
          p.handle,
          formatMoney(p.amountTotalCents, p.currency),
        ),
        COPY.amountsIn(currencyLabel(p.currency)),
      ]}
      context={[p.title, p.scope, COPY.licenseLine(p.code)]}
      button={{ label: COPY.getFileAndLicense, url: p.url }}
      footerLines={[
        <>
          {`${COPY.verifyLead} `}
          <Link href={p.verifyUrl} style={s.link}>
            {p.verifyUrl}
          </Link>
          .
        </>,
      ]}
    />
  );
}
