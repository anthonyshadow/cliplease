// The Source page's words and what it shows, and the Library File step's words (S16; 05 §6.5 Source page, States and
// callout 9, 04 §9.13; 01 J3.14, J5.1–J5.5; 07 D18, D39; owner answers Q-62 a, Q-63–Q-65). Pure and client-safe: the
// Source page, its Make licensable island and the Library File step read it; the actions word their refusals with it.
import type { MakeLicensableErrorCode } from "../../server/videos/errors";
import { APP_NAME } from "../app-name";
import { PLATFORM_LABELS } from "../brand";
import type {
  SocialAccountStatus,
  SocialPostVisibility,
  SocialProviderId,
} from "../domain/values";
import { LIBRARY_PATH } from "../library/filter";
import {
  type LibraryPostDTO,
  POST_ACTION_LABELS,
  postedDate,
  postMetaDetails,
  postStats,
} from "../library/post";
import { GENERIC_ERROR_MESSAGE } from "../result";
import {
  type VerifiedBadgeInput,
  verifiedAs,
  verifiedUsernameDisplay,
} from "./ownership";
import { NEW_VIDEO_PATH, sourcePageHref, videoHref } from "./steps";

/** The page's fixed words. */
export const SOURCE_PAGE_COPY = {
  buyersWillSee: "Buyers will see:",
  makeLicensable: POST_ACTION_LABELS.makeLicensable,
  /** Make licensable's pending label while the live check runs (05 WF-8, callout 7; owner answer Q-65 a). */
  verifying: "Verifying…",
  alreadyLicensable: "This post is already licensable.",
  openVideo: POST_ACTION_LABELS.openVideo,
  /** 01 J3.7, 07 D18: it names YouTube, the one platform whose posts can be private. */
  notPublic:
    "Make it public or unlisted on YouTube first, or upload it instead.",
  uploadFile: "Upload a file",
  openLibrary: "Open Library",
  elsewhere: `This post is already licensable from another ${APP_NAME} account.`,
} as const;

/**
 * The Library File step's Notice: 01 J5.5 verbatim, `{Platform}` filled; shown for every platform, as there is no
 * import (07 D64).
 */
export function sourceNotice(platform: SocialProviderId): string {
  const name = PLATFORM_LABELS[platform];
  return `${name} doesn't share original files with apps. Upload the original from your phone or camera, the version without the ${name} watermark.`;
}

/** The reconnect line that takes the badge preview's place (01 J3.12, J5.3). */
const reconnectToVerify = (platform: SocialProviderId) =>
  `Reconnect ${PLATFORM_LABELS[platform]} to verify this post`;

/** 01 J5.2. */
const notOnAccountMessage = (platform: SocialProviderId) =>
  `We couldn't find this post on your ${PLATFORM_LABELS[platform]} account. Sync and try again.`;

/** "View on Demo ↗" and its name, which keeps the visible words (owner answer Q-65 a). */
export const viewOnLabel = (platform: SocialProviderId) =>
  `View on ${PLATFORM_LABELS[platform]} ↗`;
export const viewOnAriaLabel = (platform: SocialProviderId) =>
  `View on ${PLATFORM_LABELS[platform]} (opens in a new tab)`;

/** A refusal the action returns; not_found is a 404 instead. */
export type MakeLicensableCode = Exclude<MakeLicensableErrorCode, "not_found">;

/** Make licensable's refusal, as the action returns it. */
export type MakeLicensableRefusal = {
  ok: false;
  error: { code: MakeLicensableCode; message: string };
};

/** The words for a refusal (01 J5.2–J5.4, 07 D18; 04 §11.10's generic line for a platform that failed or limited us). */
export function makeLicensableMessage(
  code: MakeLicensableCode,
  platform: SocialProviderId,
): string {
  switch (code) {
    case "needs_reconnect":
      return reconnectToVerify(platform);
    case "not_on_account":
      return notOnAccountMessage(platform);
    case "not_public":
      return SOURCE_PAGE_COPY.notPublic;
    case "already_licensable_elsewhere":
      return SOURCE_PAGE_COPY.elsewhere;
    case "upstream":
      return GENERIC_ERROR_MESSAGE;
  }
}

