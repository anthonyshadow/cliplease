"use client";

import { useViewerDeadline } from "@/components/ui/use-viewer-deadline";

/**
 * A waiting request's deadline in the viewer's own zone, "Thu 19 Nov, 5:00 PM EST" (01 G.7, 07 D84; design §4.10): read
 * after mount, so the server's HTML and the first client render agree; empty until then.
 */
export function DeadlineCell({ iso }: { iso: string }) {
  const deadline = useViewerDeadline(iso);
  return (
    <time dateTime={iso} className="tabular-nums">
      {deadline}
    </time>
  );
}
