import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { socialAccount, socialPost } from "../../db/schema";
import {
  isOneOf,
  type PostingPlatform,
  type PostingUnverifiedReason,
  type SocialProviderId,
  VERIFIABLE_POSTING_PLATFORMS,
} from "../../lib/domain/values";
import { verifiedAs } from "../../lib/videos/ownership";
import { errorName, logEvent } from "../log";
import {
  SocialAuthError,
  SocialRateLimitError,
  SocialUpstreamError,
} from "../social/errors";
import { getProvider } from "../social/registry";
import { isKeptVideo, upsertPosts } from "../social/sync";
import { withAccessToken } from "../social/tokens";
import type { PostVisibility, SocialPost } from "../social/types";
import { NotPublicError } from "./errors";

// Posting verification by id (02 §5.12, 06 §5b; 07 D68). A link is Verified only when its parsed id matches a post on one
// of the creator's `connected` accounts: a synced social_post confirmed live, or a platform lookup by id whose post is
// written to social_post. The pasted URL is never fetched, HEADed, oEmbedded or redirect-resolved (07 D67, AGENTS.md §5):
// the adapters are asked by id, against their fixed hosts. Callers run this before they open their write, never inside
// it, so a platform call never holds a row lock. Logs carry ids and the platform, never a link.

/** Instagram /me/media pages findPostByLinkKey scans for a shortcode (07 §7.2; P28's adapter imports it). */
export const POSTING_LOOKUP_MAX_PAGES = 4;
/** Connected accounts a lookup by id tries per link, newest connect first (07 D68; OQ-15 sets no account cap). */
const POSTING_LOOKUP_MAX_ACCOUNTS = 3;

/** What a check found (02 §5.12): the post that verifies the link, or why the link stays Not verified. */
export type PostingCheckResult =
  | {
      verification: "verified";
      socialAccountId: string;
      socialPostId: string;
      /** 07 D43's display form, from verifiedAs: never empty. */
      verifiedUsername: string;
      /** The account's connected_at, snapshotted as verified_account_linked_at. */
      verifiedAccountLinkedAt: Date;
      /** The live visibility: `unlisted` hides the link by default (07 D18). */
      visibility: PostVisibility | null;
    }
  | { verification: "unverified"; reason: PostingUnverifiedReason };

/** A connected account that can verify: it has a handle or a name to show (verifiedAs). */
type CheckAccount = {
  id: string;
  creatorId: string;
  provider: SocialProviderId;
  providerAccountId: string;
  connectedAt: Date;
  verifiedUsername: string;
};

/** A platform call that failed in a way a later Check again can fix (07 D68): the link gets check_failed. */
const FAILED = Symbol("check_failed");

function unverified(reason: PostingUnverifiedReason): PostingCheckResult {
  return { verification: "unverified", reason };
}

/**
 * Checks a parsed link against the creator's linked accounts (07 D68). Order, the first answer winning:
 * 1. a platform that can't be verified (Facebook, X, Snapchat, Other) → unverifiable, with no read and no call;
 * 2. no link key → no_link;
 * 3. the creator's accounts on the platform: none connected → check_failed when one needs a reconnect, else no_account.
 *    A connected account with neither handle nor name can't verify until a reconnect reads its profile (verifiedAs):
 *    none usable, or the platform not enabled → check_failed;
 * 4. a synced post with that link key on a connected account (03 §7.4 "DB match", social_post_link_key_idx, any
 *    status): on a usable account → one live getPost: the post → 6, none → not_found; only on an account that can't
 *    verify → check_failed with no call (a reconnect lets it answer);
 * 5. no match → findPostByLinkKey on up to POSTING_LOOKUP_MAX_ACCOUNTS usable accounts, newest connected_at first; the
 *    first post found wins. Nothing found → check_failed when any account failed or a connected account that can't
 *    verify was left out (the post may be on it), else not_found;
 * 6. found: a live `private` post throws NotPublicError before any write. Otherwise the post is written through the sync
 *    upsert (available, link_key set, fetched now; a stale or removed match comes back), so a verified posting always
 *    references a social_post row.
 * A post that isn't a kept video, or whose link key differs from the parsed one, counts as none. A rate limit, a platform
 * failure or a refused token (after withAccessToken's one retry, which also marks the account needs_reconnect) is that
 * account's check_failed; any other error is thrown. `url` is never read: only the id is matched.
 */
