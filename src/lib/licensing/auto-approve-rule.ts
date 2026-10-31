import type { PayoutsStatus } from "@/lib/domain/values";

/**
 * Whether a creator's new requests auto-approve (07 D81; owner answer Q-155): the setting on and the stored payouts
 * status active, read from creator_profile with no Stripe call. The license page shows it; saveRequest snapshots it.
 */
export function autoApprovesNewRequests(p: {
  autoApprove: boolean;
  payoutsStatus: PayoutsStatus;
}): boolean {
  return p.autoApprove && p.payoutsStatus === "active";
}
