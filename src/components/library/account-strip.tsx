import { Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { accountName } from "@/components/connections/connect-messages";
import { PlatformBadge } from "@/components/platform/platform-badge";
import { Avatar } from "@/components/ui/avatar";
import { PLATFORM_LABELS } from "@/lib/brand";
import type {
  SocialAccountStatus,
  SocialProviderId,
} from "@/lib/domain/values";
import { cn } from "@/lib/utils";

// Stacked (avatar over name over platform) below lg, inline from lg, as 05 §6.1 draws the strip.
const ITEM =
  "flex min-h-11 min-w-11 shrink-0 flex-col items-center gap-1 rounded-md text-center lg:flex-row lg:gap-2 lg:text-left";
const NAME = "max-w-24 truncate text-footnote text-ink lg:max-w-48";

/**
 * The account strip (05 §6.1 callout 3, 07 D07): one link per linked account that filters the Library to it (tapping
 * the selected one shows every account again), a △ with "needs reconnect" for an account that must reconnect, and
 * "Add" to Connections (owner answer Q-28). One row that scrolls inside itself when it overflows (07 D146); the 4 px
 * block padding keeps the focus rings and the 44 px targets inside the scroller.
 */
type StripAccount = {
  id: string;
  platform: SocialProviderId;
  username: string | null;
  displayName: string | null;
  avatarSrc: string | null;
  status: SocialAccountStatus;
};

export function AccountStrip({
  accounts,
  selectedId,
  hrefFor,
}: {
  accounts: readonly StripAccount[];
  selectedId: string | undefined;
  /** The Library URL that selects this account, or clears the selection. */
  hrefFor: (account: StripAccount) => string;
}) {
  return (
    <ul className="scrollbar-none -mx-1 flex gap-4 overflow-x-auto px-1 py-1 lg:gap-6">
      {accounts.map((a) => {
        const name = accountName(a);
        const selected = a.id === selectedId;
        return (
          <li key={a.id} className="flex">
            <Link
              href={hrefFor(a)}
              aria-current={selected ? "page" : undefined}
              className={ITEM}
            >
              <span
                aria-hidden
                className={cn(
                  "rounded-full",
                  selected &&
                    "ring-2 ring-ink ring-offset-2 ring-offset-canvas-alt",
                )}
              >
                <Avatar
                  name={
                    a.displayName ?? a.username ?? PLATFORM_LABELS[a.platform]
                  }
                  src={a.avatarSrc}
                />
              </span>
              <span className="flex flex-col items-center lg:flex-row lg:gap-1">
                <span className={NAME}>{name}</span>
                <span className="text-footnote text-ink-2">
                  <span className="hidden lg:inline">· </span>
                  <PlatformBadge platform={a.platform} />
                </span>
                {a.status === "needs_reconnect" ? (
                  <span className="flex items-center text-awaiting-text">
                    <TriangleAlert aria-hidden size={16} />
                    <span className="sr-only">needs reconnect</span>
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
      <li className="flex">
        <Link
          href="/dashboard/connections"
          aria-label="Add an account"
          className={ITEM}
        >
          <span
            aria-hidden
            className="flex size-10 items-center justify-center rounded-full border border-hairline-strong text-ink"
          >
            <Plus size={16} />
          </span>
          <span className="text-footnote text-ink">Add</span>
        </Link>
      </li>
    </ul>
  );
}
