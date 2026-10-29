"use client";

import { CountdownChip, StatusPill } from "@/components/ui/status-pill";
import { useViewerDeadline } from "@/components/ui/use-viewer-deadline";
import { INBOX_COPY, outcomeLine, requestPill } from "@/lib/licensing/inbox";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import { cn } from "@/lib/utils";

/**
 * Where a request stands, for its creator (04 §9.11; 05 §6.3, §6.4): a waiting request's countdown (neutral above 6 h,
 * amber at 6 h or less), else its pill, with the license's code once issued.
 */
export function RequestStatus({
  request,
  className,
}: {
  request: CreatorRequest;
  className?: string;
}) {
  const pill = requestPill(request.displayStatus);
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {pill ? (
        <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
      ) : request.expiresAt ? (
        <CountdownChip
          expiresAt={request.expiresAt}
          srPrefix={INBOX_COPY.waitingForYouSr}
        />
      ) : null}
      {request.licenseCode ? (
        <span className="text-footnote text-ink tracking-code">
          {request.licenseCode}
        </span>
      ) : null}
    </div>
  );
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
