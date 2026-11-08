import { READING_COLUMN, SHELL_MAIN } from "@/components/layout/gutter";
import { NavBar } from "@/components/layout/nav-bar";
import { PublicNavBar } from "@/components/layout/public-shell";
import { SessionRefresh } from "@/components/layout/session-refresh";
import { SignOutMenuItem } from "@/components/layout/sign-out";
import {
  getCreatorContext,
  getSessionRefreshAt,
  getSessionUser,
} from "@/server/auth/session";

/**
 * My licenses' chrome (04 §9.30's buyer NavBar; 05 §1.3, S30, S31). UX only: every page gates with requireUser, so a
 * signed-out visitor sees the wordmark alone until the page redirects. Buyer pages sit on `canvas` (no `data-app`, unlike
 * AppShell); <main> keeps the safe-area gutter and the page sits in the one centered 640 px column this layout gives
 * it, so pages add no column of their own. SessionRefresh keeps the 7-day sign-in alive here too (owner answer, P04).
 * No Suspense: a streamed response would turn the pages' 404s and redirects into a 200.
 */
export default async function BuyerLayout({ children }: LayoutProps<"/">) {
  const user = await getSessionUser();
  const [ctx, refreshAt] = user
    ? await Promise.all([getCreatorContext(user), getSessionRefreshAt()])
    : [null, null];
  return (
    <>
      {user ? (
        <NavBar
          variant="buyer"
          hasCreatorProfile={ctx !== null}
          user={{ name: user.name || user.email }}
          signOut={<SignOutMenuItem />}
        />
      ) : (
        <PublicNavBar />
      )}
      <main className={SHELL_MAIN}>
        <div className={READING_COLUMN}>{children}</div>
      </main>
      {user ? <SessionRefresh refreshAt={refreshAt} /> : null}
    </>
  );
}
