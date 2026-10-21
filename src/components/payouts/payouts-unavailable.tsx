import { INLINE_LINK } from "@/components/ui/inline-link";
import { SUPPORT_EMAIL } from "@/lib/app-name";

/** "Payouts unavailable. Contact {SUPPORT_EMAIL}." (P05 owner answer): PayoutsStatusLine for a refused account. */
export function PayoutsUnavailable() {
  return (
    <p className="text-body text-ink">
      Payouts unavailable. Contact{" "}
      <a href={`mailto:${SUPPORT_EMAIL}`} className={INLINE_LINK}>
        {SUPPORT_EMAIL}
      </a>
      .
    </p>
  );
}
