"use client";

import { CountdownChip, StatusPill } from "@/components/ui/status-pill";
import { useViewerDeadline } from "@/components/ui/use-viewer-deadline";
import { INBOX_COPY, outcomeLine, requestPill } from "@/lib/licensing/inbox";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import type { DisplayStatus } from "@/lib/licensing/transitions";
import { cn } from "@/lib/utils";

/**
 * Where a request stands, for its creator (04 §9.11; 05 §6.3, §6.4): a waiting request's countdown (neutral above 6 h,
 * amber at 6 h or less), else its pill. `status` shows an action's result on a row kept in place (null keeps the
 * countdown).
 */
export function RequestStatus({
  request,
  status = request.displayStatus,
}: {
  request: CreatorRequest;
  status?: DisplayStatus | null;
}) {
  const pill = status ? requestPill(status) : null;
  if (pill) return <StatusPill tone={pill.tone}>{pill.label}</StatusPill>;
  return request.expiresAt ? (
    <CountdownChip
      expiresAt={request.expiresAt}
      srPrefix={INBOX_COPY.waitingForYouSr}
    />
  ) : null;
}

/** A decided request's line (04 §11.5): its expiry in the viewer's zone, a failed capture in danger text, a disabled video. */
export function RequestOutcome({ request }: { request: CreatorRequest }) {
  const deadline = useViewerDeadline(request.expiresAt);
  const line = outcomeLine(request, deadline);
  if (!line) return null;
  return (
    <p
      className={cn(
        "text-footnote",
        line.danger ? "text-danger-text" : "text-ink-2",
      )}
    >
      {line.text}
    </p>
  );
}
