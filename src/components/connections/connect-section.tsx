import { Banner } from "@/components/ui/banner";
import { ToastOnMount } from "@/components/ui/toast";
import type { SocialProviderId } from "@/lib/domain/values";
import {
  accountLine,
  connectErrorBanner,
  connectedToastMessage,
} from "./connect-messages";
import { ConnectRow } from "./connect-row";

type Account = Parameters<typeof accountLine>[0] & { id: string };

/**
 * The connect block shared by onboarding step 2 and Connections (05 §5.2, §6.2): the ?error= Banner, one line per linked
 * account, a ConnectRow per enabled platform, and the ?connected= toast. P08 replaces the account lines with
 * ConnectedAccountCards.
 */
export function ConnectSection({
  platforms,
  accounts,
  returnTo,
  error,
  connected,
}: {
  platforms: readonly SocialProviderId[];
  accounts: readonly Account[];
  /** Where the connect comes back to: this page. */
  returnTo: string;
  error: string | string[] | undefined;
  connected: string | string[] | undefined;
}) {
  const banner = connectErrorBanner(error);
  const toast = connectedToastMessage(connected);
  return (
    <div className="flex flex-col gap-4">
      {banner ? <Banner tone={banner.tone}>{banner.message}</Banner> : null}
      {accounts.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {accounts.map((account) => (
            <li key={account.id} className="text-body text-ink">
              {accountLine(account)}
            </li>
          ))}
        </ul>
      ) : null}
      {platforms.map((platform) => (
        <ConnectRow key={platform} platform={platform} returnTo={returnTo} />
      ))}
      {toast ? <ToastOnMount message={toast} /> : null}
    </div>
  );
}
