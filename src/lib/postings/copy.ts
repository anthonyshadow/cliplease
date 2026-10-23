// "Where was it posted?"'s words (04 §9.33, §11.10 "Where was it posted?", which win over older drafts, 07 D69; 07 D18,
// D68, D72; owner answers Q-75, Q-76, Q-84, Q-85 a). Pure and client-safe: the picker, the step and the save action read every
// string from here, so no component hard-codes one. {Platform} is postingPlatformLabel's name (for Other, the creator's
// name for the site), {APP_NAME} the product name.
import {
  POSTING_PLATFORMS,
  type PostingLinkError,
  type PostingPlatform,
  type PostingUnverifiedReason,
} from "../domain/values";
import { COVER_COPY } from "../upload/messages";
import { SOURCE_PAGE_COPY } from "../videos/source-page";
import { postingPlatformLabel } from "./labels";
import { POSTINGS_MAX } from "./limits";
import type { OwnerPostingDTO } from "./types";

/** The step's fixed words (04 §11.10). */
export const POSTINGS_COPY = {
  title: "Where was it posted?",
  sub: "Pick every place you posted this video. Add the link to each post. Buyers see these.",
  /** TextField's `optional` adds " (optional)": 04's "Link to the post (optional)". */
  linkLabel: "Link to the post",
  /** Other's required name (1–40 characters, POSTING_OTHER_LABEL_MAX), on every Other posting (owner answer Q-79 a). */
  otherNameLabel: "Where? (for example, Vimeo)",
  otherNameMissing: "Add the name of the site.",
  addAnotherLink: "Add another link",
  remove: "Remove",
  /** Under the disabled adders at POSTINGS_MAX (the source counts), and the save's `too_many` refusal. */
  limit: `You can add up to ${POSTINGS_MAX} places.`,
  notPosted: "I haven't posted it anywhere yet.",
  /** 05 §6.5 States "Nothing chosen": an upload's Continue with no chip and no not-posted tick, under the chips. */
  nothingChosen: "Say where it was posted",
  fromLibrary: "From your Library",
  /** 07 D72, OQ-14: a verified posting whose account is disconnected. */
  noLongerLinked: "no longer linked",
  verified: "Verified",
  notVerified: "Not verified",
  showLink: "Show buyers this link",
  /** 07 D18: a verified unlisted post, its Switch off. */
  unlistedNote:
    "This video is unlisted. Buyers won't see the link unless you turn it on.",
  checking: "Checking the link…",
  /**
   * Check again within 30 s of the posting's last check (owner answer Q-84 a, proposed copy): the server keeps the last
   * result instead of asking the platform again, and the row shows this as a helper note, not an error.
   */
  checkedRecently: "Checked a moment ago. Try again in a few seconds.",
  move: "Move",
  /** The read-only Notice on a published video, and PostingsLockedError's words (01 J5.30). */
  locked: "Turn off to edit where it was posted.",
  /** Uploads only (01 J5.6, moved from the File step by 07 D69), with its link to /dashboard/connections. */
  uploadNote:
    "Is this video on Instagram, TikTok or YouTube? Connect the account to get a Verified label.",
  connectAccount: "Connect an account",
  /** 07 D68: NotPublicError, and a save's `private` field error. It names YouTube, the one platform with private posts. */
  refusedPrivate:
    "Make it public or unlisted on YouTube first, or remove the link.",
  /** 07 D68: AlreadyLicensableElsewhereError, the Source page's words. */
  refusedElsewhere: SOURCE_PAGE_COPY.elsewhere,
} as const;

/** 07 D68: AlreadyOnYourVideoError, naming the creator's other video. */
export const refusedOnYourVideo = (title: string) =>
  `This post is already on your video “${title}”.`;

/** The link field's placeholder by platform (04 §9.33); Other and Demo have none. */
export const POSTING_LINK_PLACEHOLDERS = {
  instagram: "instagram.com/reel/…",
  tiktok: "tiktok.com/@you/video/…",
  youtube: "youtube.com/shorts/…",
  facebook: "facebook.com/reel/…",
  x: "x.com/you/status/…",
  snapchat: "snapchat.com/spotlight/…",
  other: null,
  mock: null,
} as const satisfies Record<PostingPlatform, string | null>;

/** The chips in order (04 §9.33): Instagram … Snapchat, Other, and Demo last only while mock is enabled. */
export function postingChips(
  allowMock: boolean,
): { platform: PostingPlatform; label: string }[] {
  return POSTING_PLATFORMS.filter(
    (platform) => allowMock || platform !== "mock",
  ).map((platform) => ({
    platform,
    label: postingPlatformLabel(platform, null),
  }));
}

/** A row with no link (04 §9.33 Empty): the helper while empty, and the only words a saved link-less row shows. */
export const emptyLinkHelper = (platformLabel: string) =>
  `Optional. Without a link, buyers see “Also posted on ${platformLabel}”.`;

