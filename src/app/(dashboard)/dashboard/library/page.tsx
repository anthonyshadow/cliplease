import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  connectErrorBanner,
  connectedToastMessage,
} from "@/components/connections/connect-messages";
import { StripConnectParams } from "@/components/connections/strip-connect-params";
import { FinishPayoutsBanner } from "@/components/layout/finish-payouts-banner";
import { WIDE_COLUMN } from "@/components/layout/gutter";
import { AccountStrip } from "@/components/library/account-strip";
import { FilterChips } from "@/components/library/filter-chips";
import { LibraryEmpty } from "@/components/library/library-empty";
import { LibraryGrid } from "@/components/library/library-grid";
import {
  accountLabels,
  LIBRARY_TITLE,
  libraryChips,
  libraryEmptyState,
  libraryRedirect,
  librarySyncState,
  loadOlder,
  stripHref,
  syncBanners,
} from "@/components/library/library-messages";
import { LibrarySyncProvider } from "@/components/library/library-sync";
import { LibrarySyncHeader } from "@/components/library/library-sync-header";
import { LibraryTitle } from "@/components/library/library-title";
import { SearchField } from "@/components/library/search-field";
import { SyncBanner } from "@/components/library/sync-banner";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ToastOnMount } from "@/components/ui/toast";
import {
  LIBRARY_PATH,
  LibraryFilterSchema,
  libraryHref,
} from "@/lib/library/filter";
import { requireCreator, toActor } from "@/server/auth/session";
import { listLibraryPosts } from "@/server/library/queries";
import { SOCIAL_SYNC_MAX_POSTS } from "@/server/social/sync";

export const metadata: Metadata = { title: "Library" };

// Sync all, Sync now and Load older videos call the platform from this page's Server Actions (02 §6.1; Next sets an
// action's limit on its page).
export const maxDuration = 60;

/**
 * S12 (05 §6.1): every linked account's posts in one grid with the account strip, the sync line and Sync all, the sync
 * banners, platform chips, caption search, Show more and Load older videos; the four empty states replace the grid.
 * Nothing syncs on render (07 D13). A connect started here comes back with ?connected= or ?error= (07 D37).
 */
export default async function LibraryPage({
  searchParams,
}: PageProps<"/dashboard/library">) {
  const ctx = await requireCreator(LIBRARY_PATH);
  const params = await searchParams;
  const filter = LibraryFilterSchema.parse(params);
  const library = await listLibraryPosts(toActor(ctx), filter);
  const { accounts, posts, allExpired, visibleCount } = library;
  // The posts query runs beside the summaries: on the rare redirect it reads nothing, which costs less than waiting for
  // the summaries before the posts on every load.
  const to = libraryRedirect(filter, accounts, posts.length);
  if (to) redirect(to);

  const errorBanner = connectErrorBanner(params.error);
  const connectedToast = connectedToastMessage(params.connected);
  const roundTrip = (
    <>
      {connectedToast ? <ToastOnMount message={connectedToast} /> : null}
      <StripConnectParams />
    </>
  );
  const errorLine = errorBanner ? (
    <Banner tone={errorBanner.tone}>{errorBanner.message}</Banner>
  ) : null;
  const empty = libraryEmptyState({
    accounts,
    postCount: posts.length,
    filter,
    allExpired,
  });

  if (empty?.kind === "no-accounts") {
    return (
      <>
        <FinishPayoutsBanner
          payoutsStatus={ctx.creator.payoutsStatus}
          className="mt-6 lg:mt-12"
        />
        {errorLine ? <div className="mt-6">{errorLine}</div> : null}
        <EmptyState
          as="h1"
          title={
            <>
              {LIBRARY_TITLE}{" "}
              <span className="text-ink-2">Nothing here yet.</span>
            </>
          }
          description="Your videos from Instagram, TikTok and YouTube show up here."
          actions={
            <>
              <Button asChild className="w-full md:w-auto">
                <Link href="/dashboard/connections">Connect an account</Link>
              </Button>
              <Button asChild variant="tertiary" size="sm">
                <Link href="/dashboard/videos/new">Or upload a video</Link>
              </Button>
            </>
          }
        />
        {roundTrip}
      </>
    );
  }

  const { cursor: _, ...base } = filter;
  const expired = empty?.kind === "expired";
  const labels = accountLabels(accounts);
  const sync = librarySyncState(
    accounts,
    labels,
    { visibleCount, expired },
    new Date(),
  );

  return (
    <LibrarySyncProvider labels={labels} filterKey={libraryHref(base)}>
      <div className={WIDE_COLUMN}>
        {/* One DOM order, the phone's (05 §6.1 Mobile): from md the sync line moves up onto the title row, taking at most
            half of it so a long summary wraps instead of squeezing the title. */}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_fit-content(50%)] md:items-center md:gap-x-6">
          <LibraryTitle />
          <FinishPayoutsBanner
            payoutsStatus={ctx.creator.payoutsStatus}
            className="md:col-span-2"
          />
          <div className="min-w-0 md:col-span-2">
            <AccountStrip
              accounts={accounts}
              selectedId={base.accountId}
              hrefFor={(account) => stripHref(base, account)}
            />
          </div>
          <div className="md:col-start-2 md:row-start-1">
            <LibrarySyncHeader
              status={sync.status}
              showSyncAll={sync.showSyncAll}
              blockedHelper={sync.blockedHelper}
            />
          </div>
        </div>
        {errorLine}
        {syncBanners(accounts, labels, { stale: !expired }).map((banner) => (
          <SyncBanner key={banner.key} banner={banner} />
        ))}
        {expired ? null : (
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
            <FilterChips
              chips={libraryChips(base, accounts, library.platformCounts)}
              className="min-w-0"
            />
            <SearchField filter={base} className="w-full md:w-72 md:shrink-0" />
          </div>
        )}
        {empty === null ? (
          <LibraryGrid
            posts={posts}
            nextCursor={library.nextCursor}
            filter={base}
            loadOlder={loadOlder(accounts, filter, SOCIAL_SYNC_MAX_POSTS)}
          />
        ) : (
          <LibraryEmpty
            empty={empty}
            filter={base}
            blockedHelper={sync.blockedHelper}
          />
        )}
        {roundTrip}
      </div>
    </LibrarySyncProvider>
  );
}
