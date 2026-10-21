import { describe, expect, it } from "vitest";
import {
  isKeptVideo,
  lostProfessionalAccount,
  refusalReason,
  SOCIAL_CACHE_TTL_DAYS,
  SOCIAL_SYNC_MAX_PAGES,
  SOCIAL_SYNC_MAX_POSTS,
  toSocialPostRow,
} from "./sync";
import type { SocialPost } from "./types";

const NOW = new Date("2026-10-18T12:00:00Z");
const ACCOUNT = {
  id: "11111111-1111-4111-8111-111111111111",
  creatorId: "22222222-2222-4222-8222-222222222222",
  provider: "mock",
} as const;

function post(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    platform: "mock",
    externalId: "mock_post_c4180ab2_01",
    kind: "video",
    title: null,
    linkKey: "mock_post_c4180ab2_01",
    caption: "Morning light over the bay",
    permalink: "https://example.com/mock/mock_post_c4180ab2_01",
    thumbnailUrl: "mock://thumb/01",
    thumbnailExpiresAt: null,
    publishedAt: new Date("2026-10-01T15:00:00Z"),
    durationSec: 14,
    width: 720,
    height: 1280,
    viewCount: 1200,
    likeCount: 80,
    commentCount: 4,
    shareCount: null,
    visibility: "public",
    ...overrides,
  };
}

describe("sync constants (02 §10, OQ-16)", () => {
  it("keeps 200 posts, reads 10 pages and hides posts after 30 days", () => {
    expect(SOCIAL_SYNC_MAX_POSTS).toBe(200);
    expect(SOCIAL_SYNC_MAX_PAGES).toBe(10);
    expect(SOCIAL_CACHE_TTL_DAYS).toBe(30);
  });
});

describe("toSocialPostRow (03 DB1, 07 D68)", () => {
  it("maps the DTO to columns, with the account's ids and one clock", () => {
    expect(toSocialPostRow(ACCOUNT, post(), NOW)).toEqual({
      socialAccountId: ACCOUNT.id,
      creatorId: ACCOUNT.creatorId,
      provider: "mock",
      providerPostId: "mock_post_c4180ab2_01",
      linkKey: "mock_post_c4180ab2_01",
      mediaType: "video",
      visibility: "public",
      title: null,
      caption: "Morning light over the bay",
      permalink: "https://example.com/mock/mock_post_c4180ab2_01",
      thumbnailUrl: "mock://thumb/01",
      thumbnailExpiresAt: null,
      thumbnailFetchedAt: NOW,
      postedAt: new Date("2026-10-01T15:00:00Z"),
      durationSec: 14,
      width: 720,
      height: 1280,
      viewCount: 1200,
      likeCount: 80,
      commentCount: 4,
      shareCount: null,
      status: "available",
      removedAt: null,
      fetchedAt: NOW,
    });
  });

  it("keeps the link key the adapter gives (an Instagram shortcode, not the post id)", () => {
    const row = toSocialPostRow(
      { ...ACCOUNT, provider: "instagram" },
      post({ platform: "instagram", externalId: "1789", linkKey: "DAbc_12" }),
      NOW,
    );
    expect(row).toMatchObject({
      provider: "instagram",
      providerPostId: "1789",
      linkKey: "DAbc_12",
    });
  });

  it("cuts a caption to 500 characters without splitting one", () => {
    const long = `${"a".repeat(499)}🎬🎬`;
    const caption = toSocialPostRow(
      ACCOUNT,
      post({ caption: long }),
      NOW,
    ).caption;
    expect(Array.from(caption ?? "")).toHaveLength(500);
    expect(caption?.endsWith("a🎬")).toBe(true);
    expect(
      toSocialPostRow(ACCOUNT, post({ caption: null }), NOW).caption,
    ).toBeNull();
  });

  it("drops NUL bytes from the title and the caption before the cut, and a thumbnail URL that holds one", () => {
    const row = toSocialPostRow(
      ACCOUNT,
      post({
        title: "Bay\u0000",
        caption: `${"\u0000".repeat(10)}${"a".repeat(500)}`,
        thumbnailUrl: "mock://thumb/\u000001",
      }),
      NOW,
    );
    expect(row.title).toBe("Bay");
    expect(row.caption).toBe("a".repeat(500));
    expect(row.thumbnailUrl).toBeNull();
  });
});

describe("refusalReason (02 §7.5 step 1)", () => {
  it("refuses a missing or disconnected account, one that must reconnect, and one still blocked", () => {
    expect(refusalReason(undefined)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(refusalReason({ status: "disconnected", blockedSec: null })).toEqual(
      { ok: false, reason: "not_found" },
    );
    expect(
      refusalReason({ status: "needs_reconnect", blockedSec: 30 }),
    ).toEqual({ ok: false, reason: "needs_reconnect" });
    expect(refusalReason({ status: "connected", blockedSec: 30 })).toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterSec: 30,
    });
  });

  it("lets a connected account sync once its block has passed", () => {
    expect(refusalReason({ status: "connected", blockedSec: null })).toBeNull();
    expect(refusalReason({ status: "connected", blockedSec: 0 })).toBeNull();
    expect(refusalReason({ status: "connected", blockedSec: -5 })).toBeNull();
  });
});

describe("isKeptVideo", () => {
  it("keeps videos, reels and shorts only", () => {
    for (const kind of ["video", "reel", "short"] as const) {
      expect(isKeptVideo(post({ kind }))).toBe(true);
    }
    for (const kind of ["image", "carousel", "story", "", "VIDEO"]) {
      expect(isKeptVideo({ kind })).toBe(false);
    }
  });
});

describe("lostProfessionalAccount (07 D13)", () => {
  it("is true only for an Instagram account that isn't Business or Media_Creator", () => {
    expect(lostProfessionalAccount("instagram", "Business")).toBe(false);
    expect(lostProfessionalAccount("instagram", "Media_Creator")).toBe(false);
    expect(lostProfessionalAccount("instagram", "Personal")).toBe(true);
    expect(lostProfessionalAccount("instagram", null)).toBe(true);
    for (const p of ["tiktok", "youtube", "mock"] as const) {
      expect(lostProfessionalAccount(p, null)).toBe(false);
    }
  });
});
