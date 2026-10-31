import { PayoutsWaiting } from "@/components/inbox/payouts-waiting";
import { PayoutsUnavailable } from "@/components/payouts/payouts-unavailable";
import { SetUpPayoutsLink } from "@/components/payouts/set-up-payouts-link";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import type { Currency, PayoutsStatus } from "@/lib/domain/values";
import { formatMoney } from "@/lib/format";
import { INBOX_COPY } from "@/lib/licensing/inbox";
import { PAYOUT_LINE_COPY } from "@/lib/licensing/payout-line";
import { isPayoutsUnavailable, payoutsSetupHref } from "@/lib/payouts";

/** The sum of the creator's failed transfers (failedTransferTotalCents), in their payout currency: 0 cents for none. */
type FailedTransfer = { cents: number; currency: Currency };

/**
 * The persistent payouts Banner on the creator's Library and Inbox (07 D74, D75; 04 §9.21, §11.5): at most one, and the
 * transfer one wins. After a failed creator transfer it is TransferFailedBanner, whatever the payouts status. Otherwise
 * nothing once payouts are active; until then info tone, not dismissible, and with a request waiting (`soonestExpiresAt`,
 * the Inbox) it warns instead that the request stays open until its deadline (01 J8.3, 07 D77; 05 §6.3 callout 15: one
 * banner, not two). The setup banners link to Settings' Payouts section, so the creator reads the payout currency and
 * the negative-balance line before Stripe (owner answer Q5).
 */
export function FinishPayoutsBanner({
  payoutsStatus,
  soonestExpiresAt,
  failedTransfer,
  className,
}: {
  payoutsStatus: PayoutsStatus;
  /** The soonest deadline among the waiting requests (ISO 8601), if any. */
  soonestExpiresAt?: string | null;
  failedTransfer: FailedTransfer;
  className?: string;
}) {
  if (failedTransfer.cents > 0) {
    return (
      <TransferFailedBanner
        failedTransfer={failedTransfer}
        payoutsStatus={payoutsStatus}
        soonestExpiresAt={soonestExpiresAt}
        className={className}
      />
    );
  }
  if (payoutsStatus === "active") return null;
  return (
    <Banner
      tone={soonestExpiresAt ? "warning" : "info"}
      className={className}
      action={<SetUpPayoutsLink />}
    >
      {soonestExpiresAt ? (
        <PayoutsWaiting expiresAt={soonestExpiresAt} />
      ) : (
        "Set up payouts so you can approve requests (about 2 min)"
      )}
    </Banner>
  );
}

/**
 * A failed creator transfer (07 D75; 05 §6.3 callout 16; owner answer Q-147 a: warning tone): "Finish your payout setup
 * to receive {amount}." with the sum of the failed transfers (one currency per creator, I33), until a sweep sends them.
 * While payouts aren't active and a request waits, J8.3's deadline sentence follows in the same Banner (owner answer
 * Q-150 a; 07 D77). Set up payouts goes straight to the setup route as a plain <a> (the route handler calls Stripe, so it
 * is never prefetched), and its return to Settings sends the transfers; a refused account gets the unavailable line
 * instead. Settings shows this Banner alone, above Payouts (05 §6.11). Nothing when no transfer failed.
 */
export function TransferFailedBanner({
  failedTransfer,
  payoutsStatus,
  soonestExpiresAt,
  className,
}: {
  failedTransfer: FailedTransfer;
  payoutsStatus: PayoutsStatus;
  /** The soonest deadline among the waiting requests (ISO 8601), if any: the Inbox's. */
  soonestExpiresAt?: string | null;
  className?: string;
}) {
  if (failedTransfer.cents <= 0) return null;
  const waitingDeadline =
    payoutsStatus !== "active" && soonestExpiresAt ? soonestExpiresAt : null;
  return (
    <Banner
      tone="warning"
      className={className}
      action={
        isPayoutsUnavailable(payoutsStatus) ? (
          <PayoutsUnavailable className="text-callout text-ink" />
        ) : (
          <Button asChild variant="link">
            <a href={payoutsSetupHref()}>{INBOX_COPY.setUpPayouts}</a>
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-1">
        <p>
          {PAYOUT_LINE_COPY.failed(
            formatMoney(failedTransfer.cents, failedTransfer.currency),
          )}
        </p>
        {waitingDeadline ? (
          <p>
            <PayoutsWaiting expiresAt={waitingDeadline} />
          </p>
        ) : null}
      </div>
    </Banner>
  );
}
