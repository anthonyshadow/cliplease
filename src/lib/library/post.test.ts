import { describe, expect, it } from "vitest";
import {
  captionText,
  type LibraryPostDTO,
  thumbnailAlt,
  thumbnailFailedText,
  tileAction,
  tileHref,
  tileMetaDetails,
  tilePills,
  tileStat,
} from "./post";

const POST: LibraryPostDTO = {
  id: "6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f",
  platform: "mock",
  accountUsername: "demo.creator",
  kind: "video",
  title: null,
  captionExcerpt: "He saw snow for the first time and lost it #dogs #firstsnow",
  permalink: "https://example.com/mock/mock_post_x_01",
  thumbnailSrc: "/api/library/thumbnails/6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f",
  thumbnailVersion: "2026-10-19T10:00:00.000Z",
  width: 720,
  height: 1280,
  postedAt: "2026-10-01T15:00:00.000Z",
  fetchedAt: "2026-10-19T10:00:00.000Z",
  durationSec: 14,
  viewCount: 14_800_000,
  likeCount: 888_000,
  commentCount: 44_400,
  visibility: "public",
  video: null,
};

describe("tile words (04 §9.12)", () => {
  it("post 01's meta line reads as the prompt's proof", () => {
    expect(tileMetaDetails(POST)).toEqual([
      "1 Oct 2026",
      "0:14",
      "14.8M views",
    ]);
  });

  it("Instagram has no duration and shows likes (07 D83 until P28b)", () => {
    expect(
      tileMetaDetails({ ...POST, platform: "instagram", likeCount: 412 }),
    ).toEqual(["1 Oct 2026", "412 likes"]);
  });

  it("one view or like is singular (owner answer Q-29); none leaves the stat out", () => {
    expect(tileStat({ ...POST, viewCount: 1 })).toBe("1 view");
    expect(tileStat({ ...POST, platform: "instagram", likeCount: 1 })).toBe(
      "1 like",
    );
    expect(tileStat({ ...POST, viewCount: 0 })).toBe("0 views");
    expect(tileStat({ ...POST, viewCount: null })).toBeNull();
    expect(
      tileMetaDetails({ ...POST, viewCount: null, durationSec: null }),
    ).toEqual(["1 Oct 2026"]);
  });

  it("the caption, else the title, else '{Platform} video · date' in ink-2", () => {
    expect(captionText(POST)).toEqual({
      text: POST.captionExcerpt,
      fallback: false,
    });
    expect(
      captionText({ ...POST, captionExcerpt: "  ", title: "Fog timelapse" }),
    ).toEqual({ text: "Fog timelapse", fallback: false });
    expect(captionText({ ...POST, captionExcerpt: null })).toEqual({
      text: "Demo video · 1 Oct 2026",
      fallback: true,
    });
  });

  it("alt is empty when the caption names the image", () => {
    expect(thumbnailAlt(POST)).toBe("");
    expect(
      thumbnailAlt({ ...POST, platform: "tiktok", captionExcerpt: null }),
    ).toBe("TikTok video from 1 Oct 2026");
  });

  it("the failed thumbnail names the platform", () => {
    expect(thumbnailFailedText("mock")).toBe("Demo · Sync to refresh");
  });
});

describe("tile destination, action and pills (07 D39, D72)", () => {
  const video = {
    id: "0b7c1e2d-3f4a-4b5c-8d6e-7f8091a2b3c4",
    status: "published" as const,
  };

  it("a post with no video goes to the Source page: Make licensable", () => {
    expect(tileHref(POST)).toBe(`/dashboard/videos/new?post=${POST.id}`);
    expect(tileAction(POST)).toBe("Make licensable");
    expect(tilePills(POST)).toEqual([]);
  });

  it("a licensable post opens its video", () => {
    expect(tileHref({ ...POST, video })).toBe(`/dashboard/videos/${video.id}`);
    expect(tileAction({ ...POST, video })).toBe("Open video");
    expect(tilePills({ ...POST, video })).toEqual(["Licensable"]);
  });

  it("a private post has no Make licensable label but still opens the Source page", () => {
    const priv = { ...POST, visibility: "private" as const };
    expect(tileAction(priv)).toBeNull();
    expect(tileHref(priv)).toBe(`/dashboard/videos/new?post=${POST.id}`);
    expect(tilePills({ ...priv, kind: "short" })).toEqual(["Short", "Private"]);
  });
});
