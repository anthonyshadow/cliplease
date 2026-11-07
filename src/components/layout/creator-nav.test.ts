import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREATOR_NAV, type CreatorNavKey } from "./creator-nav";

/** Whether the creator route group has a page at `href` ("/dashboard/library" → its page.tsx). */
const hasPage = (href: string) =>
  existsSync(`src/app/(dashboard)${href}/page.tsx`);

describe("CREATOR_NAV", () => {
  it("links only destinations whose page exists (a shell link's prefetch of a missing route logs a 404)", () => {
    for (const key of Object.keys(CREATOR_NAV) as CreatorNavKey[]) {
      expect([key, hasPage(CREATOR_NAV[key].href)]).toEqual([key, true]);
    }
  });
});
