import { describe, expect, it } from "vitest";
import {
  accountLabels,
  filterForAccounts,
  type LibraryAccount,
  libraryChips,
  libraryEmptyState,
  libraryRedirect,
  librarySyncLine,
  loadOlder,
  rateLimits,
  stripHref,
  syncAllSummary,
  syncBanners,
} from "./library-messages";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-19T12:00:00Z");

function account(over: Partial<LibraryAccount> = {}): LibraryAccount {
  return {
    id: A,
    platform: "mock",
    username: "demo.creator",
    displayName: "Demo Creator",
    status: "connected",
    lastSyncedAt: "2026-10-19T11:57:00Z",
    syncProblem: false,
    syncing: false,
    blockedMinutes: null,
    stale: false,
    hasOlder: false,
    postCount: 24,
    ...over,
  };
}
const demo = account();
const demo2 = account({ id: B, username: "demo.creator.2" });
const tiktok = account({ id: C, platform: "tiktok", username: "maya.films" });

describe("accountLabels", () => {
  it("names an account by its platform, or by @username when two share one", () => {
    expect(accountLabels([demo, tiktok])).toEqual({
      [A]: "Demo",
      [C]: "TikTok",
    });
    expect(accountLabels([demo, demo2, tiktok])).toEqual({
      [A]: "@demo.creator",
      [B]: "@demo.creator.2",
      [C]: "TikTok",
    });
  });
});

describe("syncAllSummary (01 J3.4)", () => {
  const ok = (added: number) => ({ ok: true as const, added });
  it("says what each account got, in order", () => {
    expect(
      syncAllSummary(
        [
          { socialAccountId: A, result: ok(3) },
          { socialAccountId: C, result: ok(0) },
        ],
        { [A]: "Demo", [C]: "TikTok" },
      ),
    ).toBe("Demo 3 new · TikTok up to date");
    expect(
      syncAllSummary(
        [
          { socialAccountId: A, result: ok(0) },
          { socialAccountId: B, result: ok(0) },
        ],
        accountLabels([demo, demo2]),
      ),
    ).toBe("@demo.creator up to date · @demo.creator.2 up to date");
  });

  it("names a rate limit and leaves out what a banner or a toast says", () => {
    const labels = { [A]: "Demo", [B]: "YouTube", [C]: "TikTok" };
    expect(
      syncAllSummary(
        [
          {
            socialAccountId: A,
            result: { ok: false, reason: "rate_limited", retryAfterSec: 840 },
          },
          {
            socialAccountId: B,
            result: { ok: false, reason: "needs_reconnect" },
          },
          {
            socialAccountId: C,
            result: { ok: false, reason: "already_syncing" },
          },
        ],
        labels,
      ),
    ).toBe("Demo asked us to slow down. Try again in 14 min.");
    expect(
      syncAllSummary(
        [
          {
            socialAccountId: B,
            result: { ok: false, reason: "upstream_error" },
          },
        ],
        labels,
      ),
    ).toBeNull();
    expect(syncAllSummary([], labels)).toBeNull();
  });
});

describe("librarySyncLine (05 §6.1 annotation 4)", () => {
  it("reads the oldest last sync with the visible-post count", () => {
    const older = account({ id: B, lastSyncedAt: "2026-10-19T09:00:00Z" });
    expect(librarySyncLine([demo, older], 48, false, NOW)).toBe(
      "Synced 3 h ago · 48 videos",
    );
    expect(librarySyncLine([demo], 1, false, NOW)).toBe(
      "Synced 3 min ago · 1 video",
    );
  });

  it("drops the count once every post expired, and is null before any sync", () => {
    const old = account({ lastSyncedAt: "2026-09-08T12:00:00Z" });
    expect(librarySyncLine([old], 0, true, NOW)).toBe("Synced 41 days ago");
    expect(
      librarySyncLine([account({ lastSyncedAt: null })], 0, false, NOW),
    ).toBeNull();
  });
});

describe("rateLimits (05 §6.1 Rate limited)", () => {
  const labels = accountLabels([demo, tiktok]);
  it("disables Sync all with the soonest wait when every connected account is blocked", () => {
    expect(
      rateLimits(
        [
          account({ blockedMinutes: 15 }),
          account({ id: C, platform: "tiktok", blockedMinutes: 4 }),
          account({ id: B, platform: "youtube", status: "needs_reconnect" }),
        ],
        labels,
      ),
    ).toEqual({ allBlockedHelper: "Try again in 4 min.", sentence: null });
  });

  it("otherwise names each blocked account in the sync line", () => {
    expect(
      rateLimits(
        [demo, account({ id: C, platform: "tiktok", blockedMinutes: 15 })],
        labels,
      ),
    ).toEqual({
      allBlockedHelper: null,
      sentence: "TikTok asked us to slow down. Try again in 15 min.",
    });
    expect(rateLimits([demo, tiktok], labels)).toEqual({
      allBlockedHelper: null,
      sentence: null,
    });
  });
});

