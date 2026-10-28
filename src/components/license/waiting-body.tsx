"use client";

import { useClientValue } from "@/components/ui/use-client-value";
import { formatDeadline } from "@/lib/format";
import { REQUEST_STATUS_COPY } from "@/lib/licensing/request-status";

/** The viewer's zone, read in the browser only. */
const viewerTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * /r's hold sentence for a request waiting for the creator (01 §4.8): the deadline in the viewer's zone, formatted after
 * mount so the server's HTML and the first client render agree (02 §4.4); until then the sentence naming it is left out.
 */
export function WaitingBody({
  handle,
  total,
  expiresAt,
}: {
  handle: string;
  /** formatMoney's total. */
  total: string;
  /** ISO 8601 instant. */
  expiresAt: string | null;
}) {
  const deadline = useClientValue(
    () =>
      expiresAt ? formatDeadline(new Date(expiresAt), viewerTimeZone()) : null,
    null,
  );
  return (
    <p className="text-body text-ink-2 wrap-anywhere">
      {REQUEST_STATUS_COPY.waitingBody(handle, total, deadline)}
    </p>
  );
}
