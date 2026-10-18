"use client";

import {
  Ellipsis,
  Film,
  Inbox,
  LayoutGrid,
  LinkIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  CREATOR_NAV,
  type CreatorNavKey,
  currentNavKey,
  MORE_SHEET_KEYS,
  SHELL_PREFETCH,
} from "./creator-nav";
import { MoreSheet } from "./more-sheet";
import { CountPill } from "./nav-bar";

const TABS: readonly { key: CreatorNavKey; icon: LucideIcon }[] = [
  { key: "inbox", icon: Inbox },
  { key: "library", icon: LayoutGrid },
  { key: "videos", icon: Film },
  { key: "connections", icon: LinkIcon },
];

// 56 px (--tabbar-h) plus the safe area, border and safe-area-bar padding included, so the bar is exactly the space
// the root scroll padding, the toast offset and the body padding reserve for it (04 §5.3, §9.30).
const BAR_HEIGHT = "h-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))]";
const TAB =
  "relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-caption";

// The current tab is marked by a 2 px ink bar as well as its color, so meaning never rests on color alone
// (04 §12.1; the same 2 px ink cue as the NavBar's current link). Forced colors paint it in CanvasText.
function CurrentBar() {
  return (
    <span
      aria-hidden
      className="absolute top-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-ink forced-colors:bg-[CanvasText]"
    />
  );
}

/**
 * The root's scroll-padding-bottom (globals.css) keeps focus clear of the bar, but WebKit's focus scrolling can
 * still leave a field a few px under it. After each focus move, if the bar covers the focused element's bottom
 * edge, scroll it clear (WCAG 2.2 SC 2.4.11). A sheet above the bar, or the bar hidden at lg, covers nothing.
 */
function useKeepFocusAboveBar(bar: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        const covering = document.elementFromPoint(
          rect.left + rect.width / 2,
          Math.min(rect.bottom, window.innerHeight) - 1,
        );
        const node = bar.current;
        if (
          node &&
          covering &&
          node.contains(covering) &&
          !node.contains(target)
        ) {
          target.scrollIntoView({ block: "nearest" });
        }
      });
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [bar]);
}

/**
 * 04 §9.30: the creator's bottom bar below lg. `data-tabbar` sets the toast offset and scroll padding, and the root
 * layout's <body> reserves the bar's height below the page while one is mounted.
 */
export function TabBar({
  current,
  inboxCount,
  signOut,
}: {
  /** Defaults to the route of the current pathname; "more" for Licenses, Pricing and Settings. */
  current?: CreatorNavKey;
  inboxCount?: number;
  signOut?: ReactNode;
}) {
  const pathname = usePathname();
  const barRef = useRef<HTMLElement>(null);
  useKeepFocusAboveBar(barRef);
  const active = current ?? currentNavKey(pathname);
  const moreActive = MORE_SHEET_KEYS.some((key) => key === active);
  return (
    <nav
      ref={barRef}
      data-tabbar
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-hairline frosted safe-area-bar lg:hidden",
        BAR_HEIGHT,
      )}
    >
      <ul className="mx-auto flex h-full max-w-app pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] md:max-w-reading">
        {TABS.map(({ key, icon: Icon }) => {
          const isCurrent = key === active;
          return (
            <li key={key} className="flex flex-1">
              <Link
                href={CREATOR_NAV[key].href}
                prefetch={SHELL_PREFETCH}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(TAB, isCurrent ? "text-ink" : "text-ink-2")}
              >
                {isCurrent ? <CurrentBar /> : null}
                <span className="relative">
                  <Icon aria-hidden size={24} strokeWidth={1.5} />
                  {key === "inbox" && inboxCount ? (
                    <span className="absolute -top-1.5 left-4">
                      <CountPill count={inboxCount} />
                    </span>
                  ) : null}
                </span>
                {CREATOR_NAV[key].label}
              </Link>
            </li>
          );
        })}
        <li className="flex flex-1">
          <MoreSheet
            signOut={signOut}
            trigger={
              <button
                type="button"
                className={cn(TAB, moreActive ? "text-ink" : "text-ink-2")}
              >
                {moreActive ? <CurrentBar /> : null}
                <Ellipsis aria-hidden size={24} strokeWidth={1.5} />
                More
              </button>
            }
          />
        </li>
      </ul>
    </nav>
  );
}
