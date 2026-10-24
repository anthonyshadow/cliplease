import { INLINE_LINK } from "@/components/ui/inline-link";
import { SUPPORT_EMAIL } from "@/lib/app-name";

/**
 * "Payouts unavailable. Contact {SUPPORT_EMAIL}." (P05 owner answer): PayoutsStatusLine for a refused account, and the
 * Review's payouts Notice in its callout text.
 */
export function PayoutsUnavailable({
  className = "text-body text-ink",
}: {
  className?: string;
}) {
  return (
    <p className={className}>
      Payouts unavailable. Contact{" "}
      <a href={`mailto:${SUPPORT_EMAIL}`} className={INLINE_LINK}>
        {SUPPORT_EMAIL}
      </a>
      .
    </p>
  );
}
