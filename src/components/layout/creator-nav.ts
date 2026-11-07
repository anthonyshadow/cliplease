// The creator shell's destinations (02 §4.1, 04 §9.30), shared by NavBar, TabBar and MoreSheet. Every one has its
// page (P20 built the last, /dashboard/licenses), so each link takes Next's default prefetch: a dynamic route down to
// its loading state, so Library, Connections and Pricing show their skeleton at once. creator-nav.test.ts fails on a
// destination with no page, whose production prefetch would log a 404.
// P20b adds "My licenses" (/licenses) to the account Menu and the MoreSheet (07 D126).
export const CREATOR_NAV = {
  inbox: { label: "Inbox", href: "/dashboard" },
  library: { label: "Library", href: "/dashboard/library" },
  videos: { label: "Videos", href: "/dashboard/videos" },
  licenses: { label: "Licenses", href: "/dashboard/licenses" },
  pricing: { label: "Pricing", href: "/dashboard/pricing" },
  connections: { label: "Connections", href: "/dashboard/connections" },
  settings: { label: "Settings", href: "/dashboard/settings" },
} as const;

export type CreatorNavKey = keyof typeof CREATOR_NAV;

/** NavBar links from lg. */
export const NAV_BAR_KEYS = [
  "inbox",
  "library",
  "videos",
  "licenses",
  "pricing",
  "connections",
] as const satisfies readonly CreatorNavKey[];

/** MoreSheet rows (before Sign out). */
export const MORE_SHEET_KEYS = [
  "licenses",
  "pricing",
  "settings",
] as const satisfies readonly CreatorNavKey[];

/** The nav key whose route contains `pathname` (Inbox only for /dashboard itself). */
export function currentNavKey(pathname: string): CreatorNavKey | undefined {
  const keys = Object.keys(CREATOR_NAV) as CreatorNavKey[];
  return keys.find((key) => {
    const href = CREATOR_NAV[key].href;
    return key === "inbox"
      ? pathname === href || pathname.startsWith("/dashboard/requests")
      : pathname === href || pathname.startsWith(`${href}/`);
  });
}
