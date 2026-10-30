"use client";

import { approveRequest } from "@/app/(dashboard)/dashboard/actions";
import { toast } from "@/components/ui/toast";
import { usePendingAction } from "@/components/ui/use-pending-action";
import {
  approveOutcome,
  type RowOutcome,
  showsSeal,
} from "@/lib/licensing/inbox";
import type { CreatorRequest } from "@/lib/licensing/request-dto";

/**
 * Approve from a row or the request page (01 J8.2: one tap, no confirm). `approve` resolves to what the result shows
 * (null while Next leaves the page), after raising the approval toast; `pending` drives "Approving…".
 */
export function useApprove(request: CreatorRequest) {
  const [pending, run] = usePendingAction();
  async function approve(): Promise<RowOutcome | null> {
    const result = await run(() => approveRequest({ requestId: request.id }));
    if (!result) return null;
    const outcome = approveOutcome(result.ok ? result.data : null, request);
    if (outcome.toast) toast(outcome.toast, { seal: showsSeal(outcome) });
    return outcome;
  }
  return { pending, approve };
}
