import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PayoutsWaiting } from "@/components/inbox/payouts-waiting";
import {
  REQUEST_STATUS_ID,
  RequestActions,
} from "@/components/inbox/request-actions";
import { RequestFacts } from "@/components/inbox/request-facts";
import {
  RequestOutcome,
  RequestStatus,
} from "@/components/inbox/request-status-line";
import { LicenseIssuedLine } from "@/components/inbox/result-line";
import { SETTINGS_COLUMN } from "@/components/layout/gutter";
import { PosterThumb } from "@/components/license/poster-thumb";
import { SetUpPayoutsLink } from "@/components/payouts/set-up-payouts-link";
import { Notice } from "@/components/ui/notice";
import { BackLink } from "@/components/videos/back-link";
import { INBOX_COPY } from "@/lib/licensing/inbox";
import { requestDetailPath } from "@/lib/urls";
import { isUuid } from "@/lib/validation/uuid";
import { requireCreator } from "@/server/auth/session";
import { settleCreatorRequests } from "@/server/licensing/lazy";
import { getRequestForCreator } from "@/server/licensing/queries";

/** The tab names the Inbox the page belongs to (owner answer Q-126 a). */
export const metadata: Metadata = { title: INBOX_COPY.inbox };

/** Approve's and Decline's Server Actions run with this page's limit: up to a Stripe call and its finish (07 D26). */
export const maxDuration = 60;

/**
 * S15, one request on its own page (05 §6.4; 04 §9.11): the request-new email's link and the Inbox's "Open request". The
 * heading, the countdown or the pill (with a decided request's line), then the facts card, in one max-w-reading column
 * left-aligned with the title at every tier (07 D145). While payouts aren't active a waiting request says it stays open
 * until its deadline (07 D77). Another creator's request, an unknown id, and a request the creator never sees (in
 * checkout, abandoned, a renewal) are a 404. The action row under the card: Decline and Approve; an approved request
 * reads "License {code} issued" under its pill. The request is settled first: a stuck claim reconciled, an overdue
 * request expired after the response (02 §8.4).
 */
export default async function RequestDetailPage({
  params,
}: PageProps<"/dashboard/requests/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { creator } = await requireCreator(requestDetailPath(id));
  await settleCreatorRequests({ creatorId: creator.id, requestId: id });
  const request = await getRequestForCreator(creator.id, id);
  if (!request) notFound();
  // A waiting request's deadline while payouts aren't active (07 D77); none once it reads Expired (Q-142 a).
  const payoutsDeadline =
    request.displayStatus === "awaiting_approval" &&
    creator.payoutsStatus !== "active"
      ? request.expiresAt
      : null;
  return (
    <div className={SETTINGS_COLUMN}>
      <BackLink href="/dashboard">{INBOX_COPY.inbox}</BackLink>
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-title-2 text-ink wrap-anywhere">
          {INBOX_COPY.detailHeading(request.licenseeName, request.title)}
        </h1>
        <div
          id={REQUEST_STATUS_ID}
          tabIndex={-1}
          className="flex flex-col items-start gap-3 outline-none"
        >
          <RequestStatus request={request} />
          {request.licenseCode ? (
            <LicenseIssuedLine code={request.licenseCode} />
          ) : null}
          <RequestOutcome request={request} />
        </div>
      </div>
      <section
        aria-label={request.title}
        className="flex flex-col gap-4 rounded-lg bg-surface p-5"
      >
        <div className="flex items-center gap-3">
          <PosterThumb src={request.posterUrl} />
          <p className="min-w-0 text-body font-semibold text-ink wrap-anywhere">
            {request.title}
          </p>
        </div>
        <RequestFacts request={request} />
      </section>
      {payoutsDeadline ? (
        <Notice action={<SetUpPayoutsLink />}>
          <PayoutsWaiting expiresAt={payoutsDeadline} />
        </Notice>
      ) : null}
      <RequestActions
        request={request}
        payoutsNotice={payoutsDeadline !== null}
      />
    </div>
  );
}
