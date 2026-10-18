import type { Metadata } from "next";
import { FinishPayoutsBanner } from "@/components/layout/finish-payouts-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { requireCreator } from "@/server/auth/session";

export const metadata: Metadata = { title: "Inbox" };

// The Inbox placeholder (04 §11.5) until P17 builds the Inbox; the payouts Banner fills the max-w-app column (07 D145).
export default async function InboxPage() {
  const { creator } = await requireCreator("/dashboard");
  return (
    <>
      <FinishPayoutsBanner
        payoutsStatus={creator.payoutsStatus}
        className="mt-6 lg:mt-12"
      />
      <EmptyState
        as="h1"
        title={
          <>
            Inbox. <span className="text-ink-2">All caught up.</span>
          </>
        }
        description="No requests yet. Share a link to get your first one."
      />
    </>
  );
}
