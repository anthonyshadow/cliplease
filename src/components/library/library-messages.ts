// What the Library page shows around the grid (05 §6.1 States, 04 §9.15, §11.8, §11.9). Client-safe and pure: the page
// computes it on the server, the Sync-all island formats its summary with it.
import type { syncAllAccounts } from "@/app/(dashboard)/dashboard/_actions/social";
import {
  accountName,
  capNote,
  rateLimitMessage,
  syncLine,
  tryAgainIn,
} from "@/components/connections/connect-messages";
import { PLATFORM_LABELS } from "@/lib/brand";
import type {
  SocialAccountStatus,
  SocialProviderId,
} from "@/lib/domain/values";
import { formatRelative } from "@/lib/format";
import { type LibraryFilter, libraryHref } from "@/lib/library/filter";

/** The account fields these rules read (AccountSummaryDTO's, structurally). */
export type LibraryAccount = {
  id: string;
  platform: SocialProviderId;
  username: string | null;
  displayName: string | null;
  status: SocialAccountStatus;
  lastSyncedAt: string | null;
  syncProblem: boolean;
  syncing: boolean;
  blockedMinutes: number | null;
  stale: boolean;
  hasOlder: boolean;
  postCount: number;
};

/** One account's sync outcome as syncAllAccounts returns it (the server's AccountSyncResult, without importing it). */
export type AccountSyncOutcome = Extract<
  Awaited<ReturnType<typeof syncAllAccounts>>,
  { ok: true }
>["data"][number];
type SyncFailure = Extract<AccountSyncOutcome["result"], { ok: false }>;

export const LIBRARY_TITLE = "Library.";
/** The h1's id: it takes the focus when a sync removes the control that started it. */
export const LIBRARY_TITLE_ID = "library-title";
export const LIBRARY_SUBTITLE = "Everything you've posted.";
export const ALREADY_SYNCING = "Already syncing";

/**
 * How the page names each account: the platform word, or @username (accountName) when two accounts share a platform
 * (prompt Task 4; owner answer Q-32 for the banners).
 */
export function accountLabels(
  accounts: readonly LibraryAccount[],
): Record<string, string> {
  const shared = (platform: SocialProviderId) =>
    accounts.filter((a) => a.platform === platform).length > 1;
  return Object.fromEntries(
    accounts.map((a) => [
      a.id,
      shared(a.platform) ? accountName(a) : PLATFORM_LABELS[a.platform],
    ]),
  );
}

/**
 * After Sync all (01 J3.4): "Demo 3 new · YouTube up to date", in the accounts' order. A rate-limited account says so; an
 * account that is already syncing (a toast says that), needs a reconnect or failed (its banner says that), or that the
 * 25 s budget didn't reach, is left out. Null when nothing is left: the sync line shows instead.
 */