describe("syncBanners (04 §9.15; owner answer Q-32)", () => {
  it("one per account needing attention, then one stale banner", () => {
    const accounts = [
      account({ status: "needs_reconnect" }),
      account({ id: B, syncProblem: true, stale: true }),
      account({ id: C, platform: "tiktok", stale: true }),
    ];
    expect(syncBanners(accounts, accountLabels(accounts))).toEqual([
      {
        kind: "reconnect",
        key: A,
        platform: "mock",
        message:
          "Reconnect @demo.creator to sync and to make new posts licensable.",
      },
      {
        kind: "problem",
        key: B,
        target: { socialAccountId: B },
        message:
          "Couldn't reach @demo.creator. Your saved posts are still here.",
      },
      {
        kind: "stale",
        key: "stale",
        target: { socialAccountId: C },
        message: "Sync to see your latest posts.",
      },
    ]);
  });

  it("one stale banner for several accounts runs Sync all; none for one that can't sync, or when asked", () => {
    const stale = [
      account({ stale: true }),
      account({ id: C, platform: "tiktok", stale: true }),
    ];
    expect(syncBanners(stale, accountLabels(stale))).toEqual([
      expect.objectContaining({ kind: "stale", target: { all: true } }),
    ]);
    expect(
      syncBanners([account({ stale: true, blockedMinutes: 5 })], {}),
    ).toEqual([]);
    expect(syncBanners([account({ stale: true, syncing: true })], {})).toEqual(
      [],
    );
    expect(syncBanners(stale, {}, { stale: false })).toEqual([]);
  });

  it("uses the platform word when the account is the platform's only one", () => {
    expect(
      syncBanners(
        [account({ status: "needs_reconnect" })],
        accountLabels([demo]),
      )[0],
    ).toMatchObject({
      message: "Reconnect Demo to sync and to make new posts licensable.",
    });
  });
});

describe("libraryEmptyState (05 §6.1 States)", () => {
  const state = (over: Partial<Parameters<typeof libraryEmptyState>[0]> = {}) =>
    libraryEmptyState({
      accounts: [demo],
      postCount: 0,
      filter: {},
      allExpired: false,
      ...over,
    });

  it("most important first: no accounts, expired, no match", () => {
    expect(state({ accounts: [] })).toEqual({ kind: "no-accounts" });
    expect(state({ allExpired: true, filter: { q: "snow" } })).toEqual({
      kind: "expired",
      anyConnected: true,
    });
    expect(state({ filter: { q: "zzzz" } })).toEqual({
      kind: "no-match",
      title: "No videos match “zzzz”.",
    });
    expect(state({ postCount: 3 })).toBeNull();
  });

  it("names the account with no videos, with its platform note and Sync now", () => {
    const ig = account({
      id: C,
      platform: "instagram",
      username: "maya.films",
    });
    expect(state({ accounts: [demo, ig], filter: { accountId: C } })).toEqual({
      kind: "no-videos",
      title: "No videos found on @maya.films.",
      notes: ["Images and carousels aren't shown."],
      target: { socialAccountId: C },
    });
    expect(state()).toEqual({
      kind: "no-videos",
      title: "No videos found on @demo.creator.",
      notes: [],
      target: { socialAccountId: A },
    });
  });

  it("several empty accounts are named together and synced together (owner answer Q-31)", () => {
    expect(state({ accounts: [demo, demo2, tiktok] })).toEqual({
      kind: "no-videos",
      title:
        "No videos found on @demo.creator, @demo.creator.2 or @maya.films.",
      notes: ["Only public videos show up."],
      target: { all: true },
    });
    expect(
      state({ accounts: [demo, demo2, tiktok], filter: { platform: "mock" } }),
    ).toMatchObject({
      title: "No videos found on @demo.creator or @demo.creator.2.",
    });
  });

  it("one account that can sync among several that can't gets its own Sync now, not Sync all", () => {
    const a = account({ platform: "instagram", username: "a" });
    for (const b of [
      { status: "needs_reconnect" as const },
      { blockedMinutes: 3 },
      { syncing: true },
    ]) {
      expect(
        state({
          accounts: [
            a,
            account({ id: B, platform: "instagram", username: "b", ...b }),
          ],
          filter: { platform: "instagram" },
        }),
      ).toEqual({
        kind: "no-videos",
        title: "No videos found on @a or @b.",
        notes: ["Images and carousels aren't shown."],
        target: { socialAccountId: A },
      });
    }
  });

  it("offers the expired state's Sync now only while an account is connected", () => {
    expect(
      state({
        accounts: [account({ status: "needs_reconnect" })],
        allExpired: true,
      }),
    ).toEqual({ kind: "expired", anyConnected: false });
    // A rate-limited account keeps the button, disabled with its wait (blockedHelper).
    expect(
      state({ accounts: [account({ blockedMinutes: 3 })], allExpired: true }),
    ).toEqual({ kind: "expired", anyConnected: true });
  });

  it("offers no Sync now when the account can't sync", () => {
    expect(state({ accounts: [account({ blockedMinutes: 3 })] })).toMatchObject(
      {
        target: null,
      },
    );
    expect(
      state({ accounts: [account({ status: "needs_reconnect" })] }),
    ).toMatchObject({
      target: null,
    });
  });
});

