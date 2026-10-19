import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_SOCIAL_SCENARIOS } from "../../env";
import { SocialAuthError, SocialRateLimitError } from "../errors";
import { createPkcePair } from "../pkce";
import type { TokenSet } from "../types";
import {
  currentMockScenario,
  mockAccountIdFor,
  mockProvider,
  mockTokensFor,
  setMockScenarioForTests,
} from "./mock";
import { MOCK_POSTS, MOCK_THUMB_TONES, mockThumbnailSvg } from "./mock-data";

const REDIRECT = "http://localhost:3100/api/connect/mock/callback";

/** The code the mock's authorize step hands back for `userId`. */
function authorizeCode(userId: string, challenge: string, second = false) {
  const url = mockProvider.getAuthorizeUrl({
    state: "s".repeat(43),
    codeChallenge: challenge,
    redirectUri: REDIRECT,
    forceAccountChoice: second,
    mockSubject: userId,
  });
  return url.searchParams.get("code") as string;
}

/** The full authorize → exchange round trip for `userId`, as the routes run it. */
async function connect(userId: string, second = false): Promise<TokenSet> {
  const { verifier, challenge } = createPkcePair();
  return mockProvider.exchangeCode({
    code: authorizeCode(userId, challenge, second),
    codeVerifier: verifier,
    redirectUri: REDIRECT,
  });
}

async function profileOf(userId: string, second = false) {
  return mockProvider.getProfile((await connect(userId, second)).accessToken);
}

/** Post `nn` of `userId`'s own account. */
const postIdOf = (userId: string, nn: string) =>
  `mock_post_${mockAccountIdFor(userId).slice("mock_acct_".length)}_${nn}`;

afterEach(() => setMockScenarioForTests(null));

describe("identity (07 D36)", () => {
  it("gives one user the same account, another user a different one", async () => {
    const a1 = await profileOf("user-a");
    const a2 = await profileOf("user-a");
    const b = await profileOf("user-b");
    expect(a1.externalAccountId).toBe(a2.externalAccountId);
    expect(a1.externalAccountId).not.toBe(b.externalAccountId);
    expect(a1.externalAccountId).toBe(mockAccountIdFor("user-a"));
    expect(a1).toMatchObject({
      platform: "mock",
      username: "demo.creator",
      displayName: "Demo Creator",
      avatarUrl: "mock://avatar/01",
      profileUrl: "https://example.com/@demo.creator",
      accountType: "Media_Creator",
      followerCount: 182400,
      postCount: 24,
    });
  });

  it("keys the seed user as P09 expects, and the switch gives a second account", async () => {
    expect(mockAccountIdFor("seed_user_maya")).toBe("mock_acct_c4180ab2");
    expect(
      createHash("sha256").update("seed_user_maya").digest("hex").slice(0, 8),
    ).toBe("c4180ab2");
    const second = await profileOf("user-a", true);
    expect(second.externalAccountId).toBe(mockAccountIdFor("user-a", true));
    expect(second).toMatchObject({
      username: "demo.creator.2",
      displayName: "Demo Creator 2",
      avatarUrl: "mock://avatar/02",
    });
  });

  it("builds the tokens it issues for a user, which it then accepts", async () => {
    const seed = mockTokensFor("seed_user_maya", "seed");
    expect(seed).toMatchObject({
      accessToken: "mock_access_c4180ab2_seed",
      refreshToken: "mock_refresh_c4180ab2_seed",
      scopes: ["mock.read"],
    });
    expect(
      (await mockProvider.getProfile(seed.accessToken)).externalAccountId,
    ).toBe("mock_acct_c4180ab2");
    const second = mockTokensFor("user-a", "t1", { second: true });
    expect(
      (await mockProvider.getProfile(second.accessToken)).externalAccountId,
    ).toBe(mockAccountIdFor("user-a", true));
    const expiry = new Date("2026-01-01T00:00:00Z");
    expect(
      mockTokensFor("user-a", "t1", { accessTokenExpiresAt: expiry })
        .accessTokenExpiresAt,
    ).toBe(expiry);
  });

  it("parses the seed's token values", async () => {
    const profile = await mockProvider.getProfile("mock_access_c4180ab2_seed");
    expect(profile.externalAccountId).toBe("mock_acct_c4180ab2");
    const refreshed = await mockProvider.refreshToken({
      accessToken: "mock_access_c4180ab2_seed",
      accessTokenExpiresAt: null,
      refreshToken: "mock_refresh_c4180ab2_seed",
      refreshTokenExpiresAt: null,
      scopes: ["mock.read"],
    });
    expect(refreshed.accessToken).toMatch(
      /^mock_access_c4180ab2_[0-9a-f]{16}$/,
    );
  });

  it("refuses a PKCE mismatch, a bad code and a token of the wrong kind", async () => {
    const code = authorizeCode("user-a", createPkcePair().challenge);
    expect(code).toMatch(/^mock_code_[0-9a-f]{8}\.[A-Za-z0-9_-]{43}$/);
    await expect(
      mockProvider.exchangeCode({
        code,
        codeVerifier: createPkcePair().verifier,
        redirectUri: REDIRECT,
      }),
    ).rejects.toBeInstanceOf(SocialAuthError);
    await expect(
      mockProvider.exchangeCode({
        code: "x",
        codeVerifier: null,
        redirectUri: REDIRECT,
      }),
    ).rejects.toBeInstanceOf(SocialAuthError);
    const tokens = await connect("user-a");
    await expect(
      mockProvider.getProfile(tokens.refreshToken as string),
    ).rejects.toBeInstanceOf(SocialAuthError);
    expect(tokens).toMatchObject({ scopes: ["mock.read"] });
    expect(tokens.accessToken).not.toContain("user-a");
  });
});

