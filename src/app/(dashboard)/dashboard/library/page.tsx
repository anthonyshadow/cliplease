import type { Metadata } from "next";
import { FinishPayoutsBanner } from "@/components/layout/finish-payouts-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { requireCreator } from "@/server/auth/session";

export const metadata: Metadata = { title: "Library" };

// The Library placeholder: a real route for onboarding's Skip and Continue until P09 builds the Library.
export default async function LibraryPage() {
  const { creator } = await requireCreator("/dashboard/library");
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
            Library. <span className="text-ink-2">Nothing here yet.</span>
          </>
        }
        description="Your videos from Instagram, TikTok and YouTube show up here."
      />
    </>
  );
}
