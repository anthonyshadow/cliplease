import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { socialAccount, socialPost, videoPosting } from "../../db/schema";
import { PLATFORM_LABELS } from "../../lib/brand";
import type { SocialProviderId } from "../../lib/domain/values";
import { isUuid } from "../../lib/validation/uuid";
import { createVideoSchema } from "../../lib/validation/video";
import { verifiedAs } from "../../lib/videos/ownership";
import { titleFromPost } from "../../lib/videos/post-title";
import { writeAudit } from "../audit";
import { type Actor, requireCreatorActor } from "../auth/actor";
import { uniqueViolationConstraint } from "../db-errors";
import { SocialAuthError, SocialUpstreamError } from "../social/errors";
import { mockPermalink } from "../social/providers/mock";
import { getProvider } from "../social/registry";
import { withAccessToken } from "../social/tokens";
import type { SocialPost } from "../social/types";
import {
  AlreadyLicensableElsewhereError,
  NeedsReconnectError,
  NotOnAccountError,
  NotPublicError,
  PostNotFoundError,
} from "./errors";
import { insertVideoWithUniqueSlug } from "./slug";

export class VideoInputError extends Error {
  constructor() {
    super("invalid_input");
    this.name = "VideoInputError";
  }
}

/**
 * The plain upload's first step (07 D39): a self-attested draft with no original yet and a unique slug from its title.
 * The title is tidied and checked again here (07 D23; owner answer Q-43 a). Audited by id only.
 */
export async function createVideoFromUpload(
  a: Actor,
  i: { title: string },
): Promise<{ videoId: string }> {
  const actor = requireCreatorActor(a);
  const parsed = createVideoSchema.safeParse(i);
  if (!parsed.success) throw new VideoInputError();
  const { title } = parsed.data;
  // The app picks the id: object keys are built from it (03 §3.6).
  const videoId = randomUUID();
  await db.transaction(async (tx) => {
    await insertVideoWithUniqueSlug(tx, {
      id: videoId,
      creatorId: actor.creatorId,
      title,
      source: "upload",
      ownership: "self_attested",
      status: "draft",
      originalStatus: "none",
    });
    await writeAudit(tx, actor, {
      action: "video.created",
      entityType: "video",
      entityId: videoId,
    });
  });
  return { videoId };
}

/** The creator's own `available` post with its account (03 §7.4 "new from post"), or undefined. */
async function availablePost(creatorId: string, socialPostId: string) {
  const [post] = await db
    .select({
      id: socialPost.id,
      provider: socialPost.provider,
      providerPostId: socialPost.providerPostId,
      linkKey: socialPost.linkKey,
      permalink: socialPost.permalink,
      title: socialPost.title,
      caption: socialPost.caption,
      postedAt: socialPost.postedAt,
      visibility: socialPost.visibility,
      accountId: socialAccount.id,
      accountStatus: socialAccount.status,
      providerAccountId: socialAccount.providerAccountId,
      username: socialAccount.username,
      displayName: socialAccount.displayName,
      connectedAt: socialAccount.connectedAt,
    })
    .from(socialPost)
    .innerJoin(socialAccount, eq(socialAccount.id, socialPost.socialAccountId))
    .where(
      and(
        eq(socialPost.id, socialPostId),
        eq(socialPost.creatorId, creatorId),
        eq(socialPost.status, "available"),
      ),
    );
  return post;
}

/** The creator's video holding a verified posting of this post (07 D72, video_posting_social_post_idx), or null. */
async function ownVideoOnPost(
  creatorId: string,
  socialPostId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ videoId: videoPosting.videoId })
    .from(videoPosting)
    .where(
      and(
        eq(videoPosting.socialPostId, socialPostId),
        eq(videoPosting.creatorId, creatorId),
        eq(videoPosting.verification, "verified"),
      ),
    )
    .limit(1);
  return row?.videoId ?? null;
}

/**
 * The live ownership check (07 D39): the post as the platform reports it for this account, or null when the account
 * doesn't hold it. Runs outside any transaction. A refused token becomes NeedsReconnectError (withAccessToken has
 * already retried once and marked the account, 07 D12 b); a platform that isn't enabled any more can't be asked, so it
 * gets the generic retry, as a platform failure does.
 */
async function livePost(post: {
  provider: SocialProviderId;
  providerPostId: string;
  accountId: string;
  providerAccountId: string;
}): Promise<SocialPost | null> {
  const provider = getProvider(post.provider);
  if (!provider) throw new SocialUpstreamError("provider_not_enabled");
  try {
    return await withAccessToken(post.accountId, (token) =>
      provider.getPost(token, post.providerPostId, post.providerAccountId),
    );
  } catch (error) {
    if (error instanceof SocialAuthError) throw new NeedsReconnectError();
    throw error;
  }
}

