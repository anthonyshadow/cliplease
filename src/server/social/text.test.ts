import { afterEach, describe, expect, it, vi } from "vitest";
import { captureLogEvents } from "../../../tests/helpers/logs";
import {
  DEMO_PROFILE,
  socialPost,
} from "../../../tests/helpers/social-fixtures";
import { SocialUpstreamError } from "./errors";
import { mockProvider } from "./providers/mock";
import { withCleanReads } from "./text";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withCleanReads (03 DB1)", () => {
  const broken = socialPost("02", {
    externalId: "mock_post_c4180ab2_02\u0000",
  });

  it("cleans the profile: drops NUL bytes from the text, a URL that holds one, and keeps the rest", async () => {
    const reads = withCleanReads(mockProvider);
    vi.spyOn(mockProvider, "getProfile").mockResolvedValue({
      ...DEMO_PROFILE,
      username: "demo\u0000creator\u0000",
      displayName: "\u0000Demo",
      avatarUrl: "mock://avatar/\u000001",
      profileUrl: "https://example.com/\u0000",
      accountType: "Media\u0000_Creator",
    });
    expect(await reads.getProfile("t")).toEqual({
      ...DEMO_PROFILE,
      username: "democreator",
      displayName: "Demo",
      avatarUrl: null,
      profileUrl: null,
      accountType: "Media_Creator",
    });
    const empty = {
      ...DEMO_PROFILE,
      username: null,
      displayName: null,
      avatarUrl: null,
      profileUrl: null,
      accountType: null,
    };
    for (const profile of [DEMO_PROFILE, empty]) {
      vi.spyOn(mockProvider, "getProfile").mockResolvedValue(profile);
      expect(await reads.getProfile("t")).toEqual(profile);
    }
  });

  it("fails before any write when the profile's account id holds a NUL: it can't be stored", async () => {
    vi.spyOn(mockProvider, "getProfile").mockResolvedValue({
      ...DEMO_PROFILE,
      externalAccountId: "mock_acct_\u0000",
    });
    await expect(
      withCleanReads(mockProvider).getProfile("t"),
    ).rejects.toBeInstanceOf(SocialUpstreamError);
  });

  it("cleans a listing's title, caption and thumbnail URL, and leaves out a post whose id, link key or permalink holds a NUL, logged by count only", async () => {
    const unusable = (["externalId", "linkKey", "permalink"] as const).map(
      (field) => socialPost("02", { [field]: "x\u0000" }),
    );
    vi.spyOn(mockProvider, "listPosts").mockResolvedValue({
      posts: [
        socialPost("01", {
          title: "Bay\u0000",
          caption: `${"\u0000".repeat(10)}${"a".repeat(500)}`,
          thumbnailUrl: "mock://thumb/\u000001",
        }),
        ...unusable,
        socialPost("03"),
      ],
      nextCursor: "3",
    });
    const logs = captureLogEvents("social.post_skipped");
    const listing = await withCleanReads(mockProvider).listPosts("t", {
      cursor: null,
    });
    const { written, events } = logs();
    expect(listing).toEqual({
      posts: [
        socialPost("01", {
          title: "Bay",
          caption: "a".repeat(500),
          thumbnailUrl: null,
        }),
        socialPost("03"),
      ],
      nextCursor: "3",
    });
    expect(events).toEqual([
      expect.objectContaining({ level: "warn", provider: "mock", count: 3 }),
    ]);
    expect(written).not.toContain("mock_post_");
  });

  it("does the same for a batch of posts, and logs nothing when every post is usable", async () => {
    vi.spyOn(mockProvider, "getPosts").mockResolvedValue([
      broken,
      socialPost("03", { caption: "\u0000" }),
    ]);
    const logs = captureLogEvents("social.post_skipped");
    expect(await withCleanReads(mockProvider).getPosts("t", [])).toEqual([
      socialPost("03", { caption: "" }),
    ]);
    expect(logs().events).toHaveLength(1);

    vi.spyOn(mockProvider, "getPosts").mockResolvedValue([socialPost("03")]);
    const none = captureLogEvents("social.post_skipped");
    expect(await withCleanReads(mockProvider).getPosts("t", [])).toEqual([
      socialPost("03"),
    ]);
    expect(none().events).toEqual([]);
  });

  it("fails a lookup by id whose post can't be stored rather than answering null, which means gone", async () => {
    const reads = withCleanReads(mockProvider);
    vi.spyOn(mockProvider, "getPost").mockResolvedValue(broken);
    await expect(reads.getPost("t", "id", "acct")).rejects.toBeInstanceOf(
      SocialUpstreamError,
    );
    vi.spyOn(mockProvider, "findPostByLinkKey").mockResolvedValue(broken);
    await expect(
      reads.findPostByLinkKey("t", "key", "acct"),
    ).rejects.toBeInstanceOf(SocialUpstreamError);

    vi.spyOn(mockProvider, "getPost").mockResolvedValue(null);
    expect(await reads.getPost("t", "id", "acct")).toBeNull();
    vi.spyOn(mockProvider, "findPostByLinkKey").mockResolvedValue(
      socialPost("01", { caption: "a\u0000" }),
    );
    expect(await reads.findPostByLinkKey("t", "key", "acct")).toEqual(
      socialPost("01", { caption: "a" }),
    );
  });

  it("passes the arguments on and leaves everything else to the adapter, read at each use", async () => {
    const reads = withCleanReads(mockProvider);
    const getPost = vi.spyOn(mockProvider, "getPost").mockResolvedValue(null);
    await reads.getPost("t", "id", "acct");
    expect(getPost).toHaveBeenCalledWith("t", "id", "acct");
    const list = vi
      .spyOn(mockProvider, "listPosts")
      .mockResolvedValue({ posts: [], nextCursor: null });
    const before = new Date("2026-10-01T00:00:00Z");
    await reads.listPosts("t", { cursor: "12", before });
    expect(list).toHaveBeenCalledWith("t", { cursor: "12", before });

    expect(reads.platform).toBe("mock");
    expect(reads.requiredScopes).toBe(mockProvider.requiredScopes);
    expect(reads.capabilities).toBe(mockProvider.capabilities);
    const revoke = vi
      .spyOn(mockProvider, "revoke")
      .mockResolvedValue("unsupported");
    const tokens = {
      accessToken: "a",
      accessTokenExpiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      scopes: [],
    };
    expect(await reads.revoke(tokens)).toBe("unsupported");
    expect(revoke).toHaveBeenCalledWith(tokens);
  });
});
