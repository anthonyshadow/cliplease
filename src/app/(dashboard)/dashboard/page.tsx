import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";
import { requireCreator } from "@/server/auth/session";

export const metadata: Metadata = { title: "Inbox" };

// The Inbox placeholder (04 §11.5) until P15 builds the Inbox.
export default async function InboxPage() {
  await requireCreator("/dashboard");
  return (
    <EmptyState
      as="h1"
      title={
        <>
          Inbox. <span className="text-ink-2">All caught up.</span>
        </>
      }
      description="No requests yet. Share a link to get your first one."
    />
  );
}
