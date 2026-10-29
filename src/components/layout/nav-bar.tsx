"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { pillVariants } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";
import {
  CREATOR_NAV,
  type CreatorNavKey,
  currentNavKey,
  NAV_BAR_KEYS,
  shellPrefetch,
} from "./creator-nav";
import { SHELL_GUTTER } from "./gutter";
import { useInboxCount } from "./inbox-count";
import { Bar, PublicNavBar } from "./public-shell";
import { Wordmark } from "./wordmark";

/** The `awaiting` caption count on Inbox (04 §9.30): the awaiting pill, compact. */
export function CountPill({ count }: { count: number }) {
  return (
    <span
      className={cn(
        pillVariants({ tone: "awaiting" }),
        "h-5 min-w-5 justify-center px-1.5",
      )}
    >
      {count}
    </span>
  );
}

export type NavBarProps =
  | {
      variant: "public";
      /** The landing page passes LandingSignInLink. */
      right?: ReactNode;
    }
  | {
      variant: "admin";
      /** Rendered under the bar, not inside it: P21 puts the SegmentedControl tabs here. */
      below?: ReactNode;
    }
  | {
      variant: "creator";
      /** Defaults to the route of the current pathname. */
      current?: CreatorNavKey;
      inboxCount?: number;
      user: { name: string; image?: string | null };
      /**
       * A signed-in user with no creator profile yet (/onboarding): no links, and the Menu holds only Sign out, since
       * every creator page would send them back (04 §9.30; P20b adds My licenses).
       */
      withoutProfile?: boolean;
      /** The account Menu's last item: SignOutMenuItem (sign-out.tsx). */
      signOut?: ReactNode;
    };

function CreatorLinks({
  current,
  inboxCount: fallback,
}: {
  current?: CreatorNavKey;
  inboxCount?: number;
}) {
  const inboxCount = useInboxCount(fallback);
  return (
    <nav className="hidden lg:block">
      <ul className="flex items-center gap-6">
        {NAV_BAR_KEYS.map((key) => {
          const isCurrent = key === current;
          return (
            <li key={key}>
              <Link
                href={CREATOR_NAV[key].href}
                prefetch={shellPrefetch(key)}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  // hit-44: a short label ("Inbox") is under 44 px wide (07 D152); the hit area grows, nothing shows.
                  "hit-44 inline-flex h-11 items-center gap-1.5 text-callout",
                  isCurrent
                    ? "font-semibold text-ink underline decoration-2 underline-offset-6"
                    : "text-ink-2",
                )}
              >
                {CREATOR_NAV[key].label}
                {key === "inbox" && inboxCount ? (
                  <CountPill count={inboxCount} />
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * 04 §9.30: sticky frosted bar in three variants. Public pages render `PublicNavBar` from `public-shell.tsx`
 * directly, so they don't load this module's menu code.
 */
export function NavBar(props: NavBarProps) {
  const pathname = usePathname();
  if (props.variant === "public") return <PublicNavBar right={props.right} />;
  if (props.variant === "admin") {
    return (
      <>
        <Bar>
          <div className="flex items-center gap-3">
            <Wordmark href="/admin" />
            <span className="text-callout font-semibold text-ink-2">Admin</span>
          </div>
        </Bar>
        {props.below ? (
          <div className={cn("mx-auto max-w-app pt-4", SHELL_GUTTER)}>
            {props.below}
          </div>
        ) : null}
      </>
    );
  }
  const current = props.current ?? currentNavKey(pathname);
  return (
    <Bar>
      <Wordmark href={CREATOR_NAV.inbox.href} />
      {props.withoutProfile ? null : (
        <CreatorLinks current={current} inboxCount={props.inboxCount} />
      )}
      <Menu>
        <MenuTrigger
          aria-label="Account menu"
          className="flex size-11 shrink-0 items-center justify-center rounded-full"
        >
          <Avatar
            name={props.user.name}
            src={props.user.image}
            className="size-7"
          />
        </MenuTrigger>
        <MenuContent>
          {props.withoutProfile ? null : (
            <MenuItem asChild>
              <Link href={CREATOR_NAV.settings.href}>
                {CREATOR_NAV.settings.label}
              </Link>
            </MenuItem>
          )}
          {props.signOut}
        </MenuContent>
      </Menu>
    </Bar>
  );
}
