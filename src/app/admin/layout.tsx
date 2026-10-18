import { AppShell } from "@/components/layout/app-shell";
import { NavBar } from "@/components/layout/nav-bar";
import { requireAdmin } from "@/server/auth/session";

// The admin shell (04 §9.30). It gates here, so a non-admin's 404 renders without the admin chrome; every admin page
// and its title gate again (layouts don't re-render on every navigation). P21 adds the tabs and tables.
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return <AppShell nav={<NavBar variant="admin" />}>{children}</AppShell>;
}