/** What the post itself says before anything is pressed, first match (05 §6.5 States). */
export type SourcePageState =
  | { kind: "already_licensable"; videoId: string }
  | { kind: "private" }
  | { kind: "needs_reconnect" }
  | { kind: "ready" };

/** The linked account's name fields, as the Source page's post carries them. */
type AccountName = {
  accountUsername: string | null;
  accountDisplayName: string | null;
};

/** The account's name as the badge writes it (07 D43), or null when the platform gave neither a handle nor a name. */
const accountName = (post: AccountName) =>
  verifiedUsernameDisplay({
    username: post.accountUsername,
    displayName: post.accountDisplayName,
  });

type SourceAccountFields = AccountName & { platform: SocialProviderId };

/**
 * An account that can't verify the post (verifiedAs: not connected, or without a handle or a name, which
 * createVideoFromPost refuses too) shows the reconnect state: reconnecting reads the profile again.
 */
export function sourcePageState(
  post: AccountName & {
    video: LibraryPostDTO["video"];
    visibility: SocialPostVisibility | null;
    accountStatus: SocialAccountStatus;
  },
): SourcePageState {
  if (post.video) {
    return { kind: "already_licensable", videoId: post.video.id };
  }
  if (post.visibility === "private") return { kind: "private" };
  const name = verifiedAs({
    status: post.accountStatus,
    username: post.accountUsername,
    displayName: post.accountDisplayName,
  });
  return name === null ? { kind: "needs_reconnect" } : { kind: "ready" };
}

type SourceLink = { label: string; href: string };

/** A Banner over the primary; `fromAction` ones are announced once by the island, so they aren't live themselves. */
type SourceBanner = {
  tone: "info" | "error";
  message: string;
  link: SourceLink | null;
  fromAction: boolean;
};

type SourcePrimary =
  | { kind: "make_licensable" }
  | { kind: "reconnect"; label: string; returnTo: string }
  | { kind: "open_video"; label: string; href: string };

/** The bottom of the page, top to bottom: the preview, the private line, a Banner, the primary. */
export type SourceActionsView = {
  /** "Buyers will see:" with the badge preview, or the reconnect line in its place; null shows neither. */
  preview: { kind: "badge" } | { kind: "reconnect"; line: string } | null;
  /** A private post: its line (text, 04 §9.13) and "Upload a file"; never a primary with it. */
  notPublic: { line: string; upload: SourceLink } | null;
  banner: SourceBanner | null;
  primary: SourcePrimary | null;
};

/**
 * The bottom of the Source page from the post's state and the last press's refusal. Already licensable wins (Q-62 a:
 * "Open video"). A private post, cached or live, gets its line and "Upload a file", with no badge and no primary. An
 * account that needs reconnecting, cached or found by the press, swaps the preview for the reconnect line and the
 * primary for Reconnect, which comes back here. Otherwise the badge preview stays and the refusal is a Banner over the
 * primary: not on the account adds "Open Library" and keeps Make licensable; already licensable elsewhere drops it (a
 * second press would fail the same way); anything else is the generic line with Make licensable as the retry.
 */