export function syncAllSummary(
  outcomes: readonly {
    socialAccountId: string;
    result: { ok: true; added: number } | SyncFailure;
  }[],
  labels: Readonly<Record<string, string>>,
): string | null {
  const parts = outcomes.flatMap(({ socialAccountId, result }) => {
    const label = labels[socialAccountId];
    if (!label) return [];
    if (result.ok) {
      return [
        result.added > 0
          ? `${label} ${result.added} new`
          : `${label} up to date`,
      ];
    }
    if (result.reason === "rate_limited") {
      const minutes = Math.max(1, Math.ceil((result.retryAfterSec ?? 60) / 60));
      return [rateLimitMessage(label, minutes)];
    }
    return [];
  });
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The Library-wide sync line (05 §6.1 annotation 4): the oldest last sync across the accounts with the visible-post count,
 * "Synced 3 min ago · 24 videos"; once every post expired, the time alone ("Synced 41 days ago"). Null before any sync.
 */
export function librarySyncLine(
  accounts: readonly LibraryAccount[],
  visibleCount: number,
  expired: boolean,
  now: Date,
): string | null {
  const oldest = accounts
    .map((a) => a.lastSyncedAt)
    .filter((t): t is string => t !== null)
    .sort()[0];
  if (oldest === undefined) return null;
  return expired
    ? formatRelative(new Date(oldest), now)
    : syncLine({ lastSyncedAt: oldest, postCount: visibleCount }, now);
}

/**
 * Rate limits (05 §6.1 "Rate limited", prompt Task 4): when every connected account is blocked, Sync all is disabled
 * with "Try again in {n} min." (the soonest); otherwise each blocked account's slow-down sentence goes in SyncStatus.
 */
export function rateLimits(
  accounts: readonly LibraryAccount[],
  labels: Readonly<Record<string, string>>,
): { allBlockedHelper: string | null; sentence: string | null } {
  const connected = accounts.filter((a) => a.status === "connected");
  const blocked = connected.filter((a) => a.blockedMinutes !== null);
  if (blocked.length === 0) return { allBlockedHelper: null, sentence: null };
  if (blocked.length === connected.length) {
    const soonest = Math.min(...blocked.map((a) => a.blockedMinutes ?? 0));
    return { allBlockedHelper: tryAgainIn(soonest), sentence: null };
  }
  return {
    allBlockedHelper: null,
    sentence: blocked
      .map((a) => rateLimitMessage(labels[a.id] ?? "", a.blockedMinutes ?? 0))
      .join(" · "),
  };
}

/**
 * The filter without what matches none of the creator's accounts (another creator's account, a platform with no linked
 * account), so the page never names a stranger's account; an account wins over a different platform.
 */
export function filterForAccounts(
  filter: LibraryFilter,
  accounts: readonly LibraryAccount[],
): LibraryFilter {
  const account = accounts.find((a) => a.id === filter.accountId);
  const platform =
    filter.platform &&
    accounts.some((a) => a.platform === filter.platform) &&
    (!account || account.platform === filter.platform)
      ? filter.platform
      : undefined;
  // A cursor belongs to the list it came from: once its platform or account is dropped, it starts over.
  const unchanged =
    platform === filter.platform && account?.id === filter.accountId;
  return {
    ...(platform && { platform }),
    ...(account && { accountId: account.id }),
    ...(filter.q && { q: filter.q }),
    ...(filter.cursor && unchanged && { cursor: filter.cursor }),
  };
}

/** Filter links keep each other's params, except an account and a different platform, which can't both hold. */
type BaseFilter = Omit<LibraryFilter, "cursor">;

/** The FilterChips (04 §9.14): "All {n}", then one chip per linked platform with its visible-post count. */
export function libraryChips(
  base: BaseFilter,
  accounts: readonly LibraryAccount[],
  counts: Partial<Record<SocialProviderId, number>>,
): { key: string; label: string; href: string; current: boolean }[] {
  const selected = accounts.find((a) => a.id === base.accountId);
  const platforms = [...new Set(accounts.map((a) => a.platform))];
  const total = platforms.reduce((n, p) => n + (counts[p] ?? 0), 0);
  return [
    {
      key: "all",
      label: `All ${total}`,
      href: libraryHref({ ...base, platform: undefined }),
      current: !base.platform,
    },
    ...platforms.map((p) => ({
      key: p,
      label: `${PLATFORM_LABELS[p]} ${counts[p] ?? 0}`,
      href: libraryHref({
        ...base,
        platform: p,
        accountId: selected?.platform === p ? base.accountId : undefined,
      }),
      current: base.platform === p,
    })),
  ];
}

/** An AccountStrip item's link: it selects the account, or shows every account again when it is the selected one. */
export function stripHref(
  base: BaseFilter,
  account: Pick<LibraryAccount, "id" | "platform">,
): string {
  if (base.accountId === account.id) {
    return libraryHref({ ...base, accountId: undefined });
  }
  return libraryHref({
    ...base,
    accountId: account.id,
    platform: base.platform === account.platform ? base.platform : undefined,
  });
}

/**
 * The header's server side (05 §6.1 annotation 4, States): SyncStatus reads "Syncing…" while a sync holds its lease, else
 * the rate-limit sentence, else the sync line; Sync all shows while an account is connected, except once every post
 * expired (that state's own Sync now is the one action), and waits out a rate limit on every account.
 */
export function librarySyncState(
  accounts: readonly LibraryAccount[],
  labels: Readonly<Record<string, string>>,
  { visibleCount, expired }: { visibleCount: number; expired: boolean },
  now: Date,
): {
  status: string | null;
  showSyncAll: boolean;
  blockedHelper: string | null;
} {
  const rate = rateLimits(accounts, labels);
  return {
    status: accounts.some((a) => a.syncing)
      ? "Syncing…"
      : (rate.sentence ??
        librarySyncLine(accounts, visibleCount, expired, now)),
    showSyncAll: !expired && accounts.some((a) => a.status === "connected"),
    blockedHelper: rate.allBlockedHelper,
  };
}

/** A sync the page offers, in SyncButton's props: one account (Sync now / Try again) or every connected one. */
export type SyncTarget = { socialAccountId: string } | { all: true };

/** Connected, not waiting out a rate limit and not already syncing. */
const canSync = (a: LibraryAccount) =>
  a.status === "connected" && a.blockedMinutes === null && !a.syncing;

/** One account's own target, or Sync all for several; null when none of them can sync now. */
function targetFor(accounts: readonly LibraryAccount[]): SyncTarget | null {
  const ready = accounts.filter(canSync);
  if (ready.length === 0) return null;
  const [only] = accounts;
  return accounts.length === 1 && only
    ? { socialAccountId: only.id }
    : { all: true };
}

export type SyncBannerView =
  | {
      kind: "reconnect";
      key: string;
      platform: SocialProviderId;
      message: string;
    }
  | {
      kind: "problem" | "stale";
      key: string;
      target: SyncTarget;
      message: string;
    };

/**
 * The SyncBanners above the chips (04 §9.15, 05 §6.1 annotation 5): Reconnect (warning) or Couldn't reach (error) per
 * account, then one quiet stale banner for every connected account last synced over 24 h ago (owner answer Q-32). An
 * account that is syncing or rate-limited gets no stale banner: Sync now couldn't run.
 */
export function syncBanners(
  accounts: readonly LibraryAccount[],
  labels: Readonly<Record<string, string>>,
  { stale = true }: { stale?: boolean } = {},
): SyncBannerView[] {
  const banners: SyncBannerView[] = [];
  for (const a of accounts) {
    const label = labels[a.id] ?? PLATFORM_LABELS[a.platform];
    if (a.status === "needs_reconnect") {
      banners.push({
        kind: "reconnect",
        key: a.id,
        platform: a.platform,
        message: `Reconnect ${label} to sync and to make new posts licensable.`,
      });
    } else if (a.status === "connected" && a.syncProblem) {
      banners.push({
        kind: "problem",
        key: a.id,
        target: { socialAccountId: a.id },
        message: `Couldn't reach ${label}. Your saved posts are still here.`,
      });
    }
  }
  const staleAccounts = accounts.filter(
    (a) => a.stale && !a.syncProblem && canSync(a),
  );
  const target = stale ? targetFor(staleAccounts) : null;
  if (target) {
    banners.push({
      kind: "stale",
      key: "stale",
      target,
      message: "Sync to see your latest posts.",
    });
  }
  return banners;
}

const PLATFORM_EMPTY_NOTES: Partial<Record<SocialProviderId, string>> = {
  instagram: "Images and carousels aren't shown.",
  tiktok: "Only public videos show up.",
};

/** "@a", "@a or @b", "@a, @b or @c". */
function joinOr(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

export type LibraryEmptyState =
  | { kind: "no-accounts" }
  | { kind: "expired" }
  | { kind: "no-match"; title: string }
  | {
      kind: "no-videos";
      title: string;
      notes: string[];
      target: SyncTarget | null;
    };

/**
 * Which EmptyState replaces the grid, most important first (05 §6.1 States): no linked account; every post past the
 * 30-day rule; a search with no match; the filtered accounts with no videos ("No videos found on @a or @b.", owner
 * answer Q-31; Sync now when they can sync). Null: the grid has tiles.
 */
export function libraryEmptyState({
  accounts,
  postCount,
  filter,
  allExpired,
}: {
  accounts: readonly LibraryAccount[];
  postCount: number;
  filter: LibraryFilter;
  allExpired: boolean;
}): LibraryEmptyState | null {
  if (accounts.length === 0) return { kind: "no-accounts" };
  if (allExpired) return { kind: "expired" };
  if (postCount > 0) return null;
  if (filter.q) {
    return { kind: "no-match", title: `No videos match “${filter.q}”.` };
  }
  // The page has already dropped a filter that matches none of the accounts (filterForAccounts).
  const scope = accounts.filter((a) =>
    filter.accountId
      ? a.id === filter.accountId
      : !filter.platform || a.platform === filter.platform,
  );
  const platforms = [...new Set(scope.map((a) => a.platform))];
  return {
    kind: "no-videos",
    title: `No videos found on ${joinOr(scope.map(accountName))}.`,
    notes: platforms.flatMap((p) => PLATFORM_EMPTY_NOTES[p] ?? []),
    target: targetFor(scope),
  };
}

/**
 * Load older videos (07 D13): only for the one account in ?account=, when it is connected and the last run stopped
 * before the end of its list; the cap note above it once it holds `max` videos (01 J3.11).
 */
export function loadOlder(
  accounts: readonly LibraryAccount[],
  filter: LibraryFilter,
  max: number,
): {
  socialAccountId: string;
  note: string | null;
  blockedHelper: string | null;
} | null {
  const account = accounts.find((a) => a.id === filter.accountId);
  if (account?.status !== "connected" || !account.hasOlder) {
    return null;
  }
  return {
    socialAccountId: account.id,
    note: account.postCount >= max ? capNote(max) : null,
    // Disabled while the platform has us waiting, like Sync all (04 §9.15).
    blockedHelper:
      account.blockedMinutes === null
        ? null
        : tryAgainIn(account.blockedMinutes),
  };
}
