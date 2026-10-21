import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { PLATFORM_LABELS } from "../../../lib/brand";
import { DAY_MS, HOUR_MS } from "../../../lib/time";
import { env, type MockSocialScenario } from "../../env";
import {
  SocialAuthError,
  SocialRateLimitError,
  SocialUpstreamError,
} from "../errors";
import { pkceChallenge } from "../pkce";
import type { SocialPost, SocialProvider, TokenSet } from "../types";
import { MOCK_POSTS, type MockPostRow } from "./mock-data";

// The Demo provider (07 D36, amended by D53 and D68): a real start → callback round trip with no platform keys. Each
// user gets their own account, keyed by the first 8 hex of sha256(user id), plus "_2" for "Connect another account";
// the shared_account scenario gives everyone one account. The suffix travels in the code and the tokens, so every later
// call knows the account (owner answer Q1 a). Never enabled outside development and test (07 D51, env.ts).

const PAGE_SIZE = 12;
const RATE_LIMIT_RETRY_SEC = 900; // "Try again in 15 min." (01 J2.13)
const SHARED = "shared";
const SUFFIX = "([0-9a-f]{8}(?:_2)?|shared)";
const CODE_RE = new RegExp(`^mock_code_${SUFFIX}\\.([A-Za-z0-9_-]{43})$`);
const TOKEN_RE = new RegExp(`^mock_(access|refresh)_${SUFFIX}_([a-z0-9]+)$`);
const POST_RE = new RegExp(`^mock_post_${SUFFIX}_(\\d{2})$`);

let scenarioOverride: MockSocialScenario | null = null;
// rotating_refresh: refresh tokens already used, which the next refresh refuses.
const usedRefreshTokens = new Set<string>();

/** The scenario for this call: a test override, else MOCK_SOCIAL_SCENARIO. */
export function currentMockScenario(): MockSocialScenario {
  return scenarioOverride ?? env.MOCK_SOCIAL_SCENARIO;
}

/** Switches the scenario for the following calls (null: back to the env's); test runs only. */
export function setMockScenarioForTests(s: MockSocialScenario | null): void {
  if (env.APP_ENV !== "test") {
    throw new Error("setMockScenarioForTests runs only when APP_ENV is test");
  }
  scenarioOverride = s;
  usedRefreshTokens.clear();
}

/** A user's own account suffix: the first 8 hex of sha256(user id), plus "_2" for the second account. */
const ownSuffix = (userId: string, second: boolean) =>
  `${createHash("sha256").update(userId).digest("hex").slice(0, 8)}${second ? "_2" : ""}`;

const accountIdOf = (suffix: string) => `mock_acct_${suffix}`;

/** The Demo account id for a user, as the provider reports it (the P09 seed: seed_user_maya → mock_acct_c4180ab2). */
export function mockAccountIdFor(userId: string, second = false): string {
  return accountIdOf(ownSuffix(userId, second));
}

function suffixFor(userId: string, second: boolean): string {
  return currentMockScenario() === "shared_account"
    ? SHARED
    : ownSuffix(userId, second);
}

function tokenSuffix(token: string | null, kind: "access" | "refresh"): string {
  const match = token ? TOKEN_RE.exec(token) : null;
  if (!match || match[1] !== kind) throw new SocialAuthError();
  return match[2] as string;
}

const nonce = () => randomBytes(8).toString("hex");

/** A token set in the mock's format: the access token lasts an hour unless `accessTokenExpiresAt` says otherwise. */
function tokenSet(
  suffix: string,
  tags: { access: string; refresh: string },
  accessTokenExpiresAt = new Date(Date.now() + HOUR_MS),
): TokenSet {
  return {
    accessToken: `mock_access_${suffix}_${tags.access}`,
    accessTokenExpiresAt,
    refreshToken: `mock_refresh_${suffix}_${tags.refresh}`,
    refreshTokenExpiresAt: new Date(Date.now() + 30 * DAY_MS),
    scopes: ["mock.read"],
  };
}

const tokenPair = (suffix: string, scopes: string[]): TokenSet => ({
  ...tokenSet(suffix, { access: nonce(), refresh: nonce() }),
  scopes,
});

/**
 * Tokens the mock accepts for `userId`'s Demo account, as an exchange would issue them (`tag` in place of the random
 * part): for the P09 seed and tests, which seal them with sealTokenColumns.
 */
