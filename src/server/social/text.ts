import "server-only";
import type { SocialProviderId } from "../../lib/domain/values";
import { logEvent } from "../log";
import { SocialUpstreamError } from "./errors";
import type { SocialPost, SocialProfile, SocialProvider } from "./types";

// Platform data where it enters the app (03 DB1): the registry wraps every adapter, so each profile and post it reads
// passes through here once and the mappers only map. Postgres refuses U+0000, and one such byte would fail the whole
// write on every sync. Text loses it and a URL with one becomes null. An id, a link key or a permalink with one is
// broken: a listed post is left out (logged by count), and a profile or a post looked up by id fails as the platform's
// error, before anything is written. Relative imports only: the P09 seed loads the registry under tsx.

const NUL = "\u0000";

const withoutNul = (s: string | null): string | null =>
  s === null ? null : s.replaceAll(NUL, "");

const hasNul = (s: string | null): boolean => s?.includes(NUL) ?? false;

const urlWithoutNul = (s: string | null): string | null =>
  hasNul(s) ? null : s;

/** The profile with its text cleaned; SocialUpstreamError when its account id holds a NUL (it can't be stored). */
function cleanProfile(profile: SocialProfile): SocialProfile {
  if (hasNul(profile.externalAccountId)) throw new SocialUpstreamError();
  return {
    ...profile,
    username: withoutNul(profile.username),
    displayName: withoutNul(profile.displayName),
    avatarUrl: urlWithoutNul(profile.avatarUrl),
    profileUrl: urlWithoutNul(profile.profileUrl),
    accountType: withoutNul(profile.accountType),
  };
}

/**
 * The post with its text cleaned (the same object when there is nothing to clean), or null when its id, link key or
 * permalink holds a NUL (it can't be stored or matched).
 */
function cleanPost(post: SocialPost): SocialPost | null {
  if (
    hasNul(post.externalId) ||
    hasNul(post.linkKey) ||
    hasNul(post.permalink)
  ) {
    return null;
  }
  if (![post.title, post.caption, post.thumbnailUrl].some(hasNul)) return post;
  return {
    ...post,
    title: withoutNul(post.title),
    caption: withoutNul(post.caption),
    thumbnailUrl: urlWithoutNul(post.thumbnailUrl),
  };
}

/**
 * A list's usable posts, cleaned (`posts` itself when every post is usable and clean); the ones left out are logged by
 * count only (never an id or a URL).
 */
function usablePosts(
  platform: SocialProviderId,
  posts: SocialPost[],
): SocialPost[] {
  const cleaned = posts.map(cleanPost);
  if (cleaned.every((post, i) => post === posts[i])) return posts;
  const usable = cleaned.filter((post) => post !== null);
  if (usable.length < posts.length) {
    logEvent("warn", "social.post_skipped", {
      provider: platform,
      count: posts.length - usable.length,
    });
  }
  return usable;
}

/** A post looked up by id, cleaned. One that can't be stored is the platform's error, never null ("gone, or not yours"). */
function lookedUp(post: SocialPost | null): SocialPost | null {
  if (post === null) return null;
  const clean = cleanPost(post);
  if (!clean) throw new SocialUpstreamError();
  return clean;
}

/**
 * The adapter's own members, none of them a profile or a post. Every other member is a read that withCleanReads must
 * wrap: one added to SocialProvider fails to compile until it is wrapped or listed here.
 */
type PassThrough =
  | "platform"
  | "label"
  | "capabilities"
  | "requiredScopes"
  | "optionalScopes"
  | "thumbnailHosts"
  | "thumbnailTtlMs"
  | "getAuthorizeUrl"
  | "exchangeCode"
  | "refreshToken"
  | "revoke";

/**
 * `adapter` with every profile and post it reads cleaned. Only the reads are its own: the PassThrough members are the
 * adapter's, read through the prototype at each use.
 */
export function withCleanReads(adapter: SocialProvider): SocialProvider {
  const reads: Omit<SocialProvider, PassThrough> = {
    getProfile: async (...args) =>
      cleanProfile(await adapter.getProfile(...args)),
    listPosts: async (...args) => {
      const listing = await adapter.listPosts(...args);
      return {
        ...listing,
        posts: usablePosts(adapter.platform, listing.posts),
      };
    },
    getPost: async (...args) => lookedUp(await adapter.getPost(...args)),
    findPostByLinkKey: async (...args) =>
      lookedUp(await adapter.findPostByLinkKey(...args)),
    getPosts: async (...args) =>
      usablePosts(adapter.platform, await adapter.getPosts(...args)),
  };
  const wrapper: SocialProvider = Object.create(adapter);
  return Object.assign(wrapper, reads);
}