/** The locked Library source row's title (04 §9.33): "@demo.creator on Demo", the name printed as stored (07 D43). */
export const sourceRowTitle = (
  verifiedUsername: string,
  platformLabel: string,
) => `${verifiedUsername} on ${platformLabel}`;

/** The polite live region's line, once per result (04 §9.33): "Demo link verified" / "Instagram link not verified". */
export const postingLiveMessage = (platformLabel: string, verified: boolean) =>
  `${platformLabel} link ${verified ? "verified" : "not verified"}`;

/** "an Instagram", "an X", "a TikTok" (owner answer Q-76 a): "an" before a vowel letter or X, "a" otherwise. */
const withArticle = (label: string) =>
  `${/^[AEIOU]/i.test(label) || label === "X" ? "an" : "a"} ${label}`;

/** What a link field's error is worded from: the card's platform (and Other's name for it), and the parse's `detected`. */
export type PostingLinkErrorContext = {
  platform: PostingPlatform;
  otherLabel: string | null;
  /** wrong_platform: the platform the link belongs to. */
  detected?: PostingPlatform;
};

/** A link field's error: a parse error (POSTING_LINK_ERRORS), or the save's `private` refusal (07 D68). */
export type PostingFieldError = PostingLinkError | "private";

/** The names a link error is worded with: the card's (postingPlatformLabel), and the detected platform's. */
type LinkErrorNames = {
  label: string;
  detectedLabel: string | null;
  isOther: boolean;
};

const NOT_A_LINK = "That doesn't look like a link.";

const notFromPlatform = (names: LinkErrorNames) =>
  names.isOther
    ? "Paste a public web address."
    : `That link isn't from ${names.label}.`;

const LINK_ERROR_COPY: Record<
  PostingFieldError,
  (names: LinkErrorNames) => string
> = {
  empty: () => NOT_A_LINK,
  not_a_url: () => NOT_A_LINK,
  too_long: () => "That link is too long. Paste the link to the post.",
  bad_host: notFromPlatform,
  wrong_platform: (names) =>
    names.detectedLabel === null
      ? notFromPlatform(names)
      : `This is ${withArticle(names.detectedLabel)} link. Move it there?`,
  short_link: () =>
    "That's a short link. Open it in your browser, then copy the full address from the address bar.",
  profile_link: () => "That's a profile link. Paste the link to the post.",
  not_a_video: () => "That's a photo post. Paste the link to the video.",
  unrecognized: (names) =>
    `We don't recognize this ${names.label} link. Paste the link to the post.`,
  private: () => POSTINGS_COPY.refusedPrivate,
};

/**
 * A link field's error in 04 §11.10's words (§9.6 style, on blur or Continue, never while typing), with the card's
 * platform name (postingPlatformLabel; for Other, the creator's name for the site). wrong_platform names the detected
 * platform with Q-76's article and goes with a **Move** action; without a detected platform it reads as bad_host.
 * Other's bad_host is "Paste a public web address.".
 */
export function postingLinkErrorCopy(
  error: PostingFieldError,
  ctx: PostingLinkErrorContext,
): string {
  return LINK_ERROR_COPY[error]({
    label: postingPlatformLabel(ctx.platform, ctx.otherLabel),
    detectedLabel:
      ctx.detected === undefined
        ? null
        : postingPlatformLabel(ctx.detected, null),
    isOther: ctx.platform === "other",
  });
}

/** A saved row's one action (04 §9.33): Sync and check again · Link {Platform} · Reconnect {Platform} · Check again. */
export type PostingResultAction =
  | "sync_and_check"
  | "link_account"
  | "reconnect"
  | "check_again";

const ACTION_LABELS: Record<
  PostingResultAction,
  (platformLabel: string) => string
> = {
  sync_and_check: () => "Sync and check again",
  link_account: (platformLabel) => `Link ${platformLabel}`,
  reconnect: (platformLabel) => `Reconnect ${platformLabel}`,
  check_again: () => "Check again",
};

export const postingActionLabel = (
  action: PostingResultAction,
  platformLabel: string,
) => ACTION_LABELS[action](platformLabel);

/**
 * How a saved row's result looks (04 §9.33 Link field states): Verified (ShieldCheck + pill), Not verified (neutral pill
 * + reason), check failed (TriangleAlert), or the empty helper alone for a row with no link.
 */
export type PostingResultTone =
  | "verified"
  | "not_verified"
  | "check_failed"
  | "empty";

export type PostingResultCopy = {
  tone: PostingResultTone;
  text: string;
  action: PostingResultAction | null;
};

/** The page's facts about the row's platform, which pick the action. */
export type PostingResultContext = {
  appName: string;
  /** The platform's provider is enabled (enabledPlatforms); Facebook, X, Snapchat and Other never are. */
  providerEnabled: boolean;
  /** The creator has a `connected` account on the platform. */
  hasConnectedAccount: boolean;
  /** The creator's accounts on the platform are all `needs_reconnect` (at least one). */
  onlyNeedsReconnect: boolean;
};

