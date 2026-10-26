import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "../../db/client";
import { creatorProfile, video } from "../../db/schema";
import type { Currency, SocialProviderId } from "../../lib/domain/values";
import type { LicensePageDTO } from "../../lib/licensing/license-page";
import { defaultSelection } from "../../lib/licensing/selection";
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
  videoFromPrice,
  videoPricingOf,
} from "../pricing/rate-card";
import { enabledPlatforms } from "../social/registry";
import { isPubliclyAvailable, posterSrc } from "./visibility";

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

/**
 * The creator's videos anyone may see (03 §7.5; 07 D03, D72), newest published first: the published videos, every
 * posting of them and the rate card, read together; then, per video, isPubliclyAvailable (no Demo posting unless Demo
 * is enabled), the public badge and the From price.
 */
export async function listPublicVideos(
  creatorId: string,
): Promise<PublicVideoCardDTO[]> {
  const [rows, postingsByVideo, rateCard] = await Promise.all([
    db
      .select({
        id: video.id,
        title: video.title,
        slug: video.slug,
        status: video.status,
        posterObjectKey: video.posterObjectKey,
        width: video.width,
        height: video.height,
        disabledUses: video.disabledUses,
        basePriceOverrideCents: video.basePriceOverrideCents,
      })
      .from(video)
      .where(and(eq(video.creatorId, creatorId), eq(video.status, "published")))
      .orderBy(desc(video.publishedAt), desc(video.id)),
    publicPostingRowsByVideo(creatorId),
    getRateCard(creatorId),
  ]);
  const platforms = enabledPlatforms();
  return rows.flatMap((row): PublicVideoCardDTO[] => {
    const postings = postingsByVideo.get(row.id) ?? [];
    const visible = isPubliclyAvailable(
      { status: row.status, postingPlatforms: postings.map((p) => p.platform) },
      platforms,
    );
    if (!visible) return [];
    return [
      {
        id: row.id,
        title: row.title,
        slug: row.slug,
        posterSrc: posterSrc(row),
        width: row.width,
        height: row.height,
        badge: publicBadge(toPublicPostings(postings), "sm"),
        ...videoFromPrice(rateCard, row),
      },
    ];
  });
}

/**
 * The license page's data for `/@{handle}/{slug}` (03 §7.5; 07 D03, D72, D82): the video by its creator's handle and
 * slug, then its public postings and the rate card. null unless the video is published, anyone may see it (no Demo
 * posting while Demo is off) and some combination of its options fits under the cap; the page then 404s. Fields are
 * picked one by one: the row's object key reaches nothing but posterSrc. `platforms`: the enabled ones (tests pass their
 * own).
 */
export async function readLicensePageData(
  handle: string,
  slug: string,
  platforms: readonly SocialProviderId[] = enabledPlatforms(),
): Promise<LicensePageDTO | null> {
  const [row] = await db
    .select({
      id: video.id,
      slug: video.slug,
      title: video.title,
      status: video.status,
      width: video.width,
      height: video.height,
      posterObjectKey: video.posterObjectKey,
      containsMusic: video.containsMusic,
      identifiablePeople: video.identifiablePeople,
      disabledUses: video.disabledUses,
      basePriceOverrideCents: video.basePriceOverrideCents,
      creatorId: creatorProfile.id,
      handle: creatorProfile.handle,
      displayName: creatorProfile.displayName,
      approvalWindowHours: creatorProfile.approvalWindowHours,
    })
    .from(video)
    .innerJoin(creatorProfile, eq(creatorProfile.id, video.creatorId))
    .where(and(eq(creatorProfile.handle, handle), eq(video.slug, slug)));
  if (row?.status !== "published") return null;
  const [postings, rateCard] = await Promise.all([
    getPublicPostings(row.id),
    getRateCard(row.creatorId),
  ]);
  const visible = isPubliclyAvailable(
    {
      status: row.status,
      postingPlatforms: postings.postings.map((p) => p.platform),
    },
    platforms,
  );
  const posterUrl = posterSrc(row);
  const options = effectiveOptions(rateCard, videoPricingOf(row));
  const selection = defaultSelection(options, env.PLATFORM_FEE_BPS);
  if (!visible || !posterUrl || !selection) return null;
  return {
    video: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      width: row.width,
      height: row.height,
      posterUrl,
      containsMusic: row.containsMusic === true,
      identifiablePeople: row.identifiablePeople === true,
    },
    creator: {
      handle: row.handle,
      displayName: row.displayName,
      approvalWindowHours: row.approvalWindowHours,
    },
    postings,
    badge: publicBadge(postings, "lg"),
    options,
    platformFeeBps: env.PLATFORM_FEE_BPS,
    platformFeeMinCents: PLATFORM_FEE_MIN_CENTS[options.currency],
    selection,
  };
}

/** readLicensePageData once per request, shared by the page and its generateMetadata (not `'use cache'`). */
export const getLicensePageData = cache((handle: string, slug: string) =>
  readLicensePageData(handle, slug),
);
