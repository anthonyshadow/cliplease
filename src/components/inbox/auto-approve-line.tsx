"use client";

import { useViewerDeadline } from "@/components/ui/use-viewer-deadline";
import { autoApproveLine } from "@/lib/licensing/inbox";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import { cn } from "@/lib/utils";
import { LINE, LINE_TONE } from "./result-line";

/**
 * Auto-approve's line under a request (04 §9.11, §11.5; 07 D81): "Auto-approve couldn't finish. Tap Approve before
 * {deadline}." in the awaiting tone on a waiting request it fell back on, the deadline in the viewer's zone after mount;
 * or "Auto-approved" on an approved one. The awaiting tone is 04's, over 05 §6.3 callout 17's ink.
 */
export function AutoApproveLine({
  request,
}: {
  request: Pick<
    CreatorRequest,
    "displayStatus" | "autoApproveFallbackAt" | "autoApproved" | "expiresAt"
  >;
}) {
  const deadline = useViewerDeadline(request.expiresAt);
  const line = autoApproveLine(request, deadline);
  if (!line) return null;
  return <p className={cn(LINE, LINE_TONE[line.tone])}>{line.text}</p>;
}
