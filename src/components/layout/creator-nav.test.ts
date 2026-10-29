import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREATOR_NAV, type CreatorNavKey, shellPrefetch } from "./creator-nav";

/** Whether the creator route group has a page at `href` ("/dashboard/library" → its page.tsx). */
const hasPage = (href: string) =>
  existsSync(`src/app/(dashboard)${href}/page.tsx`);

describe("shellPrefetch", () => {
  it("prefetches exactly the shell links whose page exists (a prefetch of a missing route logs a 404)", () => {
    for (const key of Object.keys(CREATOR_NAV) as CreatorNavKey[]) {
      expect([key, shellPrefetch(key) !== false]).toEqual([
        key,
        hasPage(CREATOR_NAV[key].href),
      ]);
    }
  });
});
