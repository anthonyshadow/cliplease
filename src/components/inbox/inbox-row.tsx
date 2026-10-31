"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { ClearedSeal } from "@/components/cleared/cleared-seal";
import { PosterThumb } from "@/components/license/poster-thumb";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { useFocusAfterRender } from "@/components/ui/use-focus-after-render";
import { useFocusOnRemove } from "@/components/ui/use-focus-on-remove";
import { formatMoney } from "@/lib/format";
import {
  INBOX_COPY,
  type ResultLine,
  type RowOutcome,
  showsSeal,
} from "@/lib/licensing/inbox";
import type { CreatorRequest } from "@/lib/licensing/request-dto";
import { requestDetailPath } from "@/lib/urls";
import { RequestFacts } from "./request-facts";
import { RequestOutcome, RequestStatus } from "./request-status-line";
import { ResultLineView } from "./result-line";
import { useRequestActions } from "./use-request-actions";

/** How a row tells its list about an action: started (hold the row) and how it ended (null: nothing to show). */
export type RowActionEvents = {
  onStart: (request: CreatorRequest) => void;
  onDone: (request: CreatorRequest, outcome: RowOutcome | null) => void;
};

/**
 * One request in the Inbox list (04 §9.11; 05 §6.3; 07 D146). Below md the stacked row: the text beside the poster, the
 * countdown under it, then Decline and Approve, half width each (Approve on the right), with Details after them. From
 * md the wide row, a grid: the countdown top-right on the Licensed-to line, and Details · Decline · Approve
 * bottom-right on the third line, Approve rightmost. The facts open under the row, full width. A waiting row shows its
 * scope and "You get {price}"; a History row its price, pill and outcome, no actions; a claimed row reads Processing…
 * and an overdue one Expired (until its expiry is stored, with no sentence; owner answer Q-142 a), neither with
 * actions. `outcome` is an action's result kept with the row, as it was before the tap, until the next refresh (02
 * §4.4 rule 2): its pill (with the 16 px seal for an approval) and its line where the actions were; "You get" stays
 * only for an approval (owner answer Q-128 a). After any result the focus moves to the row's status, which the
 * result's line describes (05 §6.3).
 */
export function InboxRow({
  request,
  outcome = null,
  events,
  focusTargetId,
}: {
  request: CreatorRequest;
  outcome?: RowOutcome | null;
  events?: RowActionEvents;
  /** Takes the focus when the row leaves with the focus inside it. */
  focusTargetId?: string;
}) {
  const waiting = request.status === "awaiting_approval";
  const price = formatMoney(request.licensePriceCents, request.currency);
  const { pending, approve, decline } = useRequestActions(request);
  const [liveLine, setLiveLine] = useState<ResultLine | null>(null);
  const status = useRef<HTMLDivElement>(null);
  const focusStatus = useFocusAfterRender(() => status.current);
  const row = useFocusOnRemove<HTMLLIElement>(focusTargetId);
  const lineId = useId();
  // A line that left the row live (retry, payouts) goes with the actions, once the row reads Expired or Processing….
  const line =
    outcome?.line ??
    (request.displayStatus === "awaiting_approval" ? liveLine : null);
  // What the creator gets, only while it is still true: a waiting row before its deadline, or an approval's result.
  const youGet = outcome
    ? outcome.pill === "approved"
    : waiting && request.displayStatus !== "expired";

  async function onTap(action: () => Promise<RowOutcome | null>) {
    setLiveLine(null);
    events?.onStart(request);
    const result = await action();
    events?.onDone(request, result);
    if (!result) return;
    if (!result.settles) setLiveLine(result.line);
    focusStatus();
  }

  const actions =
    request.displayStatus === "awaiting_approval" ? (
      <div className="grid w-full grid-cols-2 gap-3 md:flex md:w-auto md:items-center">
        <Button
          variant="secondary"
          size="sm"
          className="col-start-1 w-full md:w-auto"
          loading={pending === "decline"}
          loadingLabel={INBOX_COPY.declining}
          disabled={pending === "approve"}
          onClick={() => onTap(decline)}
        >
          {INBOX_COPY.decline}
        </Button>
        <Button
          size="sm"
          className="col-start-2 w-full md:w-auto"
          loading={pending === "approve"}
          loadingLabel={INBOX_COPY.approving}
          disabled={pending === "decline"}
          onClick={() => onTap(approve)}
        >
          {INBOX_COPY.approve}
        </Button>
      </div>
    ) : null;

  return (
    <li
      ref={row}
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
            {request.scope}
          </p>
        ) : null}
        <p className="text-footnote text-ink-2 tabular-nums wrap-anywhere">
          {showsSeal(outcome) ? (
            <ClearedSeal
              size={16}
              className="mr-1 inline-block align-[-0.125em]"
            />
          ) : null}
          {`${request.title} · ${youGet ? INBOX_COPY.youGet(price) : price}`}
        </p>
        <RequestOutcome request={request} />
        {line ? (
          <ResultLineView
            id={lineId}
            line={line}
            expiresAt={request.expiresAt}
          />
        ) : null}
      </div>
      <div
        ref={status}
        data-row-status
        tabIndex={-1}
        aria-describedby={line ? lineId : undefined}
        className="col-start-2 flex flex-wrap items-center gap-2 outline-none md:col-start-3 md:row-start-1 md:justify-self-end md:justify-end"
      >
        <div
          key={outcome ? "settled" : "live"}
          className={outcome ? "animate-cross-fade" : undefined}
        >
          <RequestStatus request={request} status={outcome?.pill} />
        </div>
        {request.licenseCode ? (
          <span className="text-footnote text-ink tracking-code">
            {request.licenseCode}
          </span>
        ) : null}
      </div>
      {waiting && !outcome ? (
        <Disclosure
          label={INBOX_COPY.details}
          actions={actions}
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
