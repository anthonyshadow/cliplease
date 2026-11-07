import { MessageBody } from "@/components/layout/public-shell";
import { LICENSE_RECORD_COPY } from "@/lib/licensing/license-record";
import { RecordFooter } from "./record-footer";
import { SupportText } from "./support-text";

const COPY = LICENSE_RECORD_COPY.verify;

/**
 * "No license found" (research/license.md §6.4 with CL- codes, 07 D101; 01 J10.3, J10.4; owner answer Q-184): no icon,
 * the code looked up when it is a canonical one, else the malformed line; never the raw input. Then the footer.
 */
export function NoLicenseFound({
  code,
  domain,
}: {
  code: string | null;
  domain: string;
}) {
  return (
    <MessageBody title={COPY.notFoundHeading}>
      <p className="text-body text-ink-2 wrap-anywhere">
        {`${code ? COPY.notFound(code) : COPY.malformed} `}
        <SupportText text={COPY.notFoundHelp} />
      </p>
      <RecordFooter domain={domain} />
    </MessageBody>
  );
}
