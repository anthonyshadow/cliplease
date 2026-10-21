// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideoFromPost } from "@/app/(dashboard)/dashboard/videos/new/actions";
import {
  type MakeLicensableCode,
  makeLicensableMessage,
  type SourcePageState,
  sourcePageState,
} from "@/lib/videos/source-page";
import type { SourcePagePostDTO } from "@/server/library/queries";
import { SourceActions } from "./source-actions";
import { SourcePage } from "./source-page";

vi.mock("@/app/(dashboard)/dashboard/videos/new/actions", () => ({
  createVideoFromPost: vi.fn(),
}));
const makeLicensable = vi.mocked(createVideoFromPost);

afterEach(() => {
  cleanup();
  makeLicensable.mockReset();
});

const POST_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
const VIDEO_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

/** Demo post 01 as getLibraryPost returns it; no stored thumbnail, so no image loads. */
const POST: SourcePagePostDTO = {
  id: POST_ID,
  platform: "mock",
  accountUsername: "demo.creator",
  kind: "video",
  title: null,
  captionExcerpt: "He saw snow for the first time and lost it #dogs #firstsnow",
  permalink: "https://example.com/mock/mock_post_abc_01",
  thumbnailSrc: null,
  thumbnailVersion: null,
  width: 720,
  height: 1280,
  postedAt: "2026-10-01T15:00:00.000Z",
  durationSec: 14,
  viewCount: 14_800_000,
  likeCount: 888_000,
  commentCount: 44_400,
  visibility: "public",
  fetchedAt: "2026-10-20T10:00:00.000Z",
  video: null,
  accountStatus: "connected",
  accountDisplayName: "Demo Creator",
  accountConnectedAt: "2026-10-12T09:00:00.000Z",
};

const primaryButton = () =>
  screen.queryByRole("button", { name: "Make licensable" });

/** The Source page's bottom in `state`, with a stand-in badge. */
function renderActions(state: SourcePageState, badge = true) {
  return render(
    <SourceActions
      postId={POST_ID}
      platform="mock"
      state={state}
      badge={badge ? <p>Badge preview</p> : null}
    />,
  );
}

/** Presses Make licensable (focused, as a keyboard user would) with the action refusing `code`. */
async function pressRefused(code: MakeLicensableCode) {
  makeLicensable.mockResolvedValueOnce({
    ok: false,
    error: { code, message: makeLicensableMessage(code, "mock") },
  });
  const button = primaryButton();
  if (!button) throw new Error("no Make licensable");
  button.focus();
  await act(async () => {
    fireEvent.click(button);
  });
}

