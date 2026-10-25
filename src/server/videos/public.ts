import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { video } from "../../db/schema";
import type { Currency } from "../../lib/domain/values";
import { type BadgeInput, publicBadge } from "../../lib/videos/ownership";
import {
  publicPostingRowsByVideo,
  toPublicPostings,
} from "../postings/queries";
import { getRateCard, videoFromPrice } from "../pricing/rate-card";
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
