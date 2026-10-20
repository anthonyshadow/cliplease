"use client";

import { type MouseEvent, useEffect, useRef, useState } from "react";
import { loadMoreLibraryPosts } from "@/app/(dashboard)/dashboard/library/actions";
import { LIBRARY_GRID } from "@/components/layout/gutter";
import { Button } from "@/components/ui/button";
import { runAction } from "@/components/ui/run-action";
import { toast } from "@/components/ui/toast";
import {
  encodeLibraryCursor,
  type LibraryFilter,
  libraryHref,
} from "@/lib/library/filter";
import { type LibraryPostDTO, tileLinkId } from "@/lib/library/post";
import { LibraryPostTile } from "./library-post-tile";
import { SyncButton } from "./sync-button";

/** The pages appended after one first page. */
type Appended = {
  firstPage: string;
  posts: LibraryPostDTO[];
  cursor: string | null;
};

/**
 * The grid (04 §5.2, 07 D146) on the <ul> itself, so nothing narrows it. Show more appends the next 24 tiles through
 * loadMoreLibraryPosts and moves the focus to the first new one; without JS it is a link to the next page (02's route
 * contract). At the end of the grid, Load older videos runs an 'older' sync for the one filtered account and appends
 * what it found (07 D13). A new filter, or a recent sync (it rewrites the first page's posts), starts over from the
 * server's first page, since appended pages would leave gaps or stale tiles; an older sync never touches the first
 * page, so its tiles append.
 */
export function LibraryGrid({
  posts,
  nextCursor,
  filter,
  loadOlder,
}: {
  posts: LibraryPostDTO[];
  nextCursor: string | null;
  /** The page's filter, without its cursor. */
  filter: Omit<LibraryFilter, "cursor">;
  loadOlder: {
    socialAccountId: string;
    note: string | null;
    blockedHelper: string | null;
  } | null;
}) {
  const firstPage = `${libraryHref(filter)} ${posts.map((p) => `${p.id}@${p.fetchedAt}`).join(",")}`;
  const [appended, setAppended] = useState<Appended | null>(null);
  const extra = appended?.firstPage === firstPage ? appended : null;
  const shown = extra
    ? [
        ...posts,
        ...extra.posts.filter((p) => !posts.some((q) => q.id === p.id)),
      ]
    : posts;
  const pageCursor = extra ? extra.cursor : nextCursor;
  const [pending, setPending] = useState(false);
  const loading = useRef(false);
  const focusId = useRef<string | null>(null);

  // The first tile a load added takes the focus once it is on the page.
  useEffect(() => {
    const id = focusId.current;
    focusId.current = null;
    if (id) document.getElementById(tileLinkId(id))?.focus();
  });

  const loadFrom = async (from: string) => {
    if (loading.current) return;
    loading.current = true;
    setPending(true);
    const startedFor = firstPage;
    const result = await runAction(() =>
      loadMoreLibraryPosts({
        platform: filter.platform,
        account: filter.accountId,
        q: filter.q,
        cursor: from,
      }),
    );
    loading.current = false;
    setPending(false);
    if (result && !result.ok) toast(result.error.message);
    if (!result?.ok) return;
    const page = result.data;
    focusId.current = page.posts[0]?.id ?? null;
    // Kept for the first page it followed: if a sync replaced that page meanwhile, the server's page shows instead.
    setAppended((before) => ({
      firstPage: startedFor,
      posts: [
        ...(before?.firstPage === startedFor ? before.posts : []),
        ...page.posts,
      ],
      cursor: page.nextCursor,
    }));
  };

  const showMore = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (pageCursor) loadFrom(pageCursor);
  };

  // After an older sync, the tiles past the last one shown are the older posts it found.
  const last = shown.at(-1);
  const appendOlder = () => {
    if (last?.postedAt) {
      loadFrom(
        encodeLibraryCursor({ postedAt: new Date(last.postedAt), id: last.id }),
      );
    }
  };

  return (
    <div
      className="flex flex-col gap-6"
      // Set without a render once React owns the grid: e2e waits for it before pressing Show more.
      ref={(node) => node?.setAttribute("data-hydrated", "")}
    >
      <ul data-library-grid className={LIBRARY_GRID}>
        {shown.map((post) => (
          <LibraryPostTile key={post.id} post={post} />
        ))}
      </ul>
      {pageCursor ? (
        <div className="flex md:justify-center">
          <Button
            asChild
            variant="secondary"
            size="sm"
            loading={pending}
            loadingLabel="Loading…"
          >
            <a
              href={libraryHref({ ...filter, cursor: pageCursor })}
              onClick={showMore}
            >
              Show more
            </a>
          </Button>
        </div>
      ) : loadOlder ? (
        <div className="flex flex-col items-start gap-3 md:items-center">
          {loadOlder.note ? (
            <p className="text-footnote text-ink-2">{loadOlder.note}</p>
          ) : null}
          <SyncButton
            socialAccountId={loadOlder.socialAccountId}
            mode="older"
            label="Load older videos"
            icon={false}
            fullWidth
            blockedHelper={loadOlder.blockedHelper}
            focusAfterRemove={last ? tileLinkId(last.id) : undefined}
            onSettled={(outcomes) => {
              if (outcomes?.[0]?.result.ok) appendOlder();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
