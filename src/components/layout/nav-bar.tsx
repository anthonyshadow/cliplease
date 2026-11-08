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

/** Whose avatar the account Menu shows: the caller passes `name || email`, so a code sign-up gets the email's initial. */
type AccountUser = { name: string; image?: string | null };

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
      user: AccountUser;
      /**
       * A signed-in user with no creator profile yet (/onboarding): no links, and the Menu holds My licenses and Sign out
       * only, since every creator page would send them back (04 §9.30).
       */
      withoutProfile?: boolean;
      /** The account Menu's last item: SignOutMenuItem (sign-out.tsx). */
      signOut?: ReactNode;
    }
  | {
      /**
       * A signed-in visitor on My licenses (/licenses, /licenses/[licenseId]; 04 §9.30, 05 §1.3): the same bar at every
       * tier, with no TabBar or MoreSheet (07 D147).
       */
      variant: "buyer";
      /** The wordmark goes to /dashboard for a creator who also buys, else to /licenses. */
      hasCreatorProfile: boolean;
      user: AccountUser;
      /** The account Menu's last item: SignOutMenuItem (sign-out.tsx). */
      signOut?: ReactNode;
    };

/** A NavBar link, current or not (04 §9.30): `font-semibold text-ink` with a 2 px ink underline when current. */
function navLinkClass(isCurrent: boolean) {
  return cn(
    // hit-44: a short label ("Inbox") is under 44 px wide (07 D152); the hit area grows, nothing shows.
    "hit-44 inline-flex h-11 items-center gap-1.5 text-callout",
    isCurrent
      ? "font-semibold text-ink underline decoration-2 underline-offset-6"
      : "text-ink-2",
  );
}

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
                aria-current={isCurrent ? "page" : undefined}
                className={navLinkClass(isCurrent)}
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

function MenuLink({ to }: { to: CreatorNavKey }) {
  return (
    <MenuItem asChild>
      <Link href={CREATOR_NAV[to].href}>{CREATOR_NAV[to].label}</Link>
    </MenuItem>
  );
}

/** The 28 px Avatar in a 44 px trigger → Menu: My licenses, Settings when `settings`, then `signOut` (04 §9.30). */
function AccountMenu({
  user,
  settings,
  signOut,
}: {
  user: AccountUser;
  settings: boolean;
  signOut?: ReactNode;
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label="Account menu"
        className="flex size-11 shrink-0 items-center justify-center rounded-full"
      >
        <Avatar name={user.name} src={user.image} className="size-7" />
      </MenuTrigger>
      <MenuContent>
        <MenuLink to="myLicenses" />
        {settings ? <MenuLink to="settings" /> : null}
        {signOut}
      </MenuContent>
    </Menu>
  );
}

/**
 * 04 §9.30: sticky frosted bar in four variants. Public pages render `PublicNavBar` from `public-shell.tsx`
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
  if (props.variant === "buyer") {
    // Current on /licenses and on each /licenses/[licenseId]. The link sits beside the wordmark, not mid-bar: Bar
    // spreads its children apart (05 §1.3).
    const isCurrent = currentNavKey(pathname) === "myLicenses";
    return (
      <Bar>
        <div className="flex items-center gap-6">
          <Wordmark
            href={
              props.hasCreatorProfile
                ? CREATOR_NAV.inbox.href
                : CREATOR_NAV.myLicenses.href
            }
          />
          <nav aria-label="Main">
            <Link
              href={CREATOR_NAV.myLicenses.href}
              aria-current={isCurrent ? "page" : undefined}
              className={navLinkClass(isCurrent)}
            >
              {CREATOR_NAV.myLicenses.label}
            </Link>
          </nav>
        </div>
        <AccountMenu
          user={props.user}
          settings={false}
          signOut={props.signOut}
        />
      </Bar>
    );
  }
  return (
    <Bar>
      <Wordmark href={CREATOR_NAV.inbox.href} />
      {props.withoutProfile ? null : (
        <CreatorLinks
          current={props.current ?? currentNavKey(pathname)}
          inboxCount={props.inboxCount}
        />
      )}
      <AccountMenu
        user={props.user}
        settings={!props.withoutProfile}
        signOut={props.signOut}
      />
    </Bar>
  );
}
