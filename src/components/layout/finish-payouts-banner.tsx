import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import type { PayoutsStatus } from "@/lib/domain/values";

/**
 * The persistent payouts Banner on the creator's Library and Inbox while payouts aren't on (07 D74, 04 §11.5): info tone,
 * not dismissible, and nothing at all once they're active. It links to Settings' Payouts section, so the creator reads
 * the payout currency and the negative-balance line before Stripe (owner answer Q5). P19b extends it.
 */
export function FinishPayoutsBanner({
  payoutsStatus,
  className,
}: {
  payoutsStatus: PayoutsStatus;
  className?: string;
}) {
  if (payoutsStatus === "active") return null;
  return (
    <Banner
      className={className}
      action={
        <Button asChild variant="link">
          <Link href="/dashboard/settings#payouts">Set up payouts</Link>
        </Button>
      }
    >
      Set up payouts so you can approve requests (about 2 min)
    </Banner>
  );
}