describe("posts", () => {
  it("lists 24 videos newest first over two pages", async () => {
    const { accessToken } = await connect("user-a");
    const first = await mockProvider.listPosts(accessToken, { cursor: null });
    expect(first.posts).toHaveLength(12);
    expect(first.nextCursor).toBe("12");
    const second = await mockProvider.listPosts(accessToken, { cursor: "12" });
    expect(second.posts).toHaveLength(12);
    expect(second.nextCursor).toBeNull();
    const all = [...first.posts, ...second.posts];
    expect(all.map((p) => p.externalId.slice(-2))).toEqual(
      MOCK_POSTS.map((row) => String(row.n).padStart(2, "0")),
    );
    for (const post of all) {
      expect(post.permalink).toBe(
        `https://example.com/mock/${post.externalId}`,
      );
      expect(post.linkKey).toBe(post.externalId);
      expect(post).toMatchObject({
        kind: "video",
        visibility: "public",
        shareCount: null,
      });
    }
    expect(all[0]).toMatchObject({ durationSec: 14, width: 720, height: 1280 });
  });

  it("filters by `before`", async () => {
    const { accessToken } = await connect("user-a");
    const twelve = MOCK_POSTS[11];
    const { posts } = await mockProvider.listPosts(accessToken, {
      cursor: null,
      before: new Date(twelve?.publishedAt as string),
    });
    expect(posts[0]?.externalId).toMatch(/_13$/);
    expect(posts).toHaveLength(12);
  });

  it("finds a post by its link key for its own account only", async () => {
    const a = await connect("user-a");
    const b = await connect("user-b");
    const accountA = mockAccountIdFor("user-a");
    const id = postIdOf("user-a", "05");
    const post = await mockProvider.findPostByLinkKey(
      a.accessToken,
      id,
      accountA,
    );
    expect(post?.externalId).toBe(id);
    expect(
      await mockProvider.findPostByLinkKey(b.accessToken, id, accountA),
    ).toBeNull();
    expect(
      await mockProvider.findPostByLinkKey(
        a.accessToken,
        id,
        mockAccountIdFor("user-b"),
      ),
    ).toBeNull();
    expect(
      await mockProvider.getPosts(a.accessToken, [id, id, "nope"]),
    ).toHaveLength(1);
  });
});

