import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "../../db/client";
import { creatorProfile, video } from "../../db/schema";
import type {
  Currency,
  PostingPlatform,
  SocialProviderId,
  VideoStatus,
} from "../../lib/domain/values";
import { autoApprovesNewRequests } from "../../lib/licensing/auto-approve-rule";
import type { LicensePageDTO } from "../../lib/licensing/license-page";
import { defaultSelection } from "../../lib/licensing/selection";
import { fromPriceCents } from "../../lib/pricing/from-price";
import { PLATFORM_FEE_MIN_CENTS } from "../../lib/pricing/presets";
import { type BadgeInput, publicBadge } from "../../lib/videos/ownership";
import { env } from "../env";
import {
  getPublicPostings,
  publicPostingRowsByVideo,
  toPublicPostings,
} from "../postings/queries";
import {
  effectiveOptions,
  getRateCard,
  type RateCardDTO,
  videoPricingOf,
} from "../pricing/rate-card";
import { enabledPlatforms } from "../social/registry";
import {
  isPubliclyAvailable,
  posterSrc,
  postingPlatformsColumn,
  shareUrl,
} from "./visibility";

/** One card on the public /@handle grid (04 §9.27): public fields only, no object key or creator id. */
export type PublicVideoCardDTO = {
  id: string;
  title: string;
  slug: string;
  posterSrc: string | null;
  width: number | null;
  height: number | null;
  /** The sm badge buyers see (07 D70, D89). */
  badge: BadgeInput;
  fromPriceCents: number | null;
  currency: Currency;
};

/** The video's columns licenseOffer reads. */
const OFFER_COLUMNS = {
  id: video.id,
  status: video.status,
  posterObjectKey: video.posterObjectKey,
  disabledUses: video.disabledUses,
  basePriceOverrideCents: video.basePriceOverrideCents,
};

/** The creator's published videos, newest published first: the grid's order. */
const publishedBy = (creatorId: string) =>
  and(eq(video.creatorId, creatorId), eq(video.status, "published"));
const NEWEST_PUBLISHED = [desc(video.publishedAt), desc(video.id)] as const;

/**
 * What a video's license page offers (03 §7.5; 07 D03, D72, D82): its poster, options and first selection, or null
 * when the page 404s: the video isn't published, anyone can't see it (a Demo posting while Demo is off), it has no
 * poster, or no combination of its options fits under the cap. The public grid and the empty Inbox's link keep only
 * the videos it offers (owner answer Q-137 a). Pure.
 */
function licenseOffer(
  row: Parameters<typeof videoPricingOf>[0] &
    Parameters<typeof posterSrc>[0] & { status: VideoStatus },
  postingPlatforms: readonly PostingPlatform[],
  rateCard: RateCardDTO,
  platforms: readonly SocialProviderId[],
) {
  const posterUrl = posterSrc(row);
  if (
    !posterUrl ||
    !isPubliclyAvailable({ status: row.status, postingPlatforms }, platforms)
  ) {
    return null;
  }
  const options = effectiveOptions(rateCard, videoPricingOf(row));
  const selection = defaultSelection(options, env.PLATFORM_FEE_BPS);
  return selection ? { posterUrl, options, selection } : null;
}

/**
 * The creator's videos anyone may license (03 §7.5; 07 D03, D72), newest published first: the published videos, every
 * posting of them and the rate card, read together; then, per video, licenseOffer, the public badge and the From
 * price.
 */
export async function listPublicVideos(
  creatorId: string,
): Promise<PublicVideoCardDTO[]> {
  const [rows, postingsByVideo, rateCard] = await Promise.all([
    db
      .select({
        ...OFFER_COLUMNS,
        title: video.title,
        slug: video.slug,
        width: video.width,
        height: video.height,
      })
      .from(video)
      .where(publishedBy(creatorId))
      .orderBy(...NEWEST_PUBLISHED),
    publicPostingRowsByVideo(creatorId),
    getRateCard(creatorId),
  ]);
  const platforms = enabledPlatforms();
  return rows.flatMap((row): PublicVideoCardDTO[] => {
    const postings = postingsByVideo.get(row.id) ?? [];
    const offer = licenseOffer(
      row,
      postings.map((p) => p.platform),
      rateCard,
      platforms,
    );
    if (!offer) return [];
    return [
      {
        id: row.id,
        title: row.title,
        slug: row.slug,
        posterSrc: offer.posterUrl,
        width: row.width,
        height: row.height,
        badge: publicBadge(toPublicPostings(postings), "sm"),
        fromPriceCents: fromPriceCents(offer.options, env.PLATFORM_FEE_BPS),
        currency: offer.options.currency,
      },
    ];
  });
}

