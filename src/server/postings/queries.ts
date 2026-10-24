import "server-only";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import {
  socialAccount,
  socialPost,
  video,
  videoPosting,
} from "../../db/schema";
import type { PostingPlatform } from "../../lib/domain/values";
import { postingPlatformLabel } from "../../lib/postings/labels";
import type { OwnerPostingDTO } from "../../lib/postings/types";
import { isUuid } from "../../lib/validation/uuid";
import { primaryVerifiedPosting } from "../../lib/videos/ownership";
import type { Actor, CreatorActor } from "../auth/actor";
import { postThumbnail } from "../library/queries";
import { VideoNotFoundError } from "../videos/errors";

// A video's postings as plain DTOs (02 §5.12; 03 §7.4 "Where-posted step"; 07 D70), never rows. The owner sees every
// posting with its stored canonical url; buyers see published videos only, never a social id, a thumbnail or a raw paste.

/** One posting as buyers see it (02 §5.12, 07 D70): a handle only when verified, never an id or an image. */
export type PublicPostingDTO = {
  platform: PostingPlatform;
  label: string;
  verified: boolean;
  /** Verified only: an unverified posting never shows a handle. */
  verifiedUsername: string | null;
  /** Verified only: the account's connect time when it verified, as ISO ("Account linked {date}"). */
  linkedAt: string | null;
  /** Verified and its account is `disconnected` (OQ-14): "· no longer linked". */
  noLongerLinked: boolean;
  /**
   * The stored canonical url when the creator shows it (`show_link`) and the row is unverified or its post isn't
   * `removed`; else null.
   */
  url: string | null;
  /** Other with a url: its hostname as text, without a leading "www." ("vimeo.com"). */
  hostLabel: string | null;
};

/** A published video's postings: verified first, then the creator's order, and the badge's primary posting (07 D70). */
export type PublicPostings = {
  primary: PublicPostingDTO | null;
  postings: PublicPostingDTO[];
};

/**
 * The owner's read of postings matching `where` (over video_posting and its video), in position order: each with its
 * account's status and its post's image, length and visibility. listVideoPostings and getOwnerPosting share it.
 */
async function ownerPostingRows(where: SQL | undefined) {
  return db
    .select({
      id: videoPosting.id,
      platform: videoPosting.platform,
      otherLabel: videoPosting.otherLabel,
      url: videoPosting.url,
      isSource: videoPosting.isSource,
      verification: videoPosting.verification,
      unverifiedReason: videoPosting.unverifiedReason,
      verifiedUsername: videoPosting.verifiedUsername,
      verifiedAccountLinkedAt: videoPosting.verifiedAccountLinkedAt,
      showLink: videoPosting.showLink,
      checkedAt: videoPosting.checkedAt,
      position: videoPosting.position,
      accountStatus: socialAccount.status,
      postId: socialPost.id,
      thumbnailUrl: socialPost.thumbnailUrl,
      thumbnailFetchedAt: socialPost.thumbnailFetchedAt,
      durationSec: socialPost.durationSec,
      visibility: socialPost.visibility,
    })
    .from(videoPosting)
    .innerJoin(video, eq(video.id, videoPosting.videoId))
    .leftJoin(socialAccount, eq(socialAccount.id, videoPosting.socialAccountId))
    .leftJoin(socialPost, eq(socialPost.id, videoPosting.socialPostId))
    .where(where)
    .orderBy(asc(videoPosting.position));
}

/** A posting row with its account's and post's columns, as listVideoPostings and getOwnerPosting read it. */
export type OwnerPostingRow = Awaited<
  ReturnType<typeof ownerPostingRows>
>[number];

/**
 * The video's postings in position order for its owner, or for an admin (02 §5.12). A missing video, another creator's,
 * or an id that isn't a uuid → VideoNotFoundError; a video with no postings → []. One read when the video has postings;
 * only when it has none is the video itself looked up, to tell [] from not found.
 */
export async function listVideoPostings(
  a: Actor,
  videoId: string,
): Promise<OwnerPostingDTO[]> {
  if (a.kind !== "creator" && a.kind !== "admin") {
    throw new Error("a creator or admin actor is required");
  }
  if (!isUuid(videoId)) throw new VideoNotFoundError();
  const scope =
    a.kind === "creator" ? eq(video.creatorId, a.creatorId) : undefined;
  const rows = await ownerPostingRows(
    and(eq(videoPosting.videoId, videoId), scope),
  );
  if (rows.length === 0) {
    const [owned] = await db
      .select({ id: video.id })
      .from(video)
      .where(and(eq(video.id, videoId), scope));
    if (!owned) throw new VideoNotFoundError();
  }
  return rows.map(toOwnerPosting);
}

/**
 * One of the creator's postings by id as the owner's DTO (02 §5.12; Check again's answer), scoped by its video's
 * creator. None (another creator's, gone, or an id that isn't a uuid) → VideoNotFoundError.
 */
