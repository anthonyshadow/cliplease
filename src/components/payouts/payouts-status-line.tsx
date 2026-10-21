import type { PayoutsStatus } from "@/lib/domain/values";
import { isPayoutsUnavailable, PAYOUTS_STATUS_LABEL } from "@/lib/payouts";
import { PayoutsUnavailable } from "./payouts-unavailable";

/**
 * The payouts status line Settings shows (01 J11.1), or the unavailable line for a refused account. The onboarding
 * payouts step shows none before setup, and Stripe's pending line as a sentence.
 */
export function PayoutsStatusLine({
  status,
  onboarding = false,
}: {
  status: PayoutsStatus;
  onboarding?: boolean;
}) {
  if (isPayoutsUnavailable(status)) return <PayoutsUnavailable />;
  if (onboarding && status === "not_started") return null;
  return (
    <p className="text-body text-ink">
      {onboarding && status === "pending"
        ? "Stripe is checking your details."
        : PAYOUTS_STATUS_LABEL[status]}
    </p>
  );
}
