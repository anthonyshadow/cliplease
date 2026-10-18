import { AppShell } from "@/components/layout/app-shell";
import { NavBar } from "@/components/layout/nav-bar";
import { SignOutButton, SignOutMenuItem } from "@/components/layout/sign-out";
import { TabBar } from "@/components/layout/tab-bar";
import { getCreatorForApi } from "@/server/auth/session";

// The creator shell (04 §9.30): NavBar, one <main>, and the TabBar below lg. UX only (02 §4): it never redirects. Each
// page calls requireCreator(its own path), so a signed-out visitor comes back to that page, not to the Inbox; layouts
// also don't re-render on every navigation.
export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const ctx = await getCreatorForApi();
  if (!ctx) return children;
  return (
    <AppShell
      nav={
        <NavBar
          variant="creator"
          user={{ name: ctx.creator.displayName || ctx.user.email }}
          signOut={<SignOutMenuItem />}
        />
      }
      after={<TabBar signOut={<SignOutButton />} />}
    >
      {children}
    </AppShell>
  );
}
