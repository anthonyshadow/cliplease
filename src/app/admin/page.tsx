import type { Metadata } from "next";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ADMIN_COPY } from "@/lib/admin/copy";
import {
  ADMIN_TAB_LABELS,
  ADMIN_TABS,
  type AdminTab,
  adminTabHref,
  parseAdminTab,
} from "@/lib/admin/tabs";
import {
  listAdminConnections,
  listAdminCreators,
  listAdminEvents,
  listAdminLicenses,
  listAdminRequests,
  listAdminVideos,
} from "@/server/admin/queries";
import { type AdminActor, adminActor } from "@/server/auth/actor";
import { requireAdmin } from "@/server/auth/session";
import { AdminTable } from "./_components/admin-cells";
import { CONNECTION_COLUMNS } from "./_components/connections-table";
import { CREATOR_COLUMNS } from "./_components/creators-table";
import { EventsLists } from "./_components/events-lists";
import { LICENSE_COLUMNS } from "./_components/licenses-table";
import { REQUEST_COLUMNS } from "./_components/requests-table";
import { VIDEO_COLUMNS } from "./_components/videos-table";

// The title runs the gate too: metadata resolves apart from rendering, so a static title would name the 404 that
// everyone else gets "Admin". (A gate in the layout's generateMetadata instead leaves the 404 with no title.)
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Admin" };
}

/**
 * Disable's and Retry's Server Actions run with this page's limit: both call Stripe, Disable's sweep within a 45 s
 * budget (07 D26).
 */
export const maxDuration = 60;

/** The tab's table, or the Events tab's four lists, from its loader (design/P21-admin-view.md §4.6–§4.10). */
async function tabContent(tab: AdminTab, actor: AdminActor) {
  const caption = ADMIN_TAB_LABELS[tab];
  switch (tab) {
    case "creators":
      return (
        <AdminTable
          caption={caption}
          columns={CREATOR_COLUMNS}
          rows={await listAdminCreators(actor)}
        />
      );
    case "connections":
      return (
        <AdminTable
          caption={caption}
          columns={CONNECTION_COLUMNS}
          rows={await listAdminConnections(actor)}
        />
      );
    case "videos":
      return (
        <AdminTable
          caption={caption}
          columns={VIDEO_COLUMNS}
          rows={await listAdminVideos(actor)}
        />
      );
    case "requests":
      return (
        <AdminTable
          caption={caption}
          columns={REQUEST_COLUMNS}
          rows={await listAdminRequests(actor)}
          nowrap
        />
      );
    case "licenses":
      return (
        <AdminTable
          caption={caption}
          columns={LICENSE_COLUMNS}
          rows={await listAdminLicenses(actor)}
        />
      );
    case "events":
      return <EventsLists events={await listAdminEvents(actor)} />;
  }
}

/**
 * S24 `/admin?tab=…` (05 §7; 01 A.1–A.3; design/P21-admin-view.md §4, §6): the six tabs as links (Creators when the tab
 * is missing or unknown), "Newest 50", then the tab's one table (Events: its four lists), in the max-w-app column at
 * every tier. The page gates again (layouts don't re-render on every navigation) and renders in one piece, with no
 * loading.tsx or Suspense: a non-admin gets a real 404, never a streamed 200 (design §4.12).
 */
export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const user = await requireAdmin();
  const tab = parseAdminTab((await searchParams).tab);
  const actor = adminActor(user);
  return (
    <div className="flex flex-col gap-3 py-6 lg:pt-8 lg:pb-12">
      <h1 className="sr-only">Admin</h1>
      <SegmentedControl
        label={ADMIN_COPY.tabsLabel}
        scroll
        className="md:max-w-reading"
        items={ADMIN_TABS.map((t) => ({
          href: adminTabHref(t),
          label: ADMIN_TAB_LABELS[t],
          current: t === tab,
        }))}
      />
      <p className="mt-1 text-footnote text-ink-2">{ADMIN_COPY.caption}</p>
      {await tabContent(tab, actor)}
    </div>
  );
}
