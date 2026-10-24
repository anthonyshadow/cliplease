import Link from "next/link";
import type { ReactNode } from "react";
import { PayoutCurrencyFacts } from "@/components/payouts/payout-currency-facts";
import { PayoutsStatusLine } from "@/components/payouts/payouts-status-line";
import { Button } from "@/components/ui/button";
import { PRIMARY_WIDTH, TERTIARY } from "@/components/ui/primary-width";
import type { Currency, PayoutsStatus } from "@/lib/domain/values";
import {
  PAYOUTS_NOTICE_COPY,
  payoutsSetupHref,
  payoutsSetupLabel,
} from "@/lib/payouts";

/**
 * Step 3: publishing never waits for payouts (07 D74). Settings' button (Set up payouts, or Finish setup when Stripe
 * needs more information) with "Skip for now"; it is a plain link: the route creates the account. Without a button (on,
 * pending, unavailable; a judgment call): Continue to the Library.
 */
export function PayoutsStep({
  status,
  currency,
}: {
  status: PayoutsStatus;
  currency: Currency;
}) {
  const setupLabel = payoutsSetupLabel(status);
  let actions: ReactNode;
  if (setupLabel) {
    actions = (
      <>
        <Button asChild className={PRIMARY_WIDTH}>
          <a href={payoutsSetupHref()}>{setupLabel}</a>
        </Button>
        <Button asChild variant="tertiary" className={TERTIARY}>
          <Link href="/dashboard/library">Skip for now</Link>
        </Button>
      </>
    );
  } else {
    actions = (
      <Button asChild className={PRIMARY_WIDTH}>
        <Link href="/dashboard/library">Continue</Link>
      </Button>
    );
  }
  return (
    <>
      <p className="text-callout text-ink-2">
        {PAYOUTS_NOTICE_COPY.canPublish}
      </p>
      <PayoutsStatusLine status={status} onboarding />
      <PayoutCurrencyFacts currency={currency} />
      {actions}
    </>
  );
}