/**
 * The source posting's canonical URL. The mock's is rebuilt from its id, which is exactly its synced permalink (07 D68);
 * the other platforms keep the synced permalink until P11b rebuilds every URL with parsePostingLink.
 */
function sourcePostingUrl(post: {
  provider: SocialProviderId;
  providerPostId: string;
  permalink: string;
}): string {
  return post.provider === "mock"
    ? mockPermalink(post.providerPostId)
    : post.permalink;
}

/**
 * Make licensable (02 §5.6, §7.7; 07 D39, D65, D66, D72): a verified_owner draft and its one locked source posting,
 * after a live ownership check. Order (1 and 2 are read together, then checked in this order):
 * 1. the creator's own `available` post with its account, else PostNotFoundError;
 * 2. a verified posting of it already on one of the creator's videos → that video (a second press opens it);
 * 3. the account must be `connected` with a handle or a name (verifiedAs), else NeedsReconnectError;
 * 4. the live getPost, outside any transaction, through withAccessToken (07 D12 b: one retry after a concurrent
 *    refresh, then needs_reconnect → NeedsReconnectError): no post → NotOnAccountError, private → NotPublicError. A
 *    platform failure or rate limit is let out as it is (the generic retry);
 * 5. one transaction: the draft (title from the post, 01 J5.12; a unique slug), its source posting with every verified
 *    field, the link hidden when the live or cached post is unlisted (07 D18), and an ids-only `video.created` audit.
 *    The video row holds no social ids (07 D65); P11b routes the ownership write through refreshVideoOwnership;
 * 6. losing video_posting_verified_uidx: the creator's own video (a double tap) → its id, else
 *    AlreadyLicensableElsewhereError. Nothing is written on any refusal.
 */
export async function createVideoFromPost(
  a: Actor,
  socialPostId: string,
): Promise<{ videoId: string }> {
  const actor = requireCreatorActor(a);
  if (!isUuid(socialPostId)) throw new PostNotFoundError();

  // 1 and 2.
  const [post, existing] = await Promise.all([
    availablePost(actor.creatorId, socialPostId),
    ownVideoOnPost(actor.creatorId, socialPostId),
  ]);
  if (!post) throw new PostNotFoundError();
  if (existing) return { videoId: existing };

  // 3. 07 D43's display form; verified_username can't be empty (video_posting_verified_fields). An account the platform
  // gave neither a handle nor a name can't be verified until a reconnect reads its profile again: refused before any
  // platform call, as the Source page's reconnect state shows.
  const verifiedUsername = verifiedAs({
    status: post.accountStatus,
    username: post.username,
    displayName: post.displayName,
  });
  if (verifiedUsername === null) throw new NeedsReconnectError();

  // 4.
  const live = await livePost(post);
  if (!live) throw new NotOnAccountError();
  if (live.visibility === "private") throw new NotPublicError();

  // 5.
  const videoId = randomUUID();
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await insertVideoWithUniqueSlug(tx, {
        id: videoId,
        creatorId: actor.creatorId,
        title: titleFromPost({
          title: post.title,
          caption: post.caption,
          platformLabel: PLATFORM_LABELS[post.provider],
          postedAt: post.postedAt,
        }),
        source: "library",
        ownership: "verified_owner",
        status: "draft",
        originalStatus: "none",
      });
      await tx.insert(videoPosting).values({
        videoId,
        creatorId: actor.creatorId,
        platform: post.provider,
        url: sourcePostingUrl(post),
        linkKey: post.linkKey,
        verification: "verified",
        unverifiedReason: null,
        isSource: true,
        socialAccountId: post.accountId,
        socialPostId: post.id,
        verifiedUsername,
        verifiedAccountLinkedAt: post.connectedAt,
        verifiedAt: now,
        checkedAt: now,
        showLink:
          live.visibility !== "unlisted" && post.visibility !== "unlisted",
        position: 0,
      });
      await writeAudit(tx, actor, {
        action: "video.created",
        entityType: "video",
        entityId: videoId,
        data: { socialPostId: post.id },
      });
    });
  } catch (error) {
    // 6. The transaction is rolled back: nothing of this attempt is left.
    if (uniqueViolationConstraint(error) !== "video_posting_verified_uidx") {
      throw error;
    }
    const mine = await ownVideoOnPost(actor.creatorId, post.id);
    if (mine) return { videoId: mine };
    throw new AlreadyLicensableElsewhereError();
  }
  return { videoId };
}