/**
 * The share link of the creator's latest video a buyer can license, the public grid's first: the empty Inbox's Copy
 * link (05 §6.3 callout 13), or null. It reads what licenseOffer needs, not the grid's cards: the Inbox asks again
 * on every refresh.
 */
export async function latestLiveShareUrl(creator: {
  id: string;
  handle: string;
}): Promise<string | null> {
  const [rows, rateCard] = await Promise.all([
    db
      .select({
        ...OFFER_COLUMNS,
        slug: video.slug,
        postingPlatforms: postingPlatformsColumn,
      })
      .from(video)
      .where(publishedBy(creator.id))
      .orderBy(...NEWEST_PUBLISHED),
    getRateCard(creator.id),
  ]);
  const platforms = enabledPlatforms();
  const latest = rows.find((row) =>
    licenseOffer(row, row.postingPlatforms, rateCard, platforms),
  );
  return latest ? shareUrl(creator.handle, latest.slug) : null;
}

/**
 * The license page's data for `/@{handle}/{slug}` (03 §7.5; 07 D03, D72, D82): the video by its creator's handle and
 * slug, then its public postings and the rate card. null when licenseOffer offers nothing; the page then 404s. Fields
 * are picked one by one: the row's object key reaches nothing but posterSrc, and the stored payouts status nothing but
 * `creator.autoApprove` (owner answer Q-155; no Stripe call). `platforms`: the enabled ones (tests pass their own).
 */
export async function readLicensePageData(
  handle: string,
  slug: string,
  platforms: readonly SocialProviderId[] = enabledPlatforms(),
): Promise<LicensePageDTO | null> {
  const [row] = await db
    .select({
      ...OFFER_COLUMNS,
      slug: video.slug,
      title: video.title,
      width: video.width,
      height: video.height,
      containsMusic: video.containsMusic,
      identifiablePeople: video.identifiablePeople,
      creatorId: creatorProfile.id,
      handle: creatorProfile.handle,
      displayName: creatorProfile.displayName,
      approvalWindowHours: creatorProfile.approvalWindowHours,
      autoApprove: creatorProfile.autoApprove,
      payoutsStatus: creatorProfile.payoutsStatus,
    })
    .from(video)
    .innerJoin(creatorProfile, eq(creatorProfile.id, video.creatorId))
    .where(and(eq(creatorProfile.handle, handle), eq(video.slug, slug)));
  if (row?.status !== "published") return null;
  const [postings, rateCard] = await Promise.all([
    getPublicPostings(row.id),
    getRateCard(row.creatorId),
  ]);
  const offer = licenseOffer(
    row,
    postings.postings.map((p) => p.platform),
    rateCard,
    platforms,
  );
  if (!offer) return null;
  return {
    video: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      width: row.width,
      height: row.height,
      posterUrl: offer.posterUrl,
      containsMusic: row.containsMusic === true,
      identifiablePeople: row.identifiablePeople === true,
    },
    creator: {
      handle: row.handle,
      displayName: row.displayName,
      approvalWindowHours: row.approvalWindowHours,
      autoApprove: autoApprovesNewRequests(row),
    },
    postings,
    badge: publicBadge(postings, "lg"),
    options: offer.options,
    platformFeeBps: env.PLATFORM_FEE_BPS,
    platformFeeMinCents: PLATFORM_FEE_MIN_CENTS[offer.options.currency],
    selection: offer.selection,
  };
}

/** readLicensePageData once per request, shared by the page and its generateMetadata (not `'use cache'`). */
export const getLicensePageData = cache((handle: string, slug: string) =>
  readLicensePageData(handle, slug),
);
