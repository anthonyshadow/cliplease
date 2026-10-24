import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { socialAccount, video, videoPosting } from "../../db/schema";
import {
  isOneOf,
  type PostingPlatform,
  RATE_DIMENSIONS,
  USE_KEYS,
  type VideoDisabledReason,
} from "../../lib/domain/values";
import { isValidSlug } from "../../lib/validation/handle";
import { isUuid } from "../../lib/validation/uuid";
import { PUBLISH_BLOCKERS, type PublishBlocker } from "../../lib/videos/review";
import { type Actor, requireCreatorActor } from "../auth/actor";
import {
  type EffectiveOptions,
  effectiveOptions,
  getRateCard,
} from "../pricing/rate-card";
import { VideoNotFoundError } from "./errors";
import { stepFactColumns, stepFactsOf, type VideoStepState } from "./queries";

// What stands between a video and Publish (02 §5.6; 07 §8.2, D66, D69, D74): the Review lists them, and P14a's
// publishVideo enforces the same ones. Payouts never block (D74); there is no guardian or payout-country blocker (D93,
// D94). Nothing here calls the payments driver.

/** What computePublishBlockers reads, gathered by getPublishFacts: the step facts as the steps read them, and more. */
export type PublishFacts = VideoStepState & {
  hasPoster: boolean;
  slug: string;
  /** effectiveOptions over the rate card and the video (07 D82). */
  options: EffectiveOptions;
  /** Each verified posting, and whether its account isn't `connected` or isn't this creator's (07 D66). */
  verifiedPostings: { platform: PostingPlatform; reconnect: boolean }[];
};

/** The blockers of 07 §8.2, in the Review's order (PUBLISH_BLOCKERS); [] when the video can go live. Pure. */
export function computePublishBlockers(f: PublishFacts): PublishBlocker[] {
  const blocks: Record<PublishBlocker, boolean> = {
    original_not_ready: f.originalStatus !== "ready",
    poster_required: !f.hasPoster,
    postings_unconfirmed: f.postingsConfirmedAt === null,
    same_video_unconfirmed: f.hasVerifiedPosting && !f.sameVideoConfirmed,
    not_attested: !f.rightsAnswered,
    no_enabled_option: !RATE_DIMENSIONS.every((d) =>
      f.options[d].some((o) => o.enabled),
    ),
    invalid_slug: !isValidSlug(f.slug),
    disabled_by_admin: f.status === "disabled",
    reconnect_account: f.verifiedPostings.some((p) => p.reconnect),
  };
  return PUBLISH_BLOCKERS.filter((blocker) => blocks[blocker]);
}

/**
 * The creator's video's PublishFacts, with its disabled reason, or null (not the creator's, missing, not a uuid). The
 * video, its verified postings with their accounts, and the rate card are read together; the step facts are the steps'
 * own (stepFactsOf), and the options are effectiveOptions with the video's disabled uses and base override (07 D82).
 */
export async function getPublishFacts(
  creatorId: string,
  videoId: string,
): Promise<{
  facts: PublishFacts;
  disabledReason: VideoDisabledReason | null;
} | null> {
  if (!isUuid(videoId)) return null;
  const [[row], postings, rateCard] = await Promise.all([
    db
      .select({
        ...stepFactColumns,
        posterObjectKey: video.posterObjectKey,
        slug: video.slug,
        disabledUses: video.disabledUses,
        basePriceOverrideCents: video.basePriceOverrideCents,
        disabledReason: video.disabledReason,
      })
      .from(video)
      .where(and(eq(video.id, videoId), eq(video.creatorId, creatorId))),
    db
      .select({
        platform: videoPosting.platform,
        accountStatus: socialAccount.status,
        accountCreatorId: socialAccount.creatorId,
      })
      .from(videoPosting)
      .leftJoin(
        socialAccount,
        eq(socialAccount.id, videoPosting.socialAccountId),
      )
      .where(
        and(
          eq(videoPosting.videoId, videoId),
          eq(videoPosting.verification, "verified"),
        ),
      ),
    getRateCard(creatorId),
  ]);
  // The postings are this creator's only once the video is: without its row, nothing read is returned.
  if (!row) return null;
  return {
    facts: {
      ...stepFactsOf(row),
      hasPoster: row.posterObjectKey !== null,
      slug: row.slug,
      options: effectiveOptions(rateCard, {
        disabledUses: row.disabledUses.filter((key) => isOneOf(USE_KEYS, key)),
        basePriceOverrideCents: row.basePriceOverrideCents,
      }),
      verifiedPostings: postings.map((p) => ({
        platform: p.platform,
        reconnect:
          p.accountStatus !== "connected" || p.accountCreatorId !== creatorId,
      })),
    },
    disabledReason: row.disabledReason,
  };
}

/**
 * The creator's video's blockers, with the platforms whose accounts need a reconnect (one Review row each, 07 D66), the
 * effective options (the Review's prices) and the admin's reason when it is disabled. VideoNotFoundError when the video
 * isn't the creator's.
 */
export async function getPublishBlockers(
  a: Actor,
  videoId: string,
): Promise<{
  blockers: PublishBlocker[];
  reconnectPlatforms: PostingPlatform[];
  options: EffectiveOptions;
  disabledReason: VideoDisabledReason | null;
}> {
  const { creatorId } = requireCreatorActor(a);
  const read = await getPublishFacts(creatorId, videoId);
  if (!read) throw new VideoNotFoundError();
  const { facts, disabledReason } = read;
  return {
    blockers: computePublishBlockers(facts),
    reconnectPlatforms: [
      ...new Set(
        facts.verifiedPostings
          .filter((p) => p.reconnect)
          .map((p) => p.platform),
      ),
    ],
    options: facts.options,
    disabledReason,
  };
}
