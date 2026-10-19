import type { Metadata } from "next";
import { CONNECT_PAGE_LINE } from "@/components/connections/connect-messages";
import { ConnectSection } from "@/components/connections/connect-section";
import { requireCreator, toActor } from "@/server/auth/session";
import { listAccountSummaries } from "@/server/library/queries";
import { enabledPlatforms } from "@/server/social/registry";

export const metadata: Metadata = { title: "Connections" };

/**
 * S13 (05 §6.2), the P06 frame: the page line, the linked accounts and a ConnectRow per enabled platform, in one
 * max-w-reading column left-aligned with the title at every tier (07 D145). A connect started here comes back here with
 * ?connected= or ?error= (07 D37). P08 designs the full screen (cards, Sync now, Reconnect, Disconnect).
 */
export default async function ConnectionsPage({
  searchParams,
}: PageProps<"/dashboard/connections">) {
  const ctx = await requireCreator("/dashboard/connections");
  const { error, connected } = await searchParams;
  return (
    <div className="flex w-full max-w-reading flex-col gap-6 py-6 lg:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-title-1 text-ink">
          Connections. <span className="text-ink-2">Link where you post.</span>
        </h1>
        <p className="text-callout text-ink-2">{CONNECT_PAGE_LINE}</p>
      </div>
      <ConnectSection
        platforms={enabledPlatforms()}
        accounts={await listAccountSummaries(toActor(ctx))}
        returnTo="/dashboard/connections"
        error={error}
        connected={connected}
      />
    </div>
  );
}
