import "server-only";
import type {
  SocialPostMediaType,
  SocialPostVisibility,
  SocialProviderId,
} from "../../lib/domain/values";

// The provider contract (02 §5.3, research/social.md §7.1), with 07 D68 (findPostByLinkKey, SocialPost.linkKey) and D83
// (optionalScopes, extraScopes). One P06 deviation (owner answer Q1 a): getAuthorizeUrl's optional `mockSubject`.
// statsFor arrives with Instagram views (P28b). Relative imports: the P09 seed loads the mock under tsx.

export type SocialPostKind = SocialPostMediaType; // 'video' | 'reel' | 'short'
export type PostVisibility = SocialPostVisibility; // 'public' | 'unlisted' | 'private'

export interface TokenSet {
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
  scopes: string[];
}

export interface SocialProfile {
  platform: SocialProviderId;
  externalAccountId: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  accountType: string | null;
  followerCount: number | null;
  postCount: number | null;
}

export interface SocialPost {
  platform: SocialProviderId;
  externalId: string;
  kind: SocialPostKind;
  title: string | null;
  /** IG shortcode (from the permalink), else the externalId (07 D68). */
  linkKey: string;
  caption: string | null;
  permalink: string;
  thumbnailUrl: string | null;
  thumbnailExpiresAt: Date | null;
  publishedAt: Date;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  visibility: PostVisibility | null;
}

export interface ListPostsInput {
  cursor: string | null;
  before?: Date;
  pageSize?: number;
}

export interface ListPostsResult {
  posts: SocialPost[];
  nextCursor: string | null;
}

export interface ProviderCapabilities {
  usesPkce: boolean;
  canRevoke: boolean;
  hasDurations: boolean;
  stats: ReadonlyArray<"views" | "likes" | "comments" | "shares">;
  thumbnailsExpire: boolean;
}

export interface AuthorizeUrlInput {
  state: string;
  codeChallenge: string | null;
  redirectUri: string;
  /** Start route ?switch=1 (07 D41): pick another account on the platform. */
  forceAccountChoice?: boolean;
  /** ⊆ optionalScopes; start route ?insights=1 (07 D83). */
  extraScopes?: readonly string[];
  /** The signed-in user's id, for the mock only (owner answer Q1 a): real adapters ignore it and never send it. */
  mockSubject?: string;
}

/** What a revoke at the platform came to; `failed` when it was possible but didn't happen. */
export type RevokeOutcome = "revoked" | "unsupported" | "failed";

export interface SocialProvider {
  readonly platform: SocialProviderId;
  /** "Instagram" | "TikTok" | "YouTube" | "Demo" */
  readonly label: string;
  readonly capabilities: ProviderCapabilities;
  /** The callback refuses a connect that didn't grant all of them. */
  readonly requiredScopes: readonly string[];
  /** Instagram: views (07 D83); every other provider: none. */
  readonly optionalScopes: readonly string[];
  /** The thumbnail proxy's fixed host allowlist (07 D42); the mock has none (mock:// URLs). */
  readonly thumbnailHosts: readonly string[];
  readonly thumbnailTtlMs: number | null;
  getAuthorizeUrl(i: AuthorizeUrlInput): URL;
  exchangeCode(i: {
    code: string;
    codeVerifier: string | null;
    redirectUri: string;
  }): Promise<TokenSet>;
  /** Throws SocialAuthError when the user must reconnect. */
  refreshToken(t: TokenSet): Promise<TokenSet>;
  revoke(t: TokenSet): Promise<"revoked" | "unsupported">;
  getProfile(accessToken: string): Promise<SocialProfile>;
  /** Videos only. */
  listPosts(accessToken: string, i: ListPostsInput): Promise<ListPostsResult>;
  /** Live ownership check: null unless the post belongs to `externalAccountId`. */
  getPost(
    accessToken: string,
    externalId: string,
    externalAccountId: string,
  ): Promise<SocialPost | null>;
  /** Posting verification by parsed id, never a pasted URL (07 D68). */
  findPostByLinkKey(
    accessToken: string,
    linkKey: string,
    externalAccountId: string,
  ): Promise<SocialPost | null>;
  /** Batched thumbnail refresh ([H7]). */
  getPosts(accessToken: string, externalIds: string[]): Promise<SocialPost[]>;
}
