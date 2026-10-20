// A Library tile's data and words (02 §5.4, 04 §9.12, 05 §6.1). Client-safe: the Show-more island renders tiles too.
import { PLATFORM_LABELS } from "../brand";
import type {
  SocialPostMediaType,
  SocialPostVisibility,
  SocialProviderId,
  VideoStatus,
} from "../domain/values";
import { formatCompact, formatDuration, formatPostDate } from "../format";

/**
 * 02 §5.4's LibraryPostDTO. Additive: `visibility` (the «Private» pill), `width`/`height` (the <img> size, 07 D150),
 * `thumbnailVersion` (when the stored thumbnail changed, so a sync retries a failed image) and `fetchedAt`. `thumbnailSrc` is null when
 * the post has no stored thumbnail: the tile shows the failed state without asking the proxy.
 */
export type LibraryPostDTO = {
  id: string;
  platform: SocialProviderId;
  accountUsername: string | null;
  kind: SocialPostMediaType;
  title: string | null;
  /** The whole caption; the tile clamps it to two lines with CSS. */
  captionExcerpt: string | null;
  permalink: string;
  thumbnailSrc: string | null;
  thumbnailVersion: string | null;
  width: number | null;
  height: number | null;
  postedAt: string | null;
  durationSec: number | null;
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  visibility: SocialPostVisibility | null;
  /** When a sync last saw the post: a recent sync rewrites the first page, so the grid starts over. */
  fetchedAt: string;
  /** The creator's video holding a verified posting of this post (07 D72); unverified postings never count. */
  video: { id: string; status: VideoStatus } | null;
};

/** Mock thumbnails without a stored size, and real ones until P27, render at the 9:16 default (07 D150). */
export const THUMBNAIL_FALLBACK = { width: 1080, height: 1920 } as const;

const dateOf = (post: Pick<LibraryPostDTO, "postedAt">) =>
  post.postedAt ? formatPostDate(new Date(post.postedAt)) : null;

const nonEmpty = (text: string | null) =>
  text && text.trim() !== "" ? text : null;

/** The tile's text: the caption, else the title, else "{Platform} video · 1 Oct 2026" drawn in ink-2 (`fallback`). */
export function captionText(
  post: Pick<
    LibraryPostDTO,
    "platform" | "captionExcerpt" | "title" | "postedAt"
  >,
): { text: string; fallback: boolean } {
  const own = nonEmpty(post.captionExcerpt) ?? nonEmpty(post.title);
  if (own) return { text: own, fallback: false };
  const date = dateOf(post);
  const video = `${PLATFORM_LABELS[post.platform]} video`;
  return { text: date ? `${video} · ${date}` : video, fallback: true };
}

/** `alt=""` when the caption names the image, else "{Platform} video from 1 Oct 2026" (04 §9.12). */
export function thumbnailAlt(
  post: Pick<
    LibraryPostDTO,
    "platform" | "captionExcerpt" | "title" | "postedAt"
  >,
): string {
  if (!captionText(post).fallback) return "";
  const date = dateOf(post);
  const video = `${PLATFORM_LABELS[post.platform]} video`;
  return date ? `${video} from ${date}` : video;
}

const count = (n: number, one: string, many: string) =>
  n === 1 ? `1 ${one}` : formatCompact(n, many);

/**
 * The one stat with the platform's noun: likes on Instagram until its view counts arrive (07 D83, P28b), views
 * elsewhere; nothing when the platform gave none. Exactly one reads "1 view" / "1 like" (owner answer Q-29).
 */
export function tileStat(
  post: Pick<LibraryPostDTO, "platform" | "viewCount" | "likeCount">,
): string | null {
  if (post.platform === "instagram") {
    return post.likeCount === null
      ? null
      : count(post.likeCount, "like", "likes");
  }
  return post.viewCount === null
    ? null
    : count(post.viewCount, "view", "views");
}

/** The meta line after the platform word ("Demo · 1 Oct 2026 · 0:14 · 14.8M views"): date · duration (not Instagram) · the stat (04 §9.12). */
export function tileMetaDetails(
  post: Pick<
    LibraryPostDTO,
    "platform" | "postedAt" | "durationSec" | "viewCount" | "likeCount"
  >,
): string[] {
  const duration =
    post.platform !== "instagram" && post.durationSec !== null
      ? formatDuration(post.durationSec)
      : null;
  return [dateOf(post), duration, tileStat(post)].filter(
    (part): part is string => part !== null,
  );
}

/**
 * Where the media, the caption and the action all go (07 D39): the video once the post is licensable, else the Source
 * page. A private post goes to the Source page too, which explains (P11).
 */
export function tileHref(post: Pick<LibraryPostDTO, "id" | "video">): string {
  return post.video
    ? `/dashboard/videos/${post.video.id}`
    : `/dashboard/videos/new?post=${post.id}`;
}

/** The tile action's label: "Open video", "Make licensable", or none for a private post (05 §6.1). */
export function tileAction(
  post: Pick<LibraryPostDTO, "video" | "visibility">,
): string | null {
  if (post.video) return "Open video";
  return post.visibility === "private" ? null : "Make licensable";
}

/** The neutral pills, in 04 §9.9's words. */
export function tilePills(
  post: Pick<LibraryPostDTO, "video" | "kind" | "visibility">,
): string[] {
  return [
    post.video ? "Licensable" : null,
    post.kind === "short" ? "Short" : null,
    post.visibility === "private" ? "Private" : null,
  ].filter((pill): pill is string => pill !== null);
}

/** The id of a tile's link: Show more and Load older move the focus to it. */
export const tileLinkId = (postId: string) => `tile-${postId}`;

/** The failed thumbnail's line (04 §9.12, 01 J3.10). */
export const thumbnailFailedText = (platform: SocialProviderId) =>
  `${PLATFORM_LABELS[platform]} · Sync to refresh`;
