"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useFocusAfterRender } from "@/components/ui/use-focus-after-render";
import {
  INBOX_COPY,
  type RowOutcome,
  requestPageLine,
} from "@/lib/licensing/inbox";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import { ResultLineView } from "./result-line";
import { useRequestActions } from "./use-request-actions";

/** The request page's status block id: the focus goes there after a result with no line of its own. */
export const REQUEST_STATUS_ID = "request-status";

/**
 * The request page's action row (05 §6.4; 04 §9.11): Decline (`secondary lg`) left of Approve (`primary lg`), each at
 * its own width under the facts card, at every tier (07 D149); one pending state disables the other button. It stays
 * mounted across the action's refresh(), which re-renders the page in its stored state, so it adds only the result line
 * that state doesn't show (requestPageLine: a plain decline's stays) and the toast. The buttons go once the request is
 * decided, claimed or overdue, or the result settled it. Then the focus moves to the result.
 */
export function RequestActions({
  request,
  payoutsNotice,
}: {
  request: CreatorRequest;
  /** The page already says payouts aren't active (07 D77). */
  payoutsNotice: boolean;
}) {
  const { pending, approve, decline } = useRequestActions(request);
  const [outcome, setOutcome] = useState<RowOutcome | null>(null);
  const lineBox = useRef<HTMLDivElement>(null);
  const focusResult = useFocusAfterRender(
    () => lineBox.current ?? document.getElementById(REQUEST_STATUS_ID),
  );
  const line = requestPageLine(outcome, request, payoutsNotice);
  const showActions =
    request.displayStatus === "awaiting_approval" && !outcome?.settles;

  async function onTap(action: () => Promise<RowOutcome | null>) {
    setOutcome(null);
    const result = await action();
    if (!result) return;
    setOutcome(result);
    focusResult();
  }

  if (!line && !showActions) return null;
  return (
    <div className="flex flex-col items-start gap-3">
      {line ? (
        <div ref={lineBox} tabIndex={-1} className="outline-none">
          <ResultLineView line={line} expiresAt={request.expiresAt} />
        </div>
      ) : null}
      {showActions ? (
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            loading={pending === "decline"}
            loadingLabel={INBOX_COPY.declining}
            disabled={pending === "approve"}
            onClick={() => onTap(decline)}
          >
            {INBOX_COPY.decline}
          </Button>
          <Button
            loading={pending === "approve"}
            loadingLabel={INBOX_COPY.approving}
            disabled={pending === "decline"}
            onClick={() => onTap(approve)}
          >
            {INBOX_COPY.approve}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
