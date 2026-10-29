import { sentences } from "@/lib/format";
import type { CreatorRequest } from "./request-dto";
import { REQUEST_STATUS_COPY } from "./request-status";
import type { DisplayStatus } from "./transitions";

// The creator's Inbox and request page (S14, S15; 04 §9.11, §11.5; 05 §6.3, §6.4; 01 J8): their words, and what each
// request shows. Deadlines are formatted in the viewer's zone after mount (07 D84): a sentence that names one is left
// out until then (null). "Open request" and the request page's heading were proposed copy (owner answer Q-126 a);
// "No decided requests yet." is the owner's answer Q-127 a. Pure.

export const INBOX_COPY = {
  /** The SegmentedControl's name and the request page's tab title (Q-126 a). */
  inbox: "Inbox",
  title: "Inbox.",
  waitingForYou: (n: number) => `${n} waiting for you.`,
  caughtUp: "All caught up.",
  waitingSegment: (n: number) => `Waiting ${n}`,
  history: "History",
  /** Read before a creator's countdown by screen readers (04 §9.9). */
  waitingForYouSr: "Waiting for you",
  /** "{title} · You get CA$1,575.00" on a waiting row; History prints the price alone (05 §6.3). */
  youGet: (price: string) => `You get ${price}`,
  details: "Details",
  openRequest: "Open request",
  empty: "No requests yet. Share a link to get your first one.",
  makeLicensable: "Make a video licensable",
  historyEmpty: "No decided requests yet.",
  setUpPayouts: "Set up payouts",
  /** 01 J8.3, 07 D77: while a request waits and payouts aren't active. */
  payoutsWaiting: (deadline: string | null) =>
    sentences(
      "Finish payout setup to approve.",
      deadline && `This request stays open until ${deadline}.`,
    ),
  detailHeading: (licenseeName: string, title: string) =>
    `${licenseeName} wants to license ${title}`,
  facts: {
    licensedTo: "Licensed to",
    contact: "Contact",
    plannedUse: "Planned use",
    scope: "Scope",
    youGet: "You get",
    payment: "Payment",
    answerBy: "Answer by",
  },
  youGetFact: (price: string, total: string) =>
    `${price} (buyer pays ${total} incl. service fee)`,
  paymentFact: "Card on hold. Charged only if you approve.",
  answerByFact: (deadline: string | null) =>
    sentences(
      deadline && `${deadline}.`,
      "If you don't answer, the hold is released.",
    ),
  expiredLine: (deadline: string | null) =>
    sentences(
      "Expired.",
      deadline && `No answer by ${deadline}.`,
      "The buyer wasn't charged.",
    ),
  captureFailedLine:
    "Payment didn't go through. No license was issued and the buyer wasn't charged.",
  videoDisabledLine:
    "This video was disabled, so the request was declined. The buyer wasn't charged.",
} as const;

/** A request's pill (04 §9.9, 01 §3.0), or null while it waits on its countdown. */
export function requestPill(
  status: DisplayStatus,
): { label: string; tone: "neutral" | "cleared" | "danger" } | null {
  switch (status) {
    case "processing":
      return { label: REQUEST_STATUS_COPY.processing, tone: "neutral" };
    case "approved":
      return { label: "Approved", tone: "cleared" };
    case "declined":
      return { label: "Declined", tone: "neutral" };
    case "expired":
      return { label: "Expired", tone: "neutral" };
    case "capture_failed":
      return { label: "Payment failed", tone: "danger" };
    default:
      return null;
  }
}

/**
 * The line under a decided request (04 §11.5): an expiry, a failed capture (danger text) or a disabled video. Approved
 * and plainly declined requests have none.
 */
export function outcomeLine(
  r: Pick<CreatorRequest, "status" | "statusReason">,
  deadline: string | null,
): { text: string; danger: boolean } | null {
  if (r.status === "expired") {
    return { text: INBOX_COPY.expiredLine(deadline), danger: false };
  }
  if (r.status === "capture_failed") {
    return { text: INBOX_COPY.captureFailedLine, danger: true };
  }
  if (r.status === "declined" && r.statusReason === "video_disabled") {
    return { text: INBOX_COPY.videoDisabledLine, danger: false };
  }
  return null;
}
