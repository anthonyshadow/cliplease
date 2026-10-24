"use client";

import { refreshPayoutsStatus } from "@/app/(dashboard)/dashboard/videos/[id]/review-actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useFocusOnRemove } from "@/components/ui/use-focus-on-remove";
import { usePendingAction } from "@/components/ui/use-pending-action";
import {
  PAYOUTS_NOTICE_COPY,
  PAYOUTS_ON_MESSAGE,
  PAYOUTS_STATUS_LABEL,
} from "@/lib/payouts";
import { STEP_HEADING_ID } from "@/lib/videos/steps";

/**
 * The pending Notice's "Check again" (05 §6.5 States): the status read again, then the page when it changed. A toast
 * says what it found (Settings' words) or that the read failed. When the status moved on, the Notice changes or goes,
 * and this button with it: the focus on it goes to the step's heading instead of falling to the page.
 */
export function CheckPayoutsAgain() {
  const [checking, run] = usePendingAction();
  const button = useFocusOnRemove<HTMLButtonElement>(STEP_HEADING_ID);
  async function check() {
    const result = await run(refreshPayoutsStatus);
    if (result === null) return;
    if (!result.ok) {
      toast(result.error.message);
      return;
    }
    const status = result.data.payoutsStatus;
    toast(
      status === "active" ? PAYOUTS_ON_MESSAGE : PAYOUTS_STATUS_LABEL[status],
    );
  }
  return (
    <Button
      ref={button}
      variant="link"
      size="sm"
      loading={checking}
      loadingLabel="Checking…"
      onClick={check}
    >
      {PAYOUTS_NOTICE_COPY.checkAgain}
    </Button>
  );
}