describe("scenarios (07 D36)", () => {
  it("lists exactly the eight P01 scenarios", () => {
    expect(MOCK_SOCIAL_SCENARIOS).toEqual([
      "default",
      "empty",
      "expired",
      "rate_limited",
      "post_removed",
      "shared_account",
      "rotating_refresh",
      "pinned_old_post",
    ]);
    expect(currentMockScenario()).toBe("default");
  });

  it("empty: no posts and a post count of 0", async () => {
    const { accessToken } = await connect("user-a");
    setMockScenarioForTests("empty");
    expect(
      (await mockProvider.listPosts(accessToken, { cursor: null })).posts,
    ).toEqual([]);
    expect((await mockProvider.getProfile(accessToken)).postCount).toBe(0);
  });

  it("expired: refresh and listing need a reconnect", async () => {
    const tokens = await connect("user-a");
    setMockScenarioForTests("expired");
    await expect(mockProvider.refreshToken(tokens)).rejects.toBeInstanceOf(
      SocialAuthError,
    );
    await expect(
      mockProvider.listPosts(tokens.accessToken, { cursor: null }),
    ).rejects.toBeInstanceOf(SocialAuthError);
  });

  it("rate_limited: listing waits 15 minutes", async () => {
    const { accessToken } = await connect("user-a");
    setMockScenarioForTests("rate_limited");
    const error = await mockProvider
      .listPosts(accessToken, { cursor: null })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SocialRateLimitError);
    expect((error as SocialRateLimitError).retryAfterSec).toBe(900);
  });

  it("post_removed: post 05 is gone from the list and from getPost", async () => {
    const { accessToken } = await connect("user-a");
    setMockScenarioForTests("post_removed");
    const account = mockAccountIdFor("user-a");
    const page = await mockProvider.listPosts(accessToken, { cursor: null });
    expect(page.posts.some((p) => p.externalId.endsWith("_05"))).toBe(false);
    expect(
      await mockProvider.getPost(
        accessToken,
        postIdOf("user-a", "05"),
        account,
      ),
    ).toBeNull();
  });

  it("shared_account: every user connects the same account", async () => {
    setMockScenarioForTests("shared_account");
    const a = await profileOf("user-a");
    const b = await profileOf("user-b", true);
    expect(a.externalAccountId).toBe("mock_acct_shared");
    expect(b.externalAccountId).toBe("mock_acct_shared");
  });

  it("rotating_refresh: a refresh token works once", async () => {
    const tokens = await connect("user-a");
    setMockScenarioForTests("rotating_refresh");
    const next = await mockProvider.refreshToken(tokens);
    await expect(mockProvider.refreshToken(tokens)).rejects.toBeInstanceOf(
      SocialAuthError,
    );
    await expect(mockProvider.refreshToken(next)).resolves.toMatchObject({
      scopes: ["mock.read"],
    });
  });

  it("pinned_old_post: post 24 never lists, but getPost still finds it", async () => {
    const { accessToken } = await connect("user-a");
    setMockScenarioForTests("pinned_old_post");
    const account = mockAccountIdFor("user-a");
    const second = await mockProvider.listPosts(accessToken, { cursor: "12" });
    expect(second.posts.some((p) => p.externalId.endsWith("_24"))).toBe(false);
    expect(
      await mockProvider.getPost(
        accessToken,
        postIdOf("user-a", "24"),
        account,
      ),
    ).not.toBeNull();
  });

  it("default: revoke reports revoked", async () => {
    expect(await mockProvider.revoke(await connect("user-a"))).toBe("revoked");
  });

  it("switches scenarios only in test runs", async () => {
    vi.resetModules();
    vi.stubEnv("APP_ENV", "development");
    try {
      const fresh = await import("./mock");
      expect(() => fresh.setMockScenarioForTests("empty")).toThrow(
        /APP_ENV is test/,
      );
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});

describe("mockThumbnailSvg (04 §2.5)", () => {
  it("draws a solid tone with the number centered, cycling through six tones", () => {
    const svg = mockThumbnailSvg(7, 720, 1280);
    expect(svg).toContain(">07<");
    expect(svg).toContain(MOCK_THUMB_TONES[0].bg);
    expect(svg).not.toMatch(/gradient|<image|<script|style=/i);
    expect(mockThumbnailSvg(6, 10, 10)).toContain(MOCK_THUMB_TONES[5].bg);
  });

  it("refuses a number outside 1 to 99 and a bad size", () => {
    expect(() => mockThumbnailSvg(0, 10, 10)).toThrow(RangeError);
    expect(() => mockThumbnailSvg(100, 10, 10)).toThrow(RangeError);
    expect(() => mockThumbnailSvg(1, 0, 10)).toThrow(RangeError);
  });
});
