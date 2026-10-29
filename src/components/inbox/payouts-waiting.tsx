"use client";

import { useViewerDeadline } from "@/components/ui/use-viewer-deadline";
import { INBOX_COPY } from "@/lib/licensing/inbox";

/** "Finish payout setup to approve. This request stays open until {deadline}." (01 J8.3, 07 D77), in the viewer's zone. */
export function PayoutsWaiting({ expiresAt }: { expiresAt: string }) {
  return <>{INBOX_COPY.payoutsWaiting(useViewerDeadline(expiresAt))}</>;
}
