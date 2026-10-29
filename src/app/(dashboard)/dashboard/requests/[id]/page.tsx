import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PayoutsWaiting } from "@/components/inbox/payouts-waiting";
import { RequestFacts } from "@/components/inbox/request-facts";
import {
  RequestOutcome,
  RequestStatus,
} from "@/components/inbox/request-status-line";
import { SETTINGS_COLUMN } from "@/components/layout/gutter";
import { PosterThumb } from "@/components/license/poster-thumb";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { BackLink } from "@/components/videos/back-link";
import { INBOX_COPY } from "@/lib/licensing/inbox";
import { requestDetailPath } from "@/lib/urls";
import { isUuid } from "@/lib/validation/uuid";
import { requireCreator } from "@/server/auth/session";
import { getRequestForCreator } from "@/server/licensing/queries";

/** The tab names the Inbox the page belongs to (owner answer Q-126 a). */
export const metadata: Metadata = { title: INBOX_COPY.inbox };

/**
 * S15, one request on its own page (05 §6.4; 04 §9.11): the request-new email's link and the Inbox's "Open request". The
 * heading, the countdown or the pill (with a decided request's line), then the facts card, in one max-w-reading column
 * left-aligned with the title at every tier (07 D145). While payouts aren't active a waiting request says it stays open
 * until its deadline (07 D77). Another creator's request, an unknown id, and a request the creator never sees (in
 * checkout, abandoned, a renewal) are a 404. The action row under the card comes with P18 (Approve) and P19 (Decline).
 */
export default async function RequestDetailPage({
  params,
}: PageProps<"/dashboard/requests/[id]">) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { creator } = await requireCreator(requestDetailPath(id));
  const request = await getRequestForCreator(creator.id, id);
  if (!request) notFound();
  // A waiting request's deadline while payouts aren't active (07 D77).
  const payoutsDeadline =
    request.status === "awaiting_approval" && creator.payoutsStatus !== "active"
      ? request.expiresAt
      : null;
  return (
    <div className={SETTINGS_COLUMN}>
      <BackLink href="/dashboard">{INBOX_COPY.inbox}</BackLink>
      <div className="flex flex-col items-start gap-3">
        <h1 className="text-title-2 text-ink wrap-anywhere">
          {INBOX_COPY.detailHeading(request.licenseeName, request.title)}
        </h1>
        <RequestStatus request={request} />
        <RequestOutcome request={request} />
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
        <Notice
          action={
            <Button asChild variant="link">
              <Link href="/dashboard/settings#payouts">
                {INBOX_COPY.setUpPayouts}
              </Link>
            </Button>
          }
        >
          <PayoutsWaiting expiresAt={payoutsDeadline} />
        </Notice>
      ) : null}
    </div>
  );
}
