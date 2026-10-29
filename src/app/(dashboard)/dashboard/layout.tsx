import { AppShell } from "@/components/layout/app-shell";
import { InboxCountProvider } from "@/components/layout/inbox-count";
import { NavBar } from "@/components/layout/nav-bar";
import { SignOutButton, SignOutMenuItem } from "@/components/layout/sign-out";
import { TabBar } from "@/components/layout/tab-bar";
import { UploadIndicator } from "@/components/videos/upload-indicator";
import { getCreatorForApi } from "@/server/auth/session";
import { waitingSummary } from "@/server/licensing/queries";

// The creator shell (04 §9.30): NavBar, one <main>, and the TabBar below lg. UX only (02 §4): it never redirects. Each
// page calls requireCreator(its own path), so a signed-out visitor comes back to that page, not to the Inbox; layouts
// also don't re-render on every navigation.
export default async function DashboardLayout({
  children,
}: LayoutProps<"/dashboard">) {
  const ctx = await getCreatorForApi();
  if (!ctx) return children;
  // The Inbox badge (05 §6.3 callout 1): read on a full load and on each refresh; the Inbox page keeps it current on a
  // client navigation (SyncInboxCount).
  const { count } = await waitingSummary(ctx.creator.id);
  return (
    <InboxCountProvider count={count}>
      <AppShell
        nav={
          <NavBar
            variant="creator"
            user={{ name: ctx.creator.displayName || ctx.user.email }}
            signOut={<SignOutMenuItem />}
          />
        }
        after={
          <>
            <UploadIndicator />
            <TabBar signOut={<SignOutButton />} />
          </>
        }
      >
        {children}
      </AppShell>
    </InboxCountProvider>
  );
}
