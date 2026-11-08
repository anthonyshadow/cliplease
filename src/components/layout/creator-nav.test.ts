import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CREATOR_NAV,
  type CreatorNavKey,
  currentNavKey,
  MORE_SHEET_KEYS,
  NAV_BAR_KEYS,
} from "./creator-nav";

/** Whether the creator or the buyer route group has a page at `href` ("/dashboard/library" → its page.tsx). */
const hasPage = (href: string) =>
  ["(dashboard)", "(buyer)"].some((group) =>
    existsSync(`src/app/${group}${href}/page.tsx`),
  );

describe("CREATOR_NAV", () => {
  it("links only destinations whose page exists (a shell link's prefetch of a missing route logs a 404)", () => {
    for (const key of Object.keys(CREATOR_NAV) as CreatorNavKey[]) {
      expect([key, hasPage(CREATOR_NAV[key].href)]).toEqual([key, true]);
    }
  });

  it("puts My licenses in the MoreSheet before Settings and never among the NavBar links (04 §9.30)", () => {
    expect(MORE_SHEET_KEYS).toEqual([
      "licenses",
      "pricing",
      "myLicenses",
      "settings",
    ]);
    expect(NAV_BAR_KEYS).not.toContain("myLicenses");
  });

  it.each([
    ["/licenses", "myLicenses"],
    ["/licenses/0b6f7a52-3c1d-4e8f-9a2b-5c6d7e8f9a0b", "myLicenses"],
    ["/dashboard/licenses", "licenses"],
    ["/licensesx", undefined],
  ] as const)("currentNavKey(%s) is %s", (pathname, key) => {
    expect(currentNavKey(pathname)).toBe(key);
  });
});
