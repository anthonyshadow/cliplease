"use client";

import { useViewerDeadline } from "@/components/ui/use-viewer-deadline";
import { autoApproveLine } from "@/lib/licensing/inbox";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import { cn } from "@/lib/utils";

/**
 * Auto-approve's line under a request (04 §9.11, §11.5; 07 D81): "Auto-approve couldn't finish. Tap Approve before
 * {deadline}." in amber text on a waiting request it fell back on, the deadline in the viewer's zone after mount; or
 * "Auto-approved" on an approved one. The amber is 04's `awaiting` tone, over 05 §6.3 callout 17's ink.
 */
export function AutoApproveLine({
  request,
}: {
  request: Pick<
    CreatorRequest,
    | "displayStatus"
    | "status"
    | "autoApproveFallbackAt"
    | "autoApproved"
    | "expiresAt"
  >;
}) {
  const deadline = useViewerDeadline(request.expiresAt);
  const line = autoApproveLine(request, deadline);
  if (!line) return null;
  return (
    <p
      className={cn(
        "text-footnote wrap-anywhere",
        line.tone === "awaiting" ? "text-awaiting-text" : "text-ink-2",
      )}
    >
      {line.text}
    </p>
  );
}
