"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import {
  CREATOR_NAV,
  type CreatorNavKey,
  currentNavKey,
  NAV_BAR_KEYS,
  SHELL_PREFETCH,
} from "./creator-nav";
import { SHELL_GUTTER } from "./gutter";
import { Wordmark } from "./wordmark";

/** The `awaiting` caption count on Inbox (04 §9.30). */
export function CountPill({ count }: { count: number }) {
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-transparent bg-awaiting-tint px-1.5 text-caption text-awaiting-text tabular-nums">
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
      /** The account Menu's last item; P04 wires a MenuItem that signs out. */
      signOut?: ReactNode;
    };

function Bar({ children }: { children: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 h-(--nav-h) border-b border-hairline frosted">
      <div
        className={cn(
          "mx-auto flex h-full max-w-app items-center justify-between gap-4",
          SHELL_GUTTER,
        )}
      >
        {children}
      </div>
    </header>
  );
}

function CreatorLinks({
  current,
  inboxCount,
}: {
  current?: CreatorNavKey;
  inboxCount?: number;
}) {
  return (
    <nav className="hidden lg:block">
      <ul className="flex items-center gap-6">
        {NAV_BAR_KEYS.map((key) => {
          const isCurrent = key === current;
          return (
            <li key={key}>
              <Link
                href={CREATOR_NAV[key].href}
                prefetch={SHELL_PREFETCH}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "inline-flex h-11 items-center gap-1.5 text-callout",
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

/** 04 §9.30: sticky frosted bar in three variants. */
export function NavBar(props: NavBarProps) {
  const pathname = usePathname();
  if (props.variant === "public") {
    return (
      <Bar>
        <Wordmark />
        {props.right}
      </Bar>
    );
  }
  if (props.variant === "admin") {
    return (
      <>
        <Bar>
          <div className="flex items-center gap-3">
            <Wordmark href="/admin" prefetch={SHELL_PREFETCH} />
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
      <Wordmark href={CREATOR_NAV.inbox.href} prefetch={SHELL_PREFETCH} />
      <CreatorLinks current={current} inboxCount={props.inboxCount} />
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
          <MenuItem asChild>
            <Link href={CREATOR_NAV.settings.href} prefetch={SHELL_PREFETCH}>
              {CREATOR_NAV.settings.label}
            </Link>
          </MenuItem>
          {props.signOut}
        </MenuContent>
      </Menu>
    </Bar>
  );
}