export async function verifyPostingLink(
  creatorId: string,
  link: {
    platform: PostingPlatform;
    linkKey: string | null;
    url: string | null;
  },
): Promise<PostingCheckResult> {
  // 1 and 2.
  const { platform, linkKey } = link;
  if (!isOneOf(VERIFIABLE_POSTING_PLATFORMS, platform)) {
    return unverified("unverifiable");
  }
  if (linkKey === null) return unverified("no_link");

  // 3.
  const accounts = await db
    .select({
      id: socialAccount.id,
      creatorId: socialAccount.creatorId,
      provider: socialAccount.provider,
      providerAccountId: socialAccount.providerAccountId,
      status: socialAccount.status,
      username: socialAccount.username,
      displayName: socialAccount.displayName,
      connectedAt: socialAccount.connectedAt,
    })
    .from(socialAccount)
    .where(
      and(
        eq(socialAccount.creatorId, creatorId),
        eq(socialAccount.provider, platform),
      ),
    )
    .orderBy(desc(socialAccount.connectedAt), asc(socialAccount.id));
  const connected = accounts.filter(
    (account) => account.status === "connected",
  );
  if (connected.length === 0) {
    return accounts.some((account) => account.status === "needs_reconnect")
      ? unverified("check_failed")
      : unverified("no_account");
  }
  const usable: CheckAccount[] = connected.flatMap((account) => {
    const verifiedUsername = verifiedAs(account);
    return verifiedUsername === null ? [] : [{ ...account, verifiedUsername }];
  });
  const provider = getProvider(platform);
  if (usable.length === 0 || !provider) return unverified("check_failed");
  // A connected account that can't verify is left out of the lookup, so finding nothing proves nothing about it.
  const leftOut = usable.length < connected.length;

  // 4.
  const matches = await db
    .select({
      socialAccountId: socialPost.socialAccountId,
      providerPostId: socialPost.providerPostId,
    })
    .from(socialPost)
    .where(
      and(
        eq(socialPost.creatorId, creatorId),
        eq(socialPost.provider, platform),
        eq(socialPost.linkKey, linkKey),
        inArray(
          socialPost.socialAccountId,
          connected.map((account) => account.id),
        ),
      ),
    );
  for (const account of usable) {
    const match = matches.find((m) => m.socialAccountId === account.id);
    if (!match) continue;
    const live = await askPlatform(account, (token) =>
      provider.getPost(token, match.providerPostId, account.providerAccountId),
    );
    if (live === FAILED) return unverified("check_failed");
    const post = sameLink(live, linkKey);
    return post ? verified(account, post) : unverified("not_found");
  }
  if (matches.length > 0) return unverified("check_failed");

  // 5.
  let failed = false;
  for (const account of usable.slice(0, POSTING_LOOKUP_MAX_ACCOUNTS)) {
    const found = await askPlatform(account, (token) =>
      provider.findPostByLinkKey(token, linkKey, account.providerAccountId),
    );
    if (found === FAILED) {
      failed = true;
      continue;
    }
    const post = sameLink(found, linkKey);
    if (post) return verified(account, post);
  }
  return unverified(failed || leftOut ? "check_failed" : "not_found");
}

/**
 * One platform call with the account's token (07 D12 b). A rate limit, a platform failure or a refused token is FAILED,
 * logged by id and error name only (a Drizzle error can carry bound parameters); anything else is thrown.
 */
async function askPlatform(
  account: CheckAccount,
  call: (token: string) => Promise<SocialPost | null>,
): Promise<SocialPost | null | typeof FAILED> {
  try {
    return await withAccessToken(account.id, call);
  } catch (error) {
    if (
      !(error instanceof SocialRateLimitError) &&
      !(error instanceof SocialUpstreamError) &&
      !(error instanceof SocialAuthError)
    ) {
      throw error;
    }
    logEvent("warn", "postings.check_failed", {
      socialAccountId: account.id,
      platform: account.provider,
      error: errorName(error),
    });
    return FAILED;
  }
}

/** The post when it is a kept video carrying the parsed link key, else null: it can't verify this link. */
function sameLink(post: SocialPost | null, linkKey: string): SocialPost | null {
  return post !== null && isKeptVideo(post) && post.linkKey === linkKey
    ? post
    : null;
}

/** Step 6: refuses a private post, writes the post to social_post and names the row a verified posting references. */
async function verified(
  account: CheckAccount,
  post: SocialPost,
): Promise<PostingCheckResult> {
  if (post.visibility === "private") throw new NotPublicError();
  await upsertPosts(db, account, [post], new Date());
  const [row] = await db
    .select({ id: socialPost.id })
    .from(socialPost)
    .where(
      and(
        eq(socialPost.socialAccountId, account.id),
        eq(socialPost.providerPostId, post.externalId),
      ),
    );
  if (!row) throw new Error("verifyPostingLink: the written post is missing");
  return {
    verification: "verified",
    socialAccountId: account.id,
    socialPostId: row.id,
    verifiedUsername: account.verifiedUsername,
    verifiedAccountLinkedAt: account.connectedAt,
    visibility: post.visibility,
  };
}
