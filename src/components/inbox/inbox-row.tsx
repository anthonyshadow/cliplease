"use client";

import Link from "next/link";
import { PosterThumb } from "@/components/license/poster-thumb";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { formatMoney } from "@/lib/format";
import { INBOX_COPY } from "@/lib/licensing/inbox";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import { scopeLabel } from "@/lib/licensing/selection";
import { requestDetailPath } from "@/lib/urls";
import { RequestFacts } from "./request-facts";
import { RequestOutcome, RequestStatus } from "./request-status-line";

/**
 * One request in the Inbox list (04 §9.11; 05 §6.3; 07 D146). Below md the stacked row: the text beside the poster, the
 * countdown under it, then Details. From md the wide row, a grid: the countdown top-right on the Licensed-to line, and
 * Details bottom-right on the third line, in the spot P18 and P19 fill with Decline · Approve (Approve rightmost). The
 * facts open under the row, full width. A waiting row shows its scope and "You get {price}"; a History row its price,
 * pill and outcome, no actions. Long names and scopes wrap in the text column.
 */
export function InboxRow({ request }: { request: CreatorRequest }) {
  const waiting = request.status === "awaiting_approval";
  const price = formatMoney(request.licensePriceCents, request.currency);
  return (
    <li
      data-inbox-row
      className="mx-4 grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-hairline py-4 [&+&]:border-t md:grid-cols-[3rem_minmax(0,1fr)_auto]"
    >
      <div className="row-span-2 md:row-span-3">
        <PosterThumb src={request.posterUrl} />
      </div>
      <div className="flex min-w-0 flex-col gap-1 md:row-span-3">
        <p
          data-licensee
          className="text-body font-semibold text-ink wrap-anywhere"
        >
          {request.licenseeName}
        </p>
        {waiting ? (
          <p className="text-callout text-ink-2 wrap-anywhere">
            {scopeLabel(request)}
          </p>
        ) : null}
        <p className="text-footnote text-ink-2 tabular-nums wrap-anywhere">
          {`${request.title} · ${waiting ? INBOX_COPY.youGet(price) : price}`}
        </p>
        <RequestOutcome request={request} />
      </div>
      {/* Focusable for P18: after Approve or Decline the focus moves to the row's status (05 §6.3). */}
      <div
        data-row-status
        tabIndex={-1}
        className="col-start-2 outline-none md:col-start-3 md:row-start-1 md:justify-self-end"
      >
        <RequestStatus request={request} className="md:justify-end" />
      </div>
      {waiting ? (
        // `actions`: P18 and P19 put Decline · Approve here (04 §9.11).
        <Disclosure
          label={INBOX_COPY.details}
          actions={null}
          className="contents"
          rowClassName="col-span-full md:col-span-1 md:col-start-3 md:row-start-3 md:self-end"
          contentClassName="col-span-full"
        >
          <div className="flex flex-col items-start gap-3">
            <RequestFacts request={request} />
            <Button asChild variant="link">
              <Link href={requestDetailPath(request.id)}>
                {INBOX_COPY.openRequest}
              </Link>
            </Button>
          </div>
        </Disclosure>
      ) : null}
    </li>
  );
}