export type PostingResultInput = Pick<
  OwnerPostingDTO,
  | "platform"
  | "label"
  | "url"
  | "verification"
  | "unverifiedReason"
  | "verifiedUsername"
  | "accountStatus"
>;

const emptyResult = (platformLabel: string): PostingResultCopy => ({
  tone: "empty",
  text: emptyLinkHelper(platformLabel),
  action: null,
});

const notVerified = (
  text: string,
  action: PostingResultAction | null,
): PostingResultCopy => ({ tone: "not_verified", text, action });

/** no_account: "Link {Platform}" only while the provider is enabled and nothing on it is connected yet. */
function noAccountAction(
  ctx: PostingResultContext,
): PostingResultAction | null {
  if (!ctx.providerEnabled) return null;
  return ctx.hasConnectedAccount ? "check_again" : "link_account";
}

const UNVERIFIED_COPY: Record<
  PostingUnverifiedReason,
  (posting: PostingResultInput, ctx: PostingResultContext) => PostingResultCopy
> = {
  not_found: (posting) =>
    notVerified(
      `Not verified. This post isn't on any ${posting.label} account you've linked.`,
      "sync_and_check",
    ),
  no_account: (posting, ctx) =>
    notVerified(
      `Not verified. Link your ${posting.label} account to verify it.`,
      noAccountAction(ctx),
    ),
  check_failed: (_posting, ctx) => ({
    tone: "check_failed",
    text: "We couldn't check this right now.",
    action:
      ctx.providerEnabled && ctx.onlyNeedsReconnect
        ? "reconnect"
        : "check_again",
  }),
  unverifiable: (posting) =>
    notVerified(
      posting.platform === "other"
        ? "Links from other sites can't be verified. Buyers will see the site name, for example vimeo.com."
        : "Links from Facebook, X and Snapchat can't be verified yet. Buyers will see “Not verified”.",
      null,
    ),
  no_link: (posting) => emptyResult(posting.label),
  released: (_posting, ctx) =>
    notVerified(
      `Not verified. This post was released when ${ctx.appName} turned the video off.`,
      "check_again",
    ),
};

/** "Verified · on @demo.creator", and " · no longer linked" once the account is disconnected (07 D72, OQ-14). */
function verifiedText(posting: PostingResultInput): string {
  const name =
    posting.verifiedUsername === null
      ? POSTINGS_COPY.verified
      : `Verified · on ${posting.verifiedUsername}`;
  return posting.accountStatus === "disconnected"
    ? `${name} · ${POSTINGS_COPY.noLongerLinked}`
    : name;
}

/**
 * A saved row's result in place (04 §9.33, §11.10): a row with no link shows only the empty helper, whatever its reason;
 * a verified one its account; an unverified one its reason and one action. not_found → Sync and check again; no_account
 * → Link {Platform} (enabled provider, nothing connected), Check again (connected now) or none (provider not enabled);
 * check_failed → Reconnect {Platform} when every account there needs reconnecting, else Check again; unverifiable →
 * none; released → Check again.
 */
export function postingResultCopy(
  posting: PostingResultInput,
  ctx: PostingResultContext,
): PostingResultCopy {
  if (posting.url === null) return emptyResult(posting.label);
  if (posting.verification === "verified") {
    return { tone: "verified", text: verifiedText(posting), action: null };
  }
  // An unverified row always has its reason (CHECK video_posting_reason); without one, the pill and a fresh check.
  if (posting.unverifiedReason === null) {
    return notVerified(POSTINGS_COPY.notVerified, "check_again");
  }
  return UNVERIFIED_COPY[posting.unverifiedReason](posting, ctx);
}

/**
 * The same-video block (07 D69, moved from the File step; owner answers Q-75, Q-85 a, proposed copy): the tick, its
 * field error when Continue is pressed without it, the captions under the cover and each verified post's picture, and
 * the post a duration warning names when several are verified.
 */
export const SAME_VIDEO_COPY = {
  tick: "These posts show this same video",
  missingTick: "Confirm these posts show this same video",
  cover: COVER_COPY.label,
  /** "Post" when one post is verified; "{Platform} post" ("Demo post") when there are several. */
  postCaption: (platformLabel: string, several: boolean) =>
    several ? `${platformLabel} post` : "Post",
  /**
   * durationMismatchMessage's `postName` when several posts are verified: "{Platform} post" (Q-76 a), or "{Platform} post
   * on {verified_username}" (the name as stored, 07 D43) when another verified post shares the platform (Q-85 a). With
   * one verified post the warning keeps 04's "the post".
   */
  warningPost: (platformLabel: string, account: string | null) =>
    account === null
      ? `${platformLabel} post`
      : `${platformLabel} post on ${account}`,
} as const;
