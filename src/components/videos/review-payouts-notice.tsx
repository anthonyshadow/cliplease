import { PayoutCurrencyFacts } from "@/components/payouts/payout-currency-facts";
import { PayoutsUnavailable } from "@/components/payouts/payouts-unavailable";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { Currency, PayoutsStatus } from "@/lib/domain/values";
import {
  isPayoutsUnavailable,
  PAYOUTS_NOTICE_COPY,
  payoutsSetupHref,
  payoutsSetupLabel,
} from "@/lib/payouts";
import { CheckPayoutsAgain } from "./check-payouts-again";

/**
 * The Review's payouts Notice (05 §6.5 callout 50 and States; 07 D74; owner answers Q-94 a, Q-95 a), for any status but
 * active: never a blocker. Set up payouts or Finish setup goes to onboarding and comes back to this draft (`returnTo`);
 * pending says Stripe is checking, with Check again; a refused account gets the unavailable line and no link. The
 * payout currency and refund lines follow, as on Settings.
 */
export function ReviewPayoutsNotice({
  status,
  currency,
  returnTo,
}: {
  status: PayoutsStatus;
  currency: Currency;
  returnTo: string;
}) {
  if (status === "active") return null;
  const setupLabel = payoutsSetupLabel(status);
  const action = setupLabel ? (
    <Button asChild variant="link" size="sm">
      <a href={payoutsSetupHref(returnTo)}>{setupLabel}</a>
    </Button>
  ) : status === "pending" ? (
    <CheckPayoutsAgain />
  ) : null;
  return (
    <div data-payouts-notice className="flex flex-col gap-3">
      <Notice action={action}>
        <div className="flex flex-col gap-1">
          <p>{PAYOUTS_NOTICE_COPY.canPublish}</p>
          {status === "pending" ? <p>{PAYOUTS_NOTICE_COPY.pending}</p> : null}
          {isPayoutsUnavailable(status) ? (
            <PayoutsUnavailable className="text-callout text-ink-2" />
          ) : null}
        </div>
      </Notice>
      <PayoutCurrencyFacts currency={currency} />
    </div>
  );
}
