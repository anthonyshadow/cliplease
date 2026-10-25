// The Review step (01 J5.16, J5.17; 05 §6.5 callouts 42–52; 07 §8.2, D66, D69, D74): its words, the "Where it was
// posted" summary lines and the publish blockers' rows. Pure.
import { APP_NAME, SUPPORT_EMAIL } from "../app-name";
import {
  isOneOf,
  type PostingPlatform,
  type PostingVerification,
  SOCIAL_PROVIDERS,
  type SocialProviderId,
  type VideoDisabledReason,
} from "../domain/values";
import { POSTINGS_COPY } from "../postings/copy";
import { postingPlatformLabel } from "../postings/labels";
import { videoHref, videoStepHref } from "./steps";

/** 05 §6.5's labels; "Ready to publish" and "Not posted anywhere yet" are proposed copy (owner answer Q-98). */
export const REVIEW_COPY = {
  ready: "Ready to publish",
  blockersTitle: "Before you can publish",
  title: "Title",
  link: "Link",
  linkHelper: "Can't change after you publish.",
  wherePosted: "Where it was posted",
  notPosted: "Not posted anywhere yet",
  prices: "Prices",
  buyersSee: "Buyers will see:",
  edit: "Edit",
  save: "Save",
  cancel: "Cancel",
  publish: "Publish",
  publishing: "Publishing…",
} as const;

/** The success view's words (05 §6.5 callouts 53–56) and the share link's screen-reader name (01 J6). */
export const PUBLISHED_COPY = {
  live: "Your video is live.",
  shareLink: "Share link",
  openVideo: "Open video",
  backToLibrary: "Back to Library",
} as const;

/** The admin's reasons as 05's Disable select names them. */
const VIDEO_DISABLED_REASON_LABEL = {
  rights_claim: "Rights claim",
  prohibited_content: "Prohibited content",
  other: "Other",
} as const satisfies Record<VideoDisabledReason, string>;

/** "Disabled by ClipLease: Rights claim. Questions? {SUPPORT_EMAIL}" (P13's Review Banner). */
export const disabledLine = (reason: VideoDisabledReason) =>
  `Disabled by ${APP_NAME}: ${VIDEO_DISABLED_REASON_LABEL[reason]}. Questions? ${SUPPORT_EMAIL}`;

/**
 * One posting in the Review summary (05 callout 46): "Demo · @demo.creator · Verified", "TikTok · Not verified" (a link
 * that didn't verify), "Also posted on YouTube" (no link), or an Other posting's own name. No link is ever shown here.
 */
export function postingSummaryLine(posting: {
  platform: PostingPlatform;
  label: string;
  verification: PostingVerification;
  verifiedUsername: string | null;
  url: string | null;
}): string {
  if (posting.platform === "other") return posting.label;
  if (posting.verification === "verified") {
    return `${posting.label} · ${posting.verifiedUsername} · ${POSTINGS_COPY.verified}`;
  }
  return posting.url === null
    ? `Also posted on ${posting.label}`
    : `${posting.label} · ${POSTINGS_COPY.notVerified}`;
}

/** The 07 §8.2 union, in the order the blockers show (P13 Task 6). */
export const PUBLISH_BLOCKERS = [
  "original_not_ready",
  "poster_required",
  "postings_unconfirmed",
  "same_video_unconfirmed",
  "not_attested",
  "no_enabled_option",
  "invalid_slug",
  "disabled_by_admin",
  "reconnect_account",
] as const;
export type PublishBlocker = (typeof PUBLISH_BLOCKERS)[number];

/** "Before you can publish"'s heading id: Publish refused by a blocker that appeared meanwhile moves the focus to it. */
export const BLOCKERS_HEADING_ID = "publish-blockers";

/** The Cover image and Link rows' ids, and the video page's Original file section's, so a blocker row can jump to them. */
export const COVER_IMAGE_ID = "cover-image";
export const LINK_ROW_ID = "video-link";
export const ORIGINAL_FILE_ID = "original-file";

/**
 * A blocker's row: what to do and where it's done. A page of the app, an anchor on the Review, or a connect to start
 * (ReviewBlockers builds that link with connectStartHref, coming back to `returnTo`).
 */
export type BlockerRow = { key: string; label: string } & (
  | { kind: "page" | "anchor"; href: string }
  | { kind: "reconnect"; platform: SocialProviderId; returnTo: string }
);

/**
 * Each blocker's row (04 §11.10, 05 callout 51; the rest owner answer Q-98), in blocker order. `disabled_by_admin` has
 * no row: the Review shows its Banner instead. `reconnect_account` has one row per platform to reconnect, back to this
 * Review after the connect (07 D37, D66). On the video page (Turn on, P14b) the file row jumps to its Original file
 * section and a reconnect comes back to the page.
 */
export function publishBlockerRows(
  blockers: readonly PublishBlocker[],
  videoId: string,
  reconnectPlatforms: readonly PostingPlatform[],
  on: "review" | "video_page" = "review",
): BlockerRow[] {
  const page = (label: string, href: string) =>
    ({ kind: "page", label, href }) as const;
  const anchor = (label: string, id: string) =>
    ({ kind: "anchor", label, href: `#${id}` }) as const;
  const attach = "Attach the original file";
  const rows = {
    original_not_ready:
      on === "review"
        ? page(attach, videoStepHref(videoId, "file"))
        : anchor(attach, ORIGINAL_FILE_ID),
    poster_required: anchor("Add a cover image for buyers", COVER_IMAGE_ID),
    postings_unconfirmed: page(
      "Say where it was posted",
      videoStepHref(videoId, "postings"),
    ),
    same_video_unconfirmed: page(
      "Confirm these posts show this same video",
      videoStepHref(videoId, "postings"),
    ),
    not_attested: page(
      "Answer the rights questions",
      videoStepHref(videoId, "rights"),
    ),
    no_enabled_option: page(
      "Turn on at least one use, term and territory",
      "/dashboard/pricing",
    ),
    invalid_slug: anchor("Fix the link", LINK_ROW_ID),
  } satisfies Record<
    Exclude<PublishBlocker, "disabled_by_admin" | "reconnect_account">,
    Omit<BlockerRow, "key">
  >;
  return blockers.flatMap((blocker): BlockerRow[] => {
    if (blocker === "disabled_by_admin") return [];
    if (blocker === "reconnect_account") {
      // A verified posting is always on a platform that connects (07 D66).
      return reconnectPlatforms
        .filter((platform) => isOneOf(SOCIAL_PROVIDERS, platform))
        .map((platform) => ({
          key: `reconnect:${platform}`,
          kind: "reconnect",
          label: `Reconnect ${postingPlatformLabel(platform, null)} to publish.`,
          platform,
          returnTo:
            on === "review"
              ? videoStepHref(videoId, "review")
              : videoHref(videoId),
        }));
    }
    return [{ key: blocker, ...rows[blocker] }];
  });
}

/** An _Edit_ action's accessible name: "Edit title", "Edit link", "Edit cover image", "Edit where it was posted". */
export const editRowLabel = (row: string) =>
  `${REVIEW_COPY.edit} ${row.toLowerCase()}`;
