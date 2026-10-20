import "server-only";
import { and, eq, like } from "drizzle-orm";
import type { db } from "../../db/client";
import { video } from "../../db/schema";
import type { NewVideo } from "../../db/schema/types";
import { slugFromTitle, withSlugSuffix } from "../../lib/videos/slug";

// A video's slug is unique per creator (video_creator_slug_uidx; 01 J5.12). Shared by createVideoFromUpload and P11's
// createVideoFromPost.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Room for a 7-digit suffix: every candidate starts with this much of the base.
const LONGEST_SUFFIX = "-9999999";
// One try per slug lost to a parallel insert; the last of three creates of one title at once settles on its third.
const SLUG_ATTEMPTS = 3;

/** The first free slug of `base`, `base-2`, `base-3`, … among the creator's videos (their rows as this statement sees them). */
export async function uniqueSlugForCreator(
  tx: Pick<Tx, "select">,
  creatorId: string,
  base: string,
): Promise<string> {
  // Every candidate begins with the base cut for the longest suffix; slugs are [a-z0-9-], so the pattern needs no escape.
  const stem = withSlugSuffix(base, 9_999_999).slice(0, -LONGEST_SUFFIX.length);
  const rows = await tx
    .select({ slug: video.slug })
    .from(video)
    .where(and(eq(video.creatorId, creatorId), like(video.slug, `${stem}%`)));
  const taken = new Set(rows.map((r) => r.slug));
  for (let n = 1; ; n++) {
    const slug = withSlugSuffix(base, n);
    if (!taken.has(slug)) return slug;
  }
}

/**
 * Inserts the video with the first free slug of its title. When a parallel insert takes that slug first, the insert
 * does nothing and the next free one is tried, up to SLUG_ATTEMPTS in all; the transaction stays usable. Returns the slug.
 */
export async function insertVideoWithUniqueSlug(
  tx: Pick<Tx, "select" | "insert">,
  values: Omit<NewVideo, "slug">,
): Promise<string> {
  const base = slugFromTitle(values.title);
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const slug = await uniqueSlugForCreator(tx, values.creatorId, base);
    const inserted = await tx
      .insert(video)
      .values({ ...values, slug })
      .onConflictDoNothing({ target: [video.creatorId, video.slug] })
      .returning({ id: video.id });
    if (inserted.length > 0) return slug;
  }
  throw new Error(`no free video slug after ${SLUG_ATTEMPTS} attempts`);
}
