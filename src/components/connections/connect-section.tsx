import type { ReactNode } from "react";
import { Banner } from "@/components/ui/banner";
import { ToastOnMount } from "@/components/ui/toast";
import type { SocialProviderId } from "@/lib/domain/values";
import {
  accountLine,
  connectErrorBanner,
  connectedToastMessage,
  syncLine,
} from "./connect-messages";
import { ConnectRow } from "./connect-row";

type Account = Parameters<typeof accountLine>[0] &
  Parameters<typeof syncLine>[0] & { id: string };

/**
 * The connect block shared by onboarding step 2 and Connections (05 §5.2, §6.2): the ?error= Banner, per linked account
 * its line, its sync status and any `accountAction`, a ConnectRow per enabled platform, and the ?connected= toast. P08
 * replaces the account lines with ConnectedAccountCards.
 */
export function ConnectSection({
  platforms,
  accounts,
  returnTo,
  error,
  connected,
  accountAction,
}: {
  platforms: readonly SocialProviderId[];
  accounts: readonly Account[];
  /** Where the connect comes back to: this page. */
  returnTo: string;
  error: string | string[] | undefined;
  connected: string | string[] | undefined;
  /** A control under the account (Connections: Sync now); `lineId` names the account line it acts on. */
  accountAction?: (account: Account, lineId: string) => ReactNode;
}) {
  const banner = connectErrorBanner(error);
  const toast = connectedToastMessage(connected);
  const now = new Date();
  return (
    <div className="flex flex-col gap-4">
      {banner ? <Banner tone={banner.tone}>{banner.message}</Banner> : null}
      {accounts.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {accounts.map((account) => {
            const lineId = `account-${account.id}`;
            const status = syncLine(account, now);
            return (
              <li key={account.id} className="flex flex-col items-start gap-1">
                <span id={lineId} className="text-body text-ink">
                  {accountLine(account)}
                </span>
                {status ? (
                  <span className="text-footnote text-ink-2 tabular-nums">
                    {status}
                  </span>
                ) : null}
                {accountAction?.(account, lineId)}
              </li>
            );
          })}
        </ul>
      ) : null}
      {platforms.map((platform) => (
        <ConnectRow key={platform} platform={platform} returnTo={returnTo} />
      ))}
      {toast ? <ToastOnMount message={toast} /> : null}
    </div>
  );
}
