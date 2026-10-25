// The video page (S19; 05 §6.7; 01 J5.19–J5.21, J6) and the Videos Menu (05 §6.8): their words and lines. Pure.
import type { Currency, PostingPlatform, VideoStatus } from "../domain/values";
import { formatBytes, formatDuration, formatPostDate } from "../format";
import { postingPlatformLabel } from "../postings/labels";
import { fromPriceText } from "../pricing/from-price";
import { RIGHTS_COPY } from "./rights";

/**
 * 05 §6.7's labels. Proposed copy (owner answer Q-101 a): the Requests line, the Off banner, the Replace lock line,
 * "From {price} (your rate card)" (until P19d's VideoPriceEditor) and the two loading labels.
 */
export const VIDEO_PAGE_COPY = {
  requests: "Requests",
  openInbox: "Open Inbox",
  details: "Details",
  original: "Original file",
  rights: "Rights",
  prices: "Prices for this video",
  editRateCard: "Edit your rate card",
  turnOff: "Turn off",
  turningOff: "Turning off…",
  turnOn: "Turn on",
  turningOn: "Turning on…",
  off: "Buyers can't see this video right now.",
  replaceLocked:
    "Can't replace while the video is live, or once a request or license exists.",
  /** After a Details edit (05 §6.7 States; approved with P05's Settings, Q-07). */
  saved: "Saved.",
  /** After the Link on a video published once (07 D09). */
  locked: "(locked)",
} as const;

/** 05 §6.7 callout 4: "1 waiting · 2 licenses" ("1 license" for one). */
export const requestsLine = (waiting: number, licenses: number) =>
  `${waiting} waiting · ${licenses} ${licenses === 1 ? "license" : "licenses"}`;

/**
 * 05 §6.7 callout 6: "first-snow.mp4 · 0:14 · 720 × 1280 · 0.2 MB", leaving out what isn't known (a duration or size the
 * browser couldn't read).
 */
export function originalLine(o: {
  originalFilename: string | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  originalBytes: number | null;
}): string {
  return [
    o.originalFilename,
    o.durationMs ? formatDuration(o.durationMs / 1000) : null,
    o.width && o.height ? `${o.width} × ${o.height}` : null,
    o.originalBytes ? formatBytes(o.originalBytes) : null,
  ]
    .filter((part) => part)
    .join(" · ");
}

const answer = (value: boolean) => (value ? RIGHTS_COPY.yes : RIGHTS_COPY.no);

/** "Music: No · People: No" (05 §6.7 callout 7); null until both are answered. */
export function rightsSummary(
  containsMusic: boolean | null,
  identifiablePeople: boolean | null,
): string | null {
  if (containsMusic === null || identifiablePeople === null) return null;
  return `Music: ${answer(containsMusic)} · People: ${answer(identifiablePeople)}`;
}

/** "From CA$150.00 (your rate card)", or "From CA$200.00" when the video has its own base price (P19d). */
export const fromPriceLine = (
  cents: number,
  currency: Currency,
  basePriceSource: "rate_card" | "video",
) =>
  `${fromPriceText(cents, currency)}${basePriceSource === "rate_card" ? " (your rate card)" : ""}`;

/** A video's link is offered while it is Live or Off (05 §6.7, §6.8): never for a draft or a disabled video. */
export const offersShareLink = (status: VideoStatus) =>
  status === "published" || status === "unpublished";

/**
 * 01 J3.9's banner for a verified posting whose post the platform removed: "This post was removed from Instagram on 14
 * Oct 2026. Your video stays live." The second sentence only while the video is live (owner answer Q-102 a).
 */
export function removedPostLine(
  platform: PostingPlatform,
  removedAt: Date,
  status: VideoStatus,
): string {
  const removed = `This post was removed from ${postingPlatformLabel(platform, null)} on ${formatPostDate(removedAt)}.`;
  return status === "published" ? `${removed} Your video stays live.` : removed;
}

/** The /dashboard/videos title's id: it takes the focus once a deleted draft's card has left the page. */
export const VIDEOS_TITLE_ID = "videos-title";

/** The Videos card Menu's words (05 §6.8 callout 4: Edit is REVIEW_COPY.edit; the sheet's are proposed, Q-101 a). */
export const VIDEO_MENU_COPY = {
  deleteDraft: "Delete draft",
  deleteTitle: "Delete this draft?",
  keepDraft: "Keep draft",
  deleting: "Deleting…",
  /** The Menu trigger's name (05 §6.2's "More for @maya.films" pattern). */
  more: (title: string) => `More for ${title}`,
} as const;

/**
 * The card Menu's item after Edit (05 §6.8): Turn off while live, Turn on while off, Delete draft for a draft; none for
 * a disabled video, whose owner can't turn it on (disabled_by_admin) or delete it.
 */
export function videoMenuAction(
  status: VideoStatus,
): "turn_off" | "turn_on" | "delete_draft" | null {
  switch (status) {
    case "published":
      return "turn_off";
    case "unpublished":
      return "turn_on";
    case "draft":
      return "delete_draft";
    case "disabled":
      return null;
  }
}
