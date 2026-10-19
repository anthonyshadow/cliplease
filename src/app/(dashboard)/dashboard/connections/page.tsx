import type { Metadata } from "next";
import { connectErrorCode } from "@/components/connections/connect-messages";
import { ConnectSection } from "@/components/connections/connect-section";
import { ConnectionsHeader } from "@/components/connections/connections-header";
import { IgPersonalExplainer } from "@/components/connections/ig-personal-explainer";
import { SETTINGS_COLUMN } from "@/components/layout/gutter";
import { requireCreator, toActor } from "@/server/auth/session";
import {
  countLiveVideosByAccount,
  listAccountSummaries,
} from "@/server/library/queries";
import { enabledPlatforms } from "@/server/social/registry";

export const metadata: Metadata = { title: "Connections" };

// Sync now and Disconnect call the platform from this page's Server Actions (02 §6.1; Next sets an action's limit on
// its page).
export const maxDuration = 60;

/**
 * S13 (05 §6.2): the page line, then per enabled platform its ConnectedAccountCards (with "Connect another …") or its
 * ConnectRow, in one max-w-reading column left-aligned with the title at every tier (07 D145). ?error=ig_personal
 * shows the one-screen explainer instead. A connect started here comes back here with ?connected= or ?error= (07 D37).
 * Nothing syncs on render (07 D13).
 */
export default async function ConnectionsPage({
  searchParams,
}: PageProps<"/dashboard/connections">) {
  const ctx = await requireCreator("/dashboard/connections");
  const { error, connected } = await searchParams;
  if (connectErrorCode(error) === "ig_personal") return <IgPersonalExplainer />;
  const actor = toActor(ctx);
  const [accounts, liveVideos] = await Promise.all([
    listAccountSummaries(actor),
    countLiveVideosByAccount(actor),
  ]);
  return (
    <div className={SETTINGS_COLUMN}>
      <ConnectionsHeader />
      <ConnectSection
        variant="connections"
        platforms={enabledPlatforms()}
        accounts={accounts.map((a) => ({
          ...a,
          liveVideoCount: liveVideos.get(a.id) ?? 0,
        }))}
        returnTo="/dashboard/connections"
        error={error}
        connected={connected}
      />
    </div>
  );
}