export function mockTokensFor(
  userId: string,
  tag: string,
  opts: { second?: boolean; accessTokenExpiresAt?: Date } = {},
): TokenSet {
  return tokenSet(
    ownSuffix(userId, opts.second ?? false),
    { access: tag, refresh: tag },
    opts.accessTokenExpiresAt,
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A mock post's canonical URL, made from its id alone (07 D68): what the sync stores as its permalink. */
export const mockPermalink = (externalId: string) =>
  `https://example.com/mock/${externalId}`;

function toPost(suffix: string, row: MockPostRow): SocialPost {
  const externalId = `mock_post_${suffix}_${pad(row.n)}`;
  return {
    platform: "mock",
    externalId,
    kind: "video",
    title: null,
    linkKey: externalId,
    caption: row.caption,
    permalink: mockPermalink(externalId),
    thumbnailUrl: `mock://thumb/${pad(row.n)}`,
    thumbnailExpiresAt: null,
    publishedAt: new Date(row.publishedAt),
    durationSec: row.durationSec,
    width: row.width,
    height: row.height,
    viewCount: row.views,
    likeCount: row.likes,
    commentCount: row.comments,
    shareCount: null,
    visibility: "public",
  };
}

/** Whether post `n` exists under the current scenario: empty has none, post_removed drops 05. */
function exists(n: number): boolean {
  const scenario = currentMockScenario();
  return scenario !== "empty" && !(scenario === "post_removed" && n === 5);
}

/** The posts listPosts shows: pinned_old_post also leaves 24 out of the list, though getPost still finds it. */
function listedRows(): readonly MockPostRow[] {
  const pinned = currentMockScenario() === "pinned_old_post";
  return MOCK_POSTS.filter((row) => exists(row.n) && !(pinned && row.n === 24));
}

function findableRow(n: number): MockPostRow | null {
  return exists(n) ? (MOCK_POSTS.find((row) => row.n === n) ?? null) : null;
}

function postForAccount(suffix: string, externalId: string): SocialPost | null {
  const match = POST_RE.exec(externalId);
  if (!match || match[1] !== suffix) return null;
  const row = findableRow(Number(match[2]));
  return row ? toPost(suffix, row) : null;
}

export const mockProvider: SocialProvider = {
  platform: "mock",
  label: PLATFORM_LABELS.mock,
  capabilities: {
    usesPkce: true,
    canRevoke: true,
    hasDurations: true,
    stats: ["views", "likes", "comments"],
    thumbnailsExpire: false,
  },
  requiredScopes: ["mock.read"],
  optionalScopes: [],
  thumbnailHosts: [],
  thumbnailTtlMs: null,

  getAuthorizeUrl(i) {
    if (!i.mockSubject || !i.codeChallenge) {
      throw new Error("the mock needs mockSubject and a PKCE challenge");
    }
    // No consent screen: straight back to our callback.
    const url = new URL(i.redirectUri);
    const suffix = suffixFor(i.mockSubject, i.forceAccountChoice === true);
    url.searchParams.set("code", `mock_code_${suffix}.${i.codeChallenge}`);
    url.searchParams.set("state", i.state);
    return url;
  },

  async exchangeCode({ code, codeVerifier }) {
    const match = CODE_RE.exec(code);
    if (!match || !codeVerifier || pkceChallenge(codeVerifier) !== match[2]) {
      throw new SocialAuthError();
    }
    return tokenPair(match[1] as string, ["mock.read"]);
  },

  async refreshToken(t, { signal }) {
    if (signal.aborted) throw new SocialUpstreamError();
    const suffix = tokenSuffix(t.refreshToken, "refresh");
    const scenario = currentMockScenario();
    if (scenario === "expired") throw new SocialAuthError();
    if (scenario === "rotating_refresh") {
      const used = t.refreshToken as string;
      if (usedRefreshTokens.has(used)) throw new SocialAuthError();
      usedRefreshTokens.add(used);
    }
    return tokenPair(suffix, t.scopes);
  },

  async revoke() {
    return "revoked";
  },

  async getProfile(accessToken) {
    const suffix = tokenSuffix(accessToken, "access");
    const second = suffix.endsWith("_2");
    return {
      platform: "mock",
      externalAccountId: accountIdOf(suffix),
      username: second ? "demo.creator.2" : "demo.creator",
      displayName: second ? "Demo Creator 2" : "Demo Creator",
      avatarUrl: second ? "mock://avatar/02" : "mock://avatar/01",
      profileUrl: "https://example.com/@demo.creator",
      accountType: "Media_Creator",
      followerCount: 182400,
      postCount: currentMockScenario() === "empty" ? 0 : MOCK_POSTS.length,
    };
  },

  async listPosts(accessToken, { cursor, before, pageSize = PAGE_SIZE }) {
    const suffix = tokenSuffix(accessToken, "access");
    const scenario = currentMockScenario();
    if (scenario === "expired") throw new SocialAuthError();
    if (scenario === "rate_limited") {
      throw new SocialRateLimitError(RATE_LIMIT_RETRY_SEC);
    }
    const rows = listedRows().filter(
      (row) => !before || new Date(row.publishedAt) < before,
    );
    const start = cursor === null ? 0 : Number(cursor);
    if (!Number.isInteger(start) || start < 0) {
      throw new Error("mock listPosts: the cursor is not a post index");
    }
    const size = Math.min(Math.max(Math.trunc(pageSize), 1), PAGE_SIZE);
    const end = start + size;
    return {
      posts: rows.slice(start, end).map((row) => toPost(suffix, row)),
      nextCursor: end < rows.length ? String(end) : null,
    };
  },

  async getPost(accessToken, externalId, externalAccountId) {
    const suffix = tokenSuffix(accessToken, "access");
    if (accountIdOf(suffix) !== externalAccountId) return null;
    return postForAccount(suffix, externalId);
  },

  async findPostByLinkKey(accessToken, linkKey, externalAccountId) {
    // The mock's link key is its post id (07 D68).
    return mockProvider.getPost(accessToken, linkKey, externalAccountId);
  },

  async getPosts(accessToken, externalIds) {
    const suffix = tokenSuffix(accessToken, "access");
    return [...new Set(externalIds)]
      .map((id) => postForAccount(suffix, id))
      .filter((post): post is SocialPost => post !== null);
  },
};
