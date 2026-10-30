import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { InboxList } from "@/components/inbox/inbox-list";
import { FinishPayoutsBanner } from "@/components/layout/finish-payouts-banner";
import { WIDE_COLUMN } from "@/components/layout/gutter";
import { SyncInboxCount } from "@/components/layout/inbox-count";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/ui/copy-link-button";
import { EmptyState } from "@/components/ui/empty-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { INBOX_COPY } from "@/lib/licensing/inbox";
import { INBOX_VIEWS, type InboxView } from "@/lib/licensing/request-dto";
import { PUBLISHED_COPY } from "@/lib/videos/review";
import { requireCreator } from "@/server/auth/session";
import { listInbox, waitingSummary } from "@/server/licensing/queries";
import { latestLiveShareUrl } from "@/server/videos/public";

export const metadata: Metadata = { title: INBOX_COPY.inbox };

/** `?view=`: Waiting (the default, and anything unknown) or History. */
const Query = z.object({
  view: z.enum(INBOX_VIEWS).catch("waiting"),
});

/**
 * S14, the Inbox (05 §6.3; 04 §9.11, §11.5; 01 J8): the two-tone count, Waiting · History, the payouts Banner, then the
 * list card or the empty state, in the max-w-app column at every tier (07 D146, D149). Waiting is soonest deadline first;
 * History the 20 newest decided requests. The list refreshes on focus and every 30 s. Approve and Decline come in P18
 * and P19.
 */
export default async function InboxPage({
  searchParams,
}: PageProps<"/dashboard">) {
  const { creator } = await requireCreator("/dashboard");
  const { view } = Query.parse(await searchParams);
  const [{ count: waiting, soonestExpiresAt }, rows] = await Promise.all([
    waitingSummary(creator.id),
    listInbox(creator.id, view),
  ]);
  return (
    <div className={WIDE_COLUMN}>
      <SyncInboxCount count={waiting} />
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-title-1 text-ink">
          {INBOX_COPY.title}{" "}
          <span className="text-ink-2">
            {waiting > 0
              ? INBOX_COPY.waitingForYou(waiting)
              : INBOX_COPY.caughtUp}
          </span>
        </h1>
        <SegmentedControl
          label={INBOX_COPY.inbox}
          items={[
            {
              href: "/dashboard",
              label: INBOX_COPY.waitingSegment(waiting),
              current: view === "waiting",
            },
            {
              href: "/dashboard?view=history",
              label: INBOX_COPY.history,
              current: view === "history",
            },
          ]}
        />
      </div>
      <FinishPayoutsBanner
        payoutsStatus={creator.payoutsStatus}
        soonestExpiresAt={soonestExpiresAt}
      />
      <InboxList
        key={view}
        rows={rows}
        empty={rows.length === 0 ? await emptyState(view, creator) : null}
      />
    </div>
  );
}

/**
 * The empty list, under the page's own title: History has nothing decided yet (owner answer Q-127 a); Waiting asks for a
 * share, with Copy link for the latest live video a buyer can open, or the way to make one (05 §6.3 callout 13).
 */
async function emptyState(
  view: InboxView,
  creator: { id: string; handle: string },
) {
  if (view === "history") {
    return <EmptyState description={INBOX_COPY.historyEmpty} />;
  }
  const url = await latestLiveShareUrl(creator);
  return (
    <EmptyState
      description={INBOX_COPY.empty}
      actions={
        url ? (
          <CopyLinkButton url={url} label={PUBLISHED_COPY.shareLink} />
        ) : (
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard/library">{INBOX_COPY.makeLicensable}</Link>
          </Button>
        )
      }
    />
  );
}
