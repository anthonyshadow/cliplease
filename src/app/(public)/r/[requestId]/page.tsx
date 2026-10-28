import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { MessageBody } from "@/components/layout/public-shell";
import { Button } from "@/components/ui/button";
import type { LicenseRequestStatus } from "@/lib/domain/values";
import { REQUEST_STATUS_COPY } from "@/lib/licensing/request-status";
import { videoUrl } from "@/lib/urls";
import { getBuyerRequest } from "@/server/licensing/request-status";

const COPY = REQUEST_STATUS_COPY;

/** The link's query: the key (one value), and Stripe's cancel_url marker; anything else in `checkout` is ignored. */
const Query = z.object({
  t: z.string(),
  checkout: z.literal("canceled").optional().catch(undefined),
});

/** P16a's two views (01 §4.8): each one's title (also the tab's) and body. */
const VIEWS = {
  canceled: { title: COPY.canceledTitle, body: COPY.canceledBody },
  finishing: { title: COPY.finishingTitle, body: COPY.finishingBody },
} as const;

type View = keyof typeof VIEWS;

/**
 * The view a status shows (05 §4.3), the status first: `checkout=canceled` only means something while checkout is
 * pending, so a cancel URL replayed after paying shows where the request really is. null (a 404 for now) for the states
 * P16b and P17 draw.
 */
function viewOf(
  status: LicenseRequestStatus,
  checkout: "canceled" | undefined,
): View | null {
  switch (status) {
    case "checkout_pending":
      return checkout === "canceled" ? "canceled" : "finishing";
    case "abandoned":
      return "canceled";
    default:
      return null;
  }
}

const buyerRequest = cache(getBuyerRequest);

/** The page a buyer link opens, or null for the dead-link 404. Shared by the metadata and the page (one query). */
async function pageFor({ params, searchParams }: PageProps<"/r/[requestId]">) {
  const query = Query.safeParse(await searchParams);
  if (!query.success) return null;
  const request = await buyerRequest((await params).requestId, query.data.t);
  const view = request && viewOf(request.status, query.data.checkout);
  return request && view ? { ...request, view } : null;
}

/**
 * No referrer and no index on every answer (05 §4.3; 02 §9.5): a client navigation here (Cancel's redirect) never gets
 * next.config's headers. The title names the state (owner answer Q-121 a); a dead link gets none, so it reads
 * "ClipLease" whatever the reason.
 */
const PRIVATE: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export async function generateMetadata(
  props: PageProps<"/r/[requestId]">,
): Promise<Metadata> {
  const page = await pageFor(props);
  return page ? { ...PRIVATE, title: VIEWS[page.view].title } : PRIVATE;
}

/**
 * S03, the buyer's request status (01 §4.8; 05 §4.3): for P16a, checkout not completed and finishing checkout. No
 * loading.tsx: a streamed route answers 200, and a dead link must be a real 404 (owner answer Q-110 a).
 */
export default async function RequestStatusPage(
  props: PageProps<"/r/[requestId]">,
) {
  const page = await pageFor(props);
  if (!page) notFound();
  const { title, body } = VIEWS[page.view];
  return (
    <MessageBody title={title}>
      <p className="text-body text-ink-2">{body}</p>
      {page.view === "canceled" ? (
        <Button asChild variant="secondary">
          <Link href={videoUrl(page.handle, page.slug)}>
            {COPY.backToLicense}
          </Link>
        </Button>
      ) : null}
    </MessageBody>
  );
}