describe("SourcePage (S16; 05 §6.5, 04 §9.13)", () => {
  it("shows the post, its lines, View on Demo, the provenance line, the badge preview and Make licensable", () => {
    render(<SourcePage post={POST} connectError={undefined} />);
    expect(
      screen.getByRole("link", { name: "Library" }).getAttribute("href"),
    ).toBe("/dashboard/library");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "New video. From your Library or a file.",
    );
    expect(
      screen.getByText(
        "He saw snow for the first time and lost it #dogs #firstsnow",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Demo · 1 Oct 2026 · 0:14")).toBeTruthy();
    expect(
      screen.getByText("14.8M views · 888K likes · 44.4K comments"),
    ).toBeTruthy();
    // No stored thumbnail: the failed state, never a broken image (04 §9.12).
    expect(screen.getByText("Demo · Sync to refresh")).toBeTruthy();

    const viewOn = screen.getByRole("link", {
      name: "View on Demo (opens in a new tab)",
    });
    expect(viewOn.textContent).toBe("View on Demo ↗");
    expect(viewOn.getAttribute("href")).toBe(POST.permalink);
    expect(viewOn.getAttribute("target")).toBe("_blank");
    expect(viewOn.getAttribute("rel")).toBe("noopener noreferrer");

    expect(
      screen.getByText("From Demo · @demo.creator · posted 1 Oct 2026"),
    ).toBeTruthy();
    expect(screen.getByText("Buyers will see:")).toBeTruthy();
    expect(
      screen.getByText("Verified · @demo.creator (demo account)"),
    ).toBeTruthy();
    expect(screen.getByText("Account linked 12 Oct 2026")).toBeTruthy();
    expect(primaryButton()?.getAttribute("type")).toBe("submit");
    expect(
      document
        .querySelector<HTMLInputElement>('input[name="socialPostId"]')
        ?.getAttribute("value"),
    ).toBe(POST_ID);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the connect error Banner a reconnect came back with (owner answer Q-67 a); an unknown code shows nothing", () => {
    const { unmount } = render(
      <SourcePage post={POST} connectError="provider_error" />,
    );
    expect(screen.getByRole("alert").textContent).toBe(
      "Couldn't reach the platform. Try again.",
    );
    unmount();
    render(<SourcePage post={POST} connectError="nope" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("needs reconnect: the reconnect line replaces the badge preview, and Reconnect Demo comes back here", () => {
    render(
      <SourcePage
        post={{ ...POST, accountStatus: "needs_reconnect" }}
        connectError={undefined}
      />,
    );
    expect(screen.queryByText("Buyers will see:")).toBeNull();
    expect(screen.getByText("Reconnect Demo to verify this post")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Reconnect Demo" }).getAttribute("href"),
    ).toBe(
      `/api/connect/mock/start?returnTo=${encodeURIComponent(`/dashboard/videos/new?post=${POST_ID}`)}`,
    );
    expect(primaryButton()).toBeNull();
  });
});

describe("SourceActions: the states before a press", () => {
  it("already licensable: the info Banner and Open video to the video", () => {
    renderActions({ kind: "already_licensable", videoId: VIDEO_ID });
    expect(screen.getByRole("status").textContent).toBe(
      "This post is already licensable.",
    );
    expect(
      screen.getByRole("link", { name: "Open video" }).getAttribute("href"),
    ).toBe(`/dashboard/videos/${VIDEO_ID}`);
    expect(screen.queryByText("Badge preview")).toBeNull();
    expect(primaryButton()).toBeNull();
  });

  it("private: the line and Upload a file, no badge and no primary", () => {
    renderActions({ kind: "private" });
    expect(
      screen.getByText(
        "Make it public or unlisted on YouTube first, or upload it instead.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Upload a file" }).getAttribute("href"),
    ).toBe("/dashboard/videos/new");
    expect(screen.queryByText("Badge preview")).toBeNull();
    expect(primaryButton()).toBeNull();
  });

  it("an account without a name: the reconnect state, no preview and no Make licensable", () => {
    renderActions(
      sourcePageState({
        video: null,
        visibility: "public",
        accountStatus: "connected",
        accountUsername: null,
        accountDisplayName: null,
      }),
      false,
    );
    expect(screen.queryByText("Buyers will see:")).toBeNull();
    expect(primaryButton()).toBeNull();
    expect(screen.getByRole("link", { name: "Reconnect Demo" })).toBeTruthy();
  });
});

describe("SourceActions: Make licensable's refusals (01 J5.2–J5.4)", () => {
  it("posts the post's id; not on the account: the error Banner with Open Library, announced once, and the primary stays", async () => {
    renderActions({ kind: "ready" });
    await pressRefused("not_on_account");

    expect(makeLicensable).toHaveBeenCalledTimes(1);
    const form = makeLicensable.mock.calls[0]?.[1];
    expect(form?.get("socialPostId")).toBe(POST_ID);
    const message =
      "We couldn't find this post on your Demo account. Sync and try again.";
    expect(screen.getByRole("alert").textContent).toBe(message);
    const banner = screen.getByText(message, { selector: "div" });
    expect(
      within(banner.closest("[data-focus-row]") as HTMLElement)
        .getByRole("link", { name: "Open Library" })
        .getAttribute("href"),
    ).toBe("/dashboard/library");
    expect(primaryButton()).toBeTruthy();
    expect(screen.getByText("Badge preview")).toBeTruthy();
  });

  it("already licensable elsewhere: the Banner, no primary, and the focus moves to the Banner", async () => {
    renderActions({ kind: "ready" });
    await pressRefused("already_licensable_elsewhere");

    expect(primaryButton()).toBeNull();
    const row = document.querySelector("[data-focus-row]");
    expect(row?.textContent).toBe(
      "This post is already licensable from another ClipLease account.",
    );
    expect(document.activeElement).toBe(row);
  });

  it("a live private post: the private line and Upload a file take the primary's place, and the focus", async () => {
    renderActions({ kind: "ready" });
    await pressRefused("not_public");

    expect(primaryButton()).toBeNull();
    expect(screen.queryByText("Badge preview")).toBeNull();
    const upload = screen.getByRole("link", { name: "Upload a file" });
    expect(document.activeElement).toBe(upload);
    expect(screen.getByRole("alert").textContent).toBe(
      "Make it public or unlisted on YouTube first, or upload it instead.",
    );
  });

  it("an account found signed out: the reconnect state, focus on Reconnect Demo", async () => {
    renderActions({ kind: "ready" });
    await pressRefused("needs_reconnect");

    expect(screen.queryByText("Badge preview")).toBeNull();
    const reconnect = screen.getByRole("link", { name: "Reconnect Demo" });
    expect(document.activeElement).toBe(reconnect);
    expect(screen.getByRole("alert").textContent).toBe(
      "Reconnect Demo to verify this post",
    );
  });

  it("a platform failure: the generic line with Make licensable as the retry; a second failure is announced again", async () => {
    renderActions({ kind: "ready" });
    await pressRefused("upstream");
    const first = screen.getByRole("alert");
    expect(first.textContent).toBe("Something went wrong. Try again.");
    expect(primaryButton()).toBeTruthy();

    await pressRefused("upstream");
    expect(makeLicensable).toHaveBeenCalledTimes(2);
    const second = screen.getByRole("alert");
    expect(second.textContent).toBe("Something went wrong. Try again.");
    expect(second).not.toBe(first);
  });
});
