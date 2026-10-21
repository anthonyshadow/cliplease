import { Plus } from "lucide-react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ToastOnMount } from "@/components/ui/toast";
import { PLATFORM_LABELS } from "@/lib/brand";
import type { SocialProviderId } from "@/lib/domain/values";
import { platformMarkFiles } from "@/server/brand-files";
import type { AccountSummaryDTO } from "@/server/library/queries";
import { SOCIAL_SYNC_MAX_POSTS } from "@/server/social/sync";
import {
  accountName,
  capNote,
  cardState,
  connectErrorBanner,
  connectedToastMessage,
  connectStartHref,
  platformLine,
  syncLine,
} from "./connect-messages";
import { ConnectRow } from "./connect-row";
import {
  type AccountCardView,
  ConnectedAccountCard,
} from "./connected-account-card";
import { CONNECTIONS_TITLE_ID } from "./connections-header";
import { StripConnectParams } from "./strip-connect-params";

/** Connections passes each account's live-video count for its Disconnect sheet; onboarding shows no actions. */
type Variant =
  | {
      variant: "connections";
      accounts: readonly (AccountSummaryDTO & { liveVideoCount: number })[];
    }
  | { variant: "onboarding"; accounts: readonly AccountSummaryDTO[] };

/**
 * The accounts and connect rows Connections (S13, 05 §6.2) and onboarding step 2 (05 §5.2) share: the ?error= Banner,
 * then per enabled platform its account cards (and "Connect another …" on Connections) or its ConnectRow, and the
 * ?connected= toast. Connections has exactly one primary: Reconnect when an account needs it, else the first unlinked
 * platform's Connect; onboarding has none (Continue is its primary) and shows compact cards.
 */
export function ConnectSection(
  props: Variant & {
    platforms: readonly SocialProviderId[];
    /** Where a connect comes back to: this page. */
    returnTo: string;
    error: string | string[] | undefined;
    connected: string | string[] | undefined;
  },
) {
  const { platforms, returnTo, error, connected } = props;
  const accounts: readonly (AccountSummaryDTO & { liveVideoCount?: number })[] =
    props.accounts;
  const banner = connectErrorBanner(error);
  const toast = connectedToastMessage(connected);
  const marks = platformMarkFiles();
  const onConnections = props.variant === "connections";
  const reconnectPrimary = onConnections
    ? accounts.find(
        (a) => a.status === "needs_reconnect" && platforms.includes(a.platform),
      )?.id
    : undefined;
  const connectPrimary =
    onConnections && reconnectPrimary === undefined
      ? platforms.find((p) => !accounts.some((a) => a.platform === p))
      : undefined;
  const now = new Date();
  const view = (
    a: AccountSummaryDTO & { liveVideoCount?: number },
  ): AccountCardView => ({
    id: a.id,
    platform: a.platform,
    name: accountName(a),
    avatarName: a.displayName ?? a.username ?? PLATFORM_LABELS[a.platform],
    avatarSrc: a.avatarSrc,
    platformLine: platformLine(a),
    hasMark: marks[a.platform],
    state: cardState(a),
    syncProblem: a.syncProblem,
    syncText: syncLine(a, now),
    capNote: a.hasOlder ? capNote(a.postCount, SOCIAL_SYNC_MAX_POSTS) : null,
    reconnectHref: connectStartHref(a.platform, returnTo),
    liveVideoCount: a.liveVideoCount ?? 0,
    focusAfterRemove: CONNECTIONS_TITLE_ID,
  });

  return (
    <div className="flex flex-col gap-4">
      {banner ? <Banner tone={banner.tone}>{banner.message}</Banner> : null}
      {platforms.map((platform) => {
        const own = accounts.filter((a) => a.platform === platform);
        if (own.length === 0) {
          return (
            <ConnectRow
              key={platform}
              platform={platform}
              returnTo={returnTo}
              primary={platform === connectPrimary}
              hasMark={marks[platform]}
            />
          );
        }
        return (
          <div key={platform} className="flex flex-col gap-4">
            {own.map((account) => (
              <ConnectedAccountCard
                key={account.id}
                account={view(account)}
                compact={!onConnections}
                primary={account.id === reconnectPrimary}
              />
            ))}
            {onConnections ? (
              <Button
                asChild
                variant="tertiary"
                size="sm"
                wrap
                className="self-start"
              >
                {/* A full navigation to the start route, never prefetched (07 D41: switch=1 lets the creator pick another account). */}
                <a
                  href={connectStartHref(platform, returnTo, { switch: true })}
                >
                  <Plus aria-hidden size={16} className="shrink-0" />
                  Connect another {PLATFORM_LABELS[platform]} account
                </a>
              </Button>
            ) : null}
          </div>
        );
      })}
      {toast ? <ToastOnMount message={toast} /> : null}
      <StripConnectParams />
    </div>
  );
}
