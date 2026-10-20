import { ConnectLink } from "@/components/connections/connect-link";
import { connectStartHref } from "@/components/connections/connect-messages";
import { Banner } from "@/components/ui/banner";
import { LIBRARY_PATH } from "@/lib/library/filter";
import { LIBRARY_TITLE_ID, type SyncBannerView } from "./library-messages";
import { SyncButton } from "./sync-button";

/**
 * SyncBanner (04 §9.15): Reconnect (warning) comes back to the Library (07 D37); Couldn't reach (error) has Try again and
 * the quiet stale banner (info) Sync now. Each action is the Banner's text link (04 §9.21; owner answer Q-30); a sync
 * that clears its banner hands the focus to the h1.
 */
export function SyncBanner({ banner }: { banner: SyncBannerView }) {
  if (banner.kind === "reconnect") {
    return (
      <Banner
        tone="warning"
        action={
          <ConnectLink
            href={connectStartHref(banner.platform, LIBRARY_PATH)}
            label="Reconnect"
            variant="link"
          />
        }
      >
        {banner.message}
      </Banner>
    );
  }
  const problem = banner.kind === "problem";
  return (
    <Banner
      tone={problem ? "error" : "info"}
      action={
        <SyncButton
          {...banner.target}
          label={problem ? "Try again" : "Sync now"}
          variant="link"
          focusAfterRemove={LIBRARY_TITLE_ID}
        />
      }
    >
      {banner.message}
    </Banner>
  );
}
