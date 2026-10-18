import type { ReactNode } from "react";
import { getSessionRefreshAt } from "@/server/auth/session";
import { SHELL_MAIN } from "./gutter";
import { SessionRefresh } from "./session-refresh";

/**
 * The signed-in frame for /onboarding, /dashboard/** and /admin (04 §9.30): `nav`, one <main> on canvas-alt (`data-app`,
 * 04 §3), `after` (the TabBar), and SessionRefresh, which keeps the 7-day sign-in alive.
 */
export async function AppShell({
  nav,
  after,
  children,
}: {
  nav: ReactNode;
  after?: ReactNode;
  children: ReactNode;
}) {
  const refreshAt = await getSessionRefreshAt();
  return (
    <>
      {nav}
      <main data-app className={SHELL_MAIN}>
        {children}
      </main>
      {after}
      <SessionRefresh refreshAt={refreshAt} />
    </>
  );
}
