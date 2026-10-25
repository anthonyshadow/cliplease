import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { socialAccount, video, videoPosting } from "../../db/schema";
import type { Video } from "../../db/schema/types";
import {
  type PostingPlatform,
  RATE_DIMENSIONS,
  type VideoDisabledReason,
} from "../../lib/domain/values";
import { isValidSlug } from "../../lib/validation/handle";
import { isUuid } from "../../lib/validation/uuid";
import { PUBLISH_BLOCKERS, type PublishBlocker } from "../../lib/videos/review";
import { writeAudit } from "../audit";
import { type Actor, requireCreatorActor } from "../auth/actor";
import {
  type EffectiveOptions,
  effectiveOptions,
  getRateCard,
  type RateCardDTO,
  videoPricingOf,
} from "../pricing/rate-card";
import { VideoNotFoundError } from "./errors";
import { stepFactColumns, stepFactsOf, type VideoStepState } from "./queries";

// What stands between a video and Publish (02 §5.6; 07 §8.2, D66, D69, D74), and Publish itself: the Review lists the
// blockers and publishVideo enforces the same ones. Payouts never block (D74); there is no guardian or payout-country
// blocker (D93, D94). Nothing here calls the payments driver.

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

type Reader = Pick<typeof db, "select">;

/** The video's columns the facts and publishVideo read. */
const publishColumns = {
  ...stepFactColumns,
  posterObjectKey: video.posterObjectKey,
  slug: video.slug,
  disabledUses: video.disabledUses,
  basePriceOverrideCents: video.basePriceOverrideCents,
  disabledReason: video.disabledReason,
};

/** Every posting of the video in position order (the source first), with its account (07 D66). */
function readPostings(exec: Reader, videoId: string) {
  return exec
    .select({
      platform: videoPosting.platform,
      verification: videoPosting.verification,
      showLink: videoPosting.showLink,
      accountStatus: socialAccount.status,
      accountCreatorId: socialAccount.creatorId,
    })
    .from(videoPosting)
    .leftJoin(socialAccount, eq(socialAccount.id, videoPosting.socialAccountId))
    .where(eq(videoPosting.videoId, videoId))
    .orderBy(asc(videoPosting.position));
}

type VideoRow = Pick<Video, keyof typeof publishColumns>;
type PostingRow = Awaited<ReturnType<typeof readPostings>>[number];

/** PublishFacts from what was read: the steps' own facts (stepFactsOf), effectiveOptions (07 D82) and the postings. */
function publishFactsOf(
  row: VideoRow,
  postings: readonly PostingRow[],
  rateCard: RateCardDTO,
  creatorId: string,
): PublishFacts {
  return {
    ...stepFactsOf(row),
    hasPoster: row.posterObjectKey !== null,
    slug: row.slug,
    options: effectiveOptions(rateCard, videoPricingOf(row)),
    verifiedPostings: postings
      .filter((p) => p.verification === "verified")
      .map((p) => ({
        platform: p.platform,
        reconnect:
          p.accountStatus !== "connected" || p.accountCreatorId !== creatorId,
      })),
  };
}

/**
 * The creator's video's PublishFacts, with its disabled reason, or null (not the creator's, missing, not a uuid). The
 * video, its postings with their accounts, and the rate card are read together, with no lock (the Review's read).
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
      .select(publishColumns)
      .from(video)
      .where(and(eq(video.id, videoId), eq(video.creatorId, creatorId))),
    readPostings(db, videoId),
    getRateCard(creatorId),
  ]);
  // The postings are this creator's only once the video is: without its row, nothing read is returned.
  if (!row) return null;
  return {
    facts: publishFactsOf(row, postings, rateCard, creatorId),
    disabledReason: row.disabledReason,
  };
}

/** The "Show buyers this link" words the creator saw on Where posted, as video.published records them (07 D69). */
const SHOW_LINK_COPY_VERSION = "v1";

export type PublishResult =
  | { ok: true; slug: string }
  | { ok: false; blockers: PublishBlocker[] };

/**
 * Makes the creator's video live (02 §5.6, 07 D69): under the row lock, a video already `published` is done (no write,
 * no second audit); otherwise the facts are read again and any blocker refuses with the list (a `disabled` video is
 * `disabled_by_admin`, so only `draft` and `unpublished` go on). Then `published`, `published_at` kept from an earlier
 * publish, and `video.published { postings: [{ platform, verified, showLink }], copyVersion }` (no links, names or
 * ids). No payments call and no payouts check (D74); the CHECK video_published_requirements is the backstop. Returns the
 * slug read under the lock, final once published (D09). VideoNotFoundError when the video isn't the creator's.
 */
export async function publishVideo(
  a: Actor,
  input: { videoId: string },
): Promise<PublishResult> {
  const { creatorId } = requireCreatorActor(a);
  const { videoId } = input;
  if (!isUuid(videoId)) throw new VideoNotFoundError();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select(publishColumns)
      .from(video)
      .where(and(eq(video.id, videoId), eq(video.creatorId, creatorId)))
      .for("update");
    if (!row) throw new VideoNotFoundError();
    if (row.status === "published") return { ok: true, slug: row.slug };
    // Read after the statement that took the lock (lockFlags' rule): a posting save waits for it, so these are current.
    const postings = await readPostings(tx, videoId);
    const rateCard = await getRateCard(creatorId, tx);
    const blockers = computePublishBlockers(
      publishFactsOf(row, postings, rateCard, creatorId),
    );
    if (blockers.length > 0) return { ok: false, blockers };
    await tx
      .update(video)
      .set({
        status: "published",
        publishedAt: sql`coalesce(${video.publishedAt}, now())`,
      })
      .where(eq(video.id, videoId));
    await writeAudit(tx, a, {
      action: "video.published",
      entityType: "video",
      entityId: videoId,
      data: {
        postings: postings.map((p) => ({
          platform: p.platform,
          verified: p.verification === "verified",
          showLink: p.showLink,
        })),
        copyVersion: SHOW_LINK_COPY_VERSION,
      },
    });
    return { ok: true, slug: row.slug };
  });
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
