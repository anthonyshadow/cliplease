// What a social adapter reads, for unit tests: the mock's first account and its posts, as the provider contract types
// them (no NUL anywhere). Shared by the text, sync and registry tests.
import type { SocialPost, SocialProfile } from "../../src/server/social/types";

/** The mock's first account, as getProfile answers it. */
export const DEMO_PROFILE: SocialProfile = {
  platform: "mock",
  externalAccountId: "mock_acct_c4180ab2",
  username: "demo.creator",
  displayName: "Demo Creator",
  avatarUrl: "mock://avatar/01",
  profileUrl: "https://example.com/@demo.creator",
  accountType: "Media_Creator",
  followerCount: 182400,
  postCount: 24,
};

/** Post `n` ("01", "02" …) of that account, with `overrides` applied last. */
export function socialPost(
  n: string,
  overrides: Partial<SocialPost> = {},
): SocialPost {
  const id = `mock_post_c4180ab2_${n}`;
  return {
    platform: "mock",
    externalId: id,
    kind: "video",
    title: null,
    linkKey: id,
    caption: "Morning light over the bay",
    permalink: `https://example.com/mock/${id}`,
    thumbnailUrl: `mock://thumb/${n}`,
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