export function sourceActionsView({
  state,
  refusal,
  platform,
  postId,
}: {
  state: SourcePageState;
  refusal: MakeLicensableCode | null;
  platform: SocialProviderId;
  postId: string;
}): SourceActionsView {
  const none = { preview: null, notPublic: null, banner: null, primary: null };
  if (state.kind === "already_licensable") {
    return {
      ...none,
      banner: {
        tone: "info",
        message: SOURCE_PAGE_COPY.alreadyLicensable,
        link: null,
        fromAction: false,
      },
      primary: {
        kind: "open_video",
        label: SOURCE_PAGE_COPY.openVideo,
        href: videoHref(state.videoId),
      },
    };
  }
  if (state.kind === "private" || refusal === "not_public") {
    return {
      ...none,
      notPublic: {
        line: SOURCE_PAGE_COPY.notPublic,
        upload: { label: SOURCE_PAGE_COPY.uploadFile, href: NEW_VIDEO_PATH },
      },
    };
  }
  if (state.kind === "needs_reconnect" || refusal === "needs_reconnect") {
    return {
      ...none,
      preview: { kind: "reconnect", line: reconnectToVerify(platform) },
      primary: {
        kind: "reconnect",
        label: `Reconnect ${PLATFORM_LABELS[platform]}`,
        returnTo: sourcePageHref(postId),
      },
    };
  }
  const preview = { kind: "badge" } as const;
  const makeLicensable = { kind: "make_licensable" } as const;
  if (refusal === null) return { ...none, preview, primary: makeLicensable };
  const banner = (link: SourceLink | null): SourceBanner => ({
    tone: "error",
    message: makeLicensableMessage(refusal, platform),
    link,
    fromAction: true,
  });
  if (refusal === "already_licensable_elsewhere") {
    return { ...none, preview, banner: banner(null) };
  }
  const openLibrary = {
    label: SOURCE_PAGE_COPY.openLibrary,
    href: LIBRARY_PATH,
  };
  return {
    ...none,
    preview,
    banner: banner(refusal === "not_on_account" ? openLibrary : null),
    primary: makeLicensable,
  };
}

/**
 * "From Demo · @demo.creator · posted 1 Oct 2026 · Verified": the Source page's line (05 callout 5) and the Library
 * File step's (callout 9). The name is 07 D43's display form, printed as it comes (never given an "@"); a part with
 * no value is left out (a stale scrub clears `posted_at`, 07 D72), and "Verified" only while the posting is verified.
 */
export function provenanceLine(post: {
  platform: SocialProviderId;
  name: string | null;
  postedAt: Date | string | null;
  verified: boolean;
}): string {
  const date = postedDate(post.postedAt);
  return [
    `From ${PLATFORM_LABELS[post.platform]}`,
    post.name,
    date ? `posted ${date}` : null,
    post.verified ? "Verified" : null,
  ]
    .filter((part) => part)
    .join(" · ");
}

/** The Source page's provenance line: the account as the badge names it, and no "· Verified" yet (05 over 01 J5.1). */
export const sourceProvenanceLine = (
  post: SourceAccountFields & { postedAt: string | null },
) =>
  provenanceLine({
    platform: post.platform,
    name: accountName(post),
    postedAt: post.postedAt,
    verified: false,
  });

/**
 * The "Buyers will see:" preview (05 callout 6), built from the linked account before anything is saved: what
 * createVideoFromPost stores on the source posting. Null when the account has neither a handle nor a name: the action
 * refuses such an account too, so the page promises no badge and shows the reconnect state (sourcePageState).
 */
export function sourceBadge(
  post: SourceAccountFields & { accountConnectedAt: string },
): VerifiedBadgeInput | null {
  const verifiedUsername = accountName(post);
  if (verifiedUsername === null) return null;
  return {
    size: "lg",
    ownership: "verified_owner",
    provider: post.platform,
    platformLabel: PLATFORM_LABELS[post.platform],
    verifiedUsername,
    linkedAt: post.accountConnectedAt,
    noLongerLinked: false,
  };
}

/** "Demo · 1 Oct 2026 · 0:14" (05 §6.5 frame). */
export const sourceMetaLine = (
  post: Pick<LibraryPostDTO, "platform" | "postedAt" | "durationSec">,
) => [PLATFORM_LABELS[post.platform], ...postMetaDetails(post)].join(" · ");

/** "14.8M views · 888K likes · 44.4K comments" (05 callout 3), or null when the platform gave no count. */
export function sourceStatsLine(
  post: Pick<
    LibraryPostDTO,
    "platform" | "viewCount" | "likeCount" | "commentCount"
  >,
): string | null {
  const stats = postStats(post);
  return stats.length > 0 ? stats.join(" · ") : null;
}
