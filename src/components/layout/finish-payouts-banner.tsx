import Link from "next/link";
import { PayoutsWaiting } from "@/components/inbox/payouts-waiting";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import type { PayoutsStatus } from "@/lib/domain/values";
import { INBOX_COPY } from "@/lib/licensing/inbox";

/**
 * The persistent payouts Banner on the creator's Library and Inbox while payouts aren't on (07 D74, 04 §11.5): info tone,
 * not dismissible, and nothing at all once they're active. With a request waiting (`soonestExpiresAt`, the Inbox) it
 * warns instead that the request stays open until its deadline (01 J8.3, 07 D77; 05 §6.3 callout 15: one banner, not
 * two). It links to Settings' Payouts section, so the creator reads the payout currency and the negative-balance line
 * before Stripe (owner answer Q5). P19b extends it.
 */
export function FinishPayoutsBanner({
  payoutsStatus,
  soonestExpiresAt,
  className,
}: {
  payoutsStatus: PayoutsStatus;
  /** The soonest deadline among the waiting requests (ISO 8601), if any. */
  soonestExpiresAt?: string | null;
  className?: string;
}) {
  if (payoutsStatus === "active") return null;
  return (
    <Banner
      tone={soonestExpiresAt ? "warning" : "info"}
      className={className}
      action={
        <Button asChild variant="link">
          <Link href="/dashboard/settings#payouts">
            {INBOX_COPY.setUpPayouts}
          </Link>
        </Button>
      }
    >
      {soonestExpiresAt ? (
        <PayoutsWaiting expiresAt={soonestExpiresAt} />
      ) : (
        "Set up payouts so you can approve requests (about 2 min)"
      )}
    </Banner>
  );
}
