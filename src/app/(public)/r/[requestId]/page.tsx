import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { AutoRefresh } from "@/components/layout/auto-refresh";
import { RequestStatusView } from "@/components/license/request-status-view";
import { RequestSummary } from "@/components/license/request-summary";
import { Button } from "@/components/ui/button";
import { CountdownChip, StatusPill } from "@/components/ui/status-pill";
import { formatMoney } from "@/lib/format";
import {
  REQUEST_STATUS_COPY,
  requestView,
  VIEW_COPY,
  viewTitle,
} from "@/lib/licensing/request-status";
import { videoUrl } from "@/lib/urls";
import { getBuyerRequest } from "@/server/licensing/request-status";

const COPY = REQUEST_STATUS_COPY;

/**
 * The link's query: the key (one value), Stripe's cancel_url marker and its success_url's session id. A repeated or
 * unexpected `checkout` or `session_id` is ignored rather than killing the link.
 */
const Query = z.object({
  t: z.string(),
  checkout: z.literal("canceled").optional().catch(undefined),
  session_id: z.string().optional().catch(undefined),
});

/** One read per request, shared by the metadata and the page: the return's check from Stripe runs once. */
const buyerRequest = cache(getBuyerRequest);

/** The page a buyer link opens, or null for the dead-link 404. */
async function pageFor({ params, searchParams }: PageProps<"/r/[requestId]">) {
  const query = Query.safeParse(await searchParams);
  if (!query.success) return null;
  const { t, checkout, session_id: sessionId } = query.data;
  const request = await buyerRequest((await params).requestId, t, sessionId);
  const view =
    request &&
    requestView(request, {
      canceled: checkout === "canceled",
      returning: sessionId !== undefined,
    });
  return request && view ? { request, view } : null;
}

/**
 * No referrer and no index on every answer (05 §4.3; 02 §9.5): a client navigation here (the fake checkout's redirects)
 * never gets next.config's headers. The title names the state (owner answer Q-121 a); a dead link gets none, so it
 * reads "ClipLease" whatever the reason.
 */
const PRIVATE: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export async function generateMetadata(
  props: PageProps<"/r/[requestId]">,
): Promise<Metadata> {
  const page = await pageFor(props);
  return page
    ? { ...PRIVATE, title: viewTitle(page.view, page.request.handle) }
    : PRIVATE;
}

/**
 * S03, the buyer's request status (01 §4.8, J7.17; 05 §4.3; 04 §11.3): every state's words, its stored status only (07
 * D25), and the summary card. While the request waits, a neutral countdown (or "Processing…" while a capture or decline
 * is claimed, 07 D26), and the page refreshes on focus and every 30 s. No loading.tsx: a streamed route answers 200, and
 * a dead link must be a real 404 (owner answer Q-110 a). The Get file and license button comes with /l in P20.
 */
export default async function RequestStatusPage(
  props: PageProps<"/r/[requestId]">,
) {
  const page = await pageFor(props);
  if (!page) notFound();
  const { request, view } = page;
  const waiting = view === "waiting";
  return (
    <RequestStatusView
      view={view}
      handle={request.handle}
      total={formatMoney(request.amountTotalCents, request.currency)}
      expiresAt={request.expiresAt}
    >
      {waiting ? (
        <>
          <AutoRefresh />
          {request.displayStatus === "processing" ? (
            <StatusPill>{COPY.processing}</StatusPill>
          ) : request.expiresAt ? (
            <CountdownChip expiresAt={request.expiresAt} tone="neutral" />
          ) : null}
          <p className="text-footnote text-ink-2">{COPY.updatesItself}</p>
        </>
      ) : null}
      <RequestSummary request={request} />
      {VIEW_COPY[view].backLink ? (
        <Button asChild variant="secondary">
          <Link href={videoUrl(request.handle, request.slug)}>
            {COPY.backToLicense}
          </Link>
        </Button>
      ) : null}
    </RequestStatusView>
  );
}
