"use client";

import { useState } from "react";
import {
  approveRequest,
  declineRequest,
} from "@/app/(dashboard)/dashboard/actions";
import { runAction } from "@/components/ui/run-action";
import { toast } from "@/components/ui/toast";
import {
  approveOutcome,
  declineOutcome,
  type RowOutcome,
  showsSeal,
} from "@/lib/licensing/inbox";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import type { ActionResult } from "@/lib/result";

/** The action a row or the request page is running. */
type RequestAction = "approve" | "decline";

/**
 * Approve and Decline from a row or the request page (01 J8.2, J8.4: one tap each, no confirm). One pending state for
 * both: the tapped button shows its loading label and the other is disabled, so "Approving…" disables Decline and
 * "Declining…" Approve (04 §9.11, §10.3; 05 §6.3). Each resolves to what its result shows (null while Next leaves the
 * page), after raising its toast (the seal only for an approval, 04 §9.23).
 */
export function useRequestActions(request: CreatorRequest) {
  const [pending, setPending] = useState<RequestAction | null>(null);

  async function run<T>(
    name: RequestAction,
    action: () => Promise<ActionResult<T>>,
    outcomeOf: (result: T | null) => RowOutcome,
  ): Promise<RowOutcome | null> {
    setPending(name);
    const result = await runAction(action);
    setPending(null);
    if (!result) return null;
    const outcome = outcomeOf(result.ok ? result.data : null);
    if (outcome.toast) toast(outcome.toast, { seal: showsSeal(outcome) });
    return outcome;
  }

  return {
    pending,
    approve: () =>
      run(
        "approve",
        () => approveRequest({ requestId: request.id }),
        (result) => approveOutcome(result, request),
      ),
    decline: () =>
      run(
        "decline",
        () => declineRequest({ requestId: request.id }),
        declineOutcome,
      ),
  };
}
