import { SupportEmailLink } from "@/components/ui/support-email-link";

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
      Payouts unavailable. Contact <SupportEmailLink />.
    </p>
  );
}
