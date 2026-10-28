import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SHELL_GUTTER, SHELL_MAIN } from "./gutter";
import { Wordmark } from "./wordmark";

// A plain module (no "use client"): public pages, the 404 and the error view render this frame without loading the
// creator NavBar's menu code.

/** The sticky frosted bar every NavBar variant shares (04 §9.30). */
export function Bar({ children }: { children: ReactNode }) {
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

/** The public NavBar: the wordmark, plus `right` (the landing page's LandingSignInLink). */
export function PublicNavBar({ right }: { right?: ReactNode }) {
  return (
    <Bar>
      <Wordmark />
      {right}
    </Bar>
  );
}

/** Public chrome: the public NavBar and one <main> (05 §1.3). */
export function PublicShell({
  right,
  children,
}: {
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PublicNavBar right={right} />
      <main className={SHELL_MAIN}>{children}</main>
    </>
  );
}

/**
 * A one-message page body: the 404 and the error views (05 §10), and /r's states. `children` follow the title; `icon`
 * (decorative, aria-hidden) leads it, so the heading's name stays the title. A long word (a handle) wraps.
 */
export function MessageBody({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-reading flex-col items-start gap-4 py-6 lg:py-12">
      <h1 className="text-title-1 text-ink wrap-anywhere">
        {icon ? (
          <span aria-hidden className="mr-2 inline-flex align-middle">
            {icon}
          </span>
        ) : null}
        {title}
      </h1>
      {children}
    </div>
  );
}