describe("filters (05 §6.1 interaction notes)", () => {
  it("filterForAccounts drops a stranger's account and an unlinked platform", () => {
    expect(filterForAccounts({ accountId: C, q: "snow" }, [demo])).toEqual({
      q: "snow",
    });
    expect(filterForAccounts({ platform: "tiktok" }, [demo])).toEqual({});
    expect(
      filterForAccounts({ platform: "tiktok", accountId: A }, [demo, tiktok]),
    ).toEqual({
      accountId: A,
    });
    expect(
      filterForAccounts({ platform: "mock", accountId: A }, [demo]),
    ).toEqual({
      platform: "mock",
      accountId: A,
    });
  });

  it("filterForAccounts keeps a cursor only for the list it came from", () => {
    const X = "abc";
    expect(filterForAccounts({ accountId: A, cursor: X }, [demo])).toEqual({
      accountId: A,
      cursor: X,
    });
    expect(filterForAccounts({ cursor: X }, [demo])).toEqual({ cursor: X });
    expect(filterForAccounts({ accountId: C, cursor: X }, [demo])).toEqual({});
    expect(
      filterForAccounts({ platform: "tiktok", cursor: X }, [demo]),
    ).toEqual({});
  });

  it("libraryRedirect drops what filterForAccounts drops, and a cursor whose page came back empty", () => {
    const X = "abc";
    expect(libraryRedirect({ accountId: A, cursor: X }, [demo], 24)).toBeNull();
    expect(libraryRedirect({ q: "snow" }, [demo], 0)).toBeNull();
    expect(libraryRedirect({}, [demo], 0)).toBeNull();
    expect(
      libraryRedirect(
        { platform: "mock", accountId: A, q: "snow", cursor: X },
        [demo],
        0,
      ),
    ).toBe(`/dashboard/library?platform=mock&account=${A}&q=snow`);
    expect(libraryRedirect({ cursor: X }, [demo], 0)).toBe(
      "/dashboard/library",
    );
    expect(
      libraryRedirect({ accountId: C, q: "snow", cursor: X }, [demo], 24),
    ).toBe("/dashboard/library?q=snow");
    expect(libraryRedirect({ platform: "tiktok" }, [demo], 0)).toBe(
      "/dashboard/library",
    );
  });

  it("chips count each linked platform and keep the other params", () => {
    expect(
      libraryChips({ q: "snow" }, [demo, demo2, tiktok], { mock: 48 }),
    ).toEqual([
      {
        key: "all",
        label: "All 48",
        href: "/dashboard/library?q=snow",
        current: true,
      },
      {
        key: "mock",
        label: "Demo 48",
        href: "/dashboard/library?platform=mock&q=snow",
        current: false,
      },
      {
        key: "tiktok",
        label: "TikTok 0",
        href: "/dashboard/library?platform=tiktok&q=snow",
        current: false,
      },
    ]);
    const chips = libraryChips(
      { platform: "mock", accountId: A },
      [demo, tiktok],
      { mock: 24, tiktok: 2 },
    );
    expect(chips.map((c) => [c.label, c.href, c.current])).toEqual([
      ["All 26", `/dashboard/library?account=${A}`, false],
      ["Demo 24", `/dashboard/library?platform=mock&account=${A}`, true],
      ["TikTok 2", "/dashboard/library?platform=tiktok", false],
    ]);
  });

  it("a strip item selects its account, and the selected one shows every account again", () => {
    expect(stripHref({ q: "snow" }, demo)).toBe(
      `/dashboard/library?account=${A}&q=snow`,
    );
    expect(stripHref({ accountId: A, q: "snow" }, demo)).toBe(
      "/dashboard/library?q=snow",
    );
    expect(stripHref({ platform: "tiktok" }, demo)).toBe(
      `/dashboard/library?account=${A}`,
    );
  });
});

describe("loadOlder (07 D13)", () => {
  it("only for the filtered account, connected with older posts; the cap note from the cap on, with the count held", () => {
    const older = account({ hasOlder: true });
    expect(loadOlder([older], {}, 200)).toBeNull();
    expect(loadOlder([older], { accountId: A }, 200)).toEqual({
      socialAccountId: A,
      note: null,
      blockedHelper: null,
    });
    expect(
      loadOlder(
        [account({ hasOlder: true, postCount: 200 })],
        { accountId: A },
        200,
      ),
    ).toEqual({
      socialAccountId: A,
      note: "Showing your newest 200 videos.",
      blockedHelper: null,
    });
    expect(
      loadOlder(
        [account({ hasOlder: true, postCount: 300 })],
        { accountId: A },
        200,
      ),
    ).toMatchObject({ note: "Showing your newest 300 videos." });
    expect(
      loadOlder(
        [account({ hasOlder: true, blockedMinutes: 15 })],
        { accountId: A },
        200,
      ),
    ).toMatchObject({ blockedHelper: "Try again in 15 min." });
    expect(loadOlder([demo], { accountId: A }, 200)).toBeNull();
    expect(
      loadOlder(
        [account({ hasOlder: true, status: "needs_reconnect" })],
        { accountId: A },
        200,
      ),
    ).toBeNull();
  });
});
