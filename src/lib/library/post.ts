// A Library tile's data and words (02 §5.4, 04 §9.12, 05 §6.1). Client-safe: the Show-more island renders tiles too.
import { PLATFORM_LABELS } from "../brand";
import type {
  SocialPostMediaType,
  SocialPostVisibility,
  SocialProviderId,
  VideoStatus,
} from "../domain/values";
import { formatCompact, formatDuration, formatPostDate } from "../format";
import { sourcePageHref, videoHref } from "../videos/steps";

/**
 * 02 §5.4's LibraryPostDTO. Additive: `visibility` (the «Private» pill), `width`/`height` (the <img> size, 07 D150),
 * `thumbnailVersion` (when the stored thumbnail changed, so a sync retries a failed image) and `fetchedAt`. `thumbnailSrc`
 * carries the version as `?v=`, so a new image replaces the browser's cached one; it is null when the post has no stored
 * thumbnail: the tile shows the failed state without asking the proxy.
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

/** The UTC day a post went up ("1 Oct 2026"), or null when the platform gave none. */
export const postedDate = (postedAt: Date | string | null) =>
  postedAt ? formatPostDate(new Date(postedAt)) : null;

/**
 * An untitled post's words: "{Platform} video · 1 Oct 2026", or "{Platform} video" without a date. The tile's caption
 * fallback (04 §9.12) and the title a Library video starts with (01 J5.12, ../videos/post-title) share it.
 */
export function untitledPostText(
  platformLabel: string,
  postedAt: Date | string | null,
): string {
  const video = `${platformLabel} video`;
  const date = postedDate(postedAt);
  return date ? `${video} · ${date}` : video;
}

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
  return {
    text: untitledPostText(PLATFORM_LABELS[post.platform], post.postedAt),
    fallback: true,
  };
}

/** `alt=""` when the caption names the image, else "{Platform} video from 1 Oct 2026" (04 §9.12). */
export function thumbnailAlt(
  post: Pick<
    LibraryPostDTO,
    "platform" | "captionExcerpt" | "title" | "postedAt"
  >,
): string {
  if (!captionText(post).fallback) return "";
  const date = postedDate(post.postedAt);
  const video = `${PLATFORM_LABELS[post.platform]} video`;
  return date ? `${video} from ${date}` : video;
}

/** A count a post can show; TikTok's shares stay out (05 §6.5 callout 3 lists views, likes and comments). */
type PostStatKey = "views" | "likes" | "comments";

/**
 * The counts each platform shows, in order (04 §9.12, §9.13); the tile shows the first. Instagram shows views only when
 * the account granted the optional permission (07 D83); that arrives with statsFor(account) in P28b, so until then it
 * has none.
 */
export const POST_STATS = {
  instagram: ["likes", "comments"],
  tiktok: ["views", "likes", "comments"],
  youtube: ["views", "likes", "comments"],
  mock: ["views", "likes", "comments"],
} as const satisfies Record<SocialProviderId, readonly PostStatKey[]>;

const STAT_NOUNS = {
  views: { field: "viewCount", one: "view", many: "views" },
  likes: { field: "likeCount", one: "like", many: "likes" },
  comments: { field: "commentCount", one: "comment", many: "comments" },
} as const satisfies Record<
  PostStatKey,
  { field: keyof LibraryPostDTO; one: string; many: string }
>;

/** A count with its noun ("14.8M views"; exactly one reads "1 view"), or null when the platform gave none. */
function statText(key: PostStatKey, n: number | null): string | null {
  if (n === null) return null;
  const { one, many } = STAT_NOUNS[key];
  return n === 1 ? `1 ${one}` : formatCompact(n, many);
}

/**
 * The tile's one stat: the platform's first count (POST_STATS), so likes on Instagram until its view counts arrive (07
 * D83, P28b) and views elsewhere; nothing when the platform gave none. Exactly one reads "1 view" / "1 like" (owner
 * answer Q-29).
 */
export function tileStat(
  post: Pick<LibraryPostDTO, "platform" | "viewCount" | "likeCount">,
): string | null {
  const key = POST_STATS[post.platform][0];
  return statText(key, post[STAT_NOUNS[key].field]);
}

/**
 * The Source page's stats line, each count with the platform's noun ("14.8M views · 888K likes · 44.4K comments", 04
 * §9.13, 05 §6.5 callout 3): the platform's counts in order, a count it didn't give left out, never summed. Exactly one
 * reads "1 view" / "1 like" (owner answer Q-29) / "1 comment" (owner answer Q-65 a).
 */
export function postStats(
  post: Pick<
    LibraryPostDTO,
    "platform" | "viewCount" | "likeCount" | "commentCount"
  >,
): string[] {
  return POST_STATS[post.platform]
    .map((key) => statText(key, post[STAT_NOUNS[key].field]))
    .filter((stat): stat is string => stat !== null);
}

/** The meta line's date and duration ("1 Oct 2026 · 0:14"); Instagram gives no duration (04 §9.12). */
export function postMetaDetails(
  post: Pick<LibraryPostDTO, "platform" | "postedAt" | "durationSec">,
): string[] {
  const duration =
    post.platform !== "instagram" && post.durationSec !== null
      ? formatDuration(post.durationSec)
      : null;
  return [postedDate(post.postedAt), duration].filter(
    (part): part is string => part !== null,
  );
}

/** The meta line after the platform word ("Demo · 1 Oct 2026 · 0:14 · 14.8M views"): date · duration (not Instagram) · the stat (04 §9.12). */
export function tileMetaDetails(
  post: Pick<
    LibraryPostDTO,
    "platform" | "postedAt" | "durationSec" | "viewCount" | "likeCount"
  >,
): string[] {
  const stat = tileStat(post);
  return stat ? [...postMetaDetails(post), stat] : postMetaDetails(post);
}

/**
 * Where the media, the caption and the action all go (07 D39): the video once the post is licensable, else the Source
 * page. A private post goes to the Source page too, which explains (P11).
 */
export function tileHref(post: Pick<LibraryPostDTO, "id" | "video">): string {
  return post.video ? videoHref(post.video.id) : sourcePageHref(post.id);
}

/** A post's two actions, on its tile (05 §6.1) and its Source page (05 §6.5). */
export const POST_ACTION_LABELS = {
  makeLicensable: "Make licensable",
  openVideo: "Open video",
} as const;

/** The tile action's label: "Open video", "Make licensable", or none for a private post (05 §6.1). */
export function tileAction(
  post: Pick<LibraryPostDTO, "video" | "visibility">,
): string | null {
  if (post.video) return POST_ACTION_LABELS.openVideo;
  return post.visibility === "private"
    ? null
    : POST_ACTION_LABELS.makeLicensable;
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