export async function getOwnerPosting(
  actor: CreatorActor,
  postingId: string,
): Promise<OwnerPostingDTO> {
  if (!isUuid(postingId)) throw new VideoNotFoundError();
  const [row] = await ownerPostingRows(
    and(eq(videoPosting.id, postingId), eq(video.creatorId, actor.creatorId)),
  );
  if (!row) throw new VideoNotFoundError();
  return toOwnerPosting(row);
}

/** The owner's DTO: the handle, the thumbnail, the duration and the visibility only on a verified posting. */
export function toOwnerPosting(row: OwnerPostingRow): OwnerPostingDTO {
  const verified = row.verification === "verified";
  return {
    id: row.id,
    platform: row.platform,
    label: postingPlatformLabel(row.platform, row.otherLabel),
    url: row.url,
    isSource: row.isSource,
    verification: row.verification,
    unverifiedReason: row.unverifiedReason,
    verifiedUsername: verified ? row.verifiedUsername : null,
    verifiedAccountLinkedAt: verified
      ? (row.verifiedAccountLinkedAt?.toISOString() ?? null)
      : null,
    accountStatus: row.accountStatus,
    thumbnailSrc:
      verified && row.postId !== null
        ? postThumbnail({
            id: row.postId,
            thumbnailUrl: row.thumbnailUrl,
            thumbnailFetchedAt: row.thumbnailFetchedAt,
          }).thumbnailSrc
        : null,
    durationSec: verified ? row.durationSec : null,
    visibility: verified ? row.visibility : null,
    showLink: row.showLink,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    position: row.position,
  };
}

/**
 * A video's postings as buyers see them (02 §5.12; 07 D70, D89): only while the video is `published` (a draft, an
 * unpublished or a disabled video, or an id that isn't a uuid, gives none).
 */
export async function getPublicPostings(
  videoId: string,
): Promise<PublicPostings> {
  if (!isUuid(videoId)) return { primary: null, postings: [] };
  return toPublicPostings(await publicPostingRows(videoId));
}

/** A published video's postings in position order, each with its account's and its post's status. */
async function publicPostingRows(videoId: string) {
  return db
    .select({
      platform: videoPosting.platform,
      otherLabel: videoPosting.otherLabel,
      url: videoPosting.url,
      isSource: videoPosting.isSource,
      verification: videoPosting.verification,
      verifiedUsername: videoPosting.verifiedUsername,
      verifiedAccountLinkedAt: videoPosting.verifiedAccountLinkedAt,
      showLink: videoPosting.showLink,
      position: videoPosting.position,
      accountStatus: socialAccount.status,
      postStatus: socialPost.status,
    })
    .from(videoPosting)
    .innerJoin(
      video,
      and(eq(video.id, videoPosting.videoId), eq(video.status, "published")),
    )
    .leftJoin(socialAccount, eq(socialAccount.id, videoPosting.socialAccountId))
    .leftJoin(socialPost, eq(socialPost.id, videoPosting.socialPostId))
    .where(eq(videoPosting.videoId, videoId))
    .orderBy(asc(videoPosting.position));
}

/** A posting row with its account's and post's status, as getPublicPostings reads it. */
export type PublicPostingRow = Awaited<
  ReturnType<typeof publicPostingRows>
>[number];

/**
 * The buyer's list (07 D70): verified rows by position, then unverified rows by position. `primary` is the verified
 * source posting, else the lowest-position verified one, else null (the badge then reads "Self-attested by the creator").
 */
export function toPublicPostings(
  rows: readonly PublicPostingRow[],
): PublicPostings {
  const byPosition = [...rows].sort((x, y) => x.position - y.position);
  const verified = byPosition.filter((row) => row.verification === "verified");
  const primaryRow = primaryVerifiedPosting(byPosition);
  const ordered = [
    ...verified,
    ...byPosition.filter((row) => row.verification !== "verified"),
  ];
  const postings = ordered.map(toPublicPosting);
  return {
    primary: primaryRow ? postings[ordered.indexOf(primaryRow)] : null,
    postings,
  };
}

function toPublicPosting(row: PublicPostingRow): PublicPostingDTO {
  const verified = row.verification === "verified";
  const url =
    row.showLink && (!verified || row.postStatus !== "removed")
      ? row.url
      : null;
  return {
    platform: row.platform,
    label: postingPlatformLabel(row.platform, row.otherLabel),
    verified,
    verifiedUsername: verified ? row.verifiedUsername : null,
    linkedAt: verified
      ? (row.verifiedAccountLinkedAt?.toISOString() ?? null)
      : null,
    noLongerLinked: verified && row.accountStatus === "disconnected",
    url,
    hostLabel:
      row.platform === "other" && url !== null
        ? new URL(url).hostname.replace(/^www\./, "")
        : null,
  };
}
