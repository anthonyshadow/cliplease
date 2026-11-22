// The admin view's six tabs (05 §7; 01 A.2): `/admin?tab=…`, Creators when the tab is missing or unknown. Pure.
import { z } from "zod";

export const ADMIN_TABS = [
  "creators",
  "connections",
  "videos",
  "requests",
  "licenses",
  "events",
] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

const adminTab = z.enum(ADMIN_TABS).catch("creators");

/** `searchParams.tab` as a tab: anything else (missing, repeated, unknown) is Creators. */
export function parseAdminTab(v: unknown): AdminTab {
  return adminTab.parse(v);
}

/** The tab row's words (05 §7): `connections` reads Accounts. */
export const ADMIN_TAB_LABELS = {
  creators: "Creators",
  connections: "Accounts",
  videos: "Videos",
  requests: "Requests",
  licenses: "Licenses",
  events: "Events",
} as const satisfies Record<AdminTab, string>;

/** The tab's link in the tab row. */
export const adminTabHref = (tab: AdminTab) => `/admin?tab=${tab}`;
