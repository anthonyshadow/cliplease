// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMoreLibraryPosts } from "@/app/(dashboard)/dashboard/library/actions";
import { type LibraryPostDTO, tileLinkId } from "@/lib/library/post";
import { LibraryGrid } from "./library-grid";

vi.mock("@/app/(dashboard)/dashboard/library/actions", () => ({
  loadMoreLibraryPosts: vi.fn(),
}));
const loadMore = vi.mocked(loadMoreLibraryPosts);

afterEach(() => {
  cleanup();
  loadMore.mockReset();
});

/** Post `n`, newest first by n; no stored thumbnail, so no image loads. */
function post(n: number): LibraryPostDTO {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    platform: "mock",
    accountUsername: "demo.creator",
    kind: "video",
    title: null,
    captionExcerpt: `Post ${n}`,
    permalink: `https://example.com/mock/${n}`,
    thumbnailSrc: null,
    thumbnailVersion: null,
    width: 720,
    height: 1280,
    postedAt: new Date(Date.UTC(2026, 9, 1) - n * 60_000).toISOString(),
    durationSec: 14,
    viewCount: 100,
    likeCount: 1,
    commentCount: 0,
    visibility: "public",
    fetchedAt: "2026-10-19T10:00:00.000Z",
    video: null,
  };
}
const posts = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => post(from + i));

const showMore = () => screen.getByRole("link", { name: /Show more/ });
const tileCount = () => document.querySelectorAll("[data-post-tile]").length;

describe("LibraryGrid Show more (05 §6.1 callout 14)", () => {
  it("drops a page that comes back for a grid that is gone: no tiles, no focus, and the new grid isn't busy", async () => {
    const stale =
      Promise.withResolvers<Awaited<ReturnType<typeof loadMoreLibraryPosts>>>();
    loadMore.mockReturnValueOnce(stale.promise);
    const { rerender } = render(
      <LibraryGrid
        posts={posts(1, 24)}
        nextCursor="all-2"
        filter={{}}
        loadOlder={null}
      />,
    );
    fireEvent.click(showMore());
    expect(showMore().getAttribute("aria-busy")).toBe("true");

    // A chip changes the filter while that page loads; the old page's first post is on the new grid.
    const demo = posts(25, 24);
    rerender(
      <LibraryGrid
        posts={demo}
        nextCursor="demo-2"
        filter={{ platform: "mock" }}
        loadOlder={null}
      />,
    );
    expect(showMore().getAttribute("aria-busy")).toBeNull();

    // The new grid's Show more loads its own next page at once.
    loadMore.mockResolvedValueOnce({
      ok: true,
      data: { posts: posts(49, 24), nextCursor: null },
    });
    await act(async () => {
      fireEvent.click(showMore());
    });
    expect(loadMore).toHaveBeenLastCalledWith({
      platform: "mock",
      account: undefined,
      q: undefined,
      cursor: "demo-2",
    });
    expect(tileCount()).toBe(48);
    expect(document.activeElement?.id).toBe(tileLinkId(post(49).id));

    // The first page then arrives for the grid that is gone: nothing changes.
    await act(async () => {
      stale.resolve({ ok: true, data: { posts: demo, nextCursor: "x" } });
    });
    expect(tileCount()).toBe(48);
    expect(document.activeElement?.id).toBe(tileLinkId(post(49).id));
  });

  it("leaves a Cmd, Ctrl, Shift or Alt click to the browser, which follows the link", () => {
    render(
      <LibraryGrid
        posts={posts(1, 24)}
        nextCursor="all-2"
        filter={{}}
        loadOlder={null}
      />,
    );
    expect(showMore().getAttribute("href")).toBe(
      "/dashboard/library?cursor=all-2",
    );
    // Runs after React's listener: records whether the grid kept the click, then stops jsdom's navigation.
    const kept: boolean[] = [];
    const record = (event: MouseEvent) => {
      kept.push(event.defaultPrevented);
      event.preventDefault();
    };
    window.addEventListener("click", record);
    loadMore.mockReturnValue(new Promise(() => {}));
    try {
      for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
        fireEvent.click(showMore(), { [key]: true });
      }
      expect(loadMore).not.toHaveBeenCalled();
      fireEvent.click(showMore());
    } finally {
      window.removeEventListener("click", record);
    }
    expect(kept).toEqual([false, false, false, false, true]);
    expect(loadMore).toHaveBeenCalledTimes(1);
  });
});
