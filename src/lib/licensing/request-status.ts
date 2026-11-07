import type { LicenseRequestStatus } from "@/lib/domain/values";
import { sentences } from "@/lib/format";

// The buyer's request status page, /r/{id} (S03; 01 §4.8, J7.13, J7.14, J7.16, J7.17, J7.19; 04 §11.3; 05 §4.3, §10;
// 07 D25, D27, D28): its words, and which view a request shows. Pure.

/** 01 J7.6, 05 §4.3 callout 9, 05 §8 (07 D81): the opening the license page, /r and request-received share. */
const autoApproves = (handle: string) =>
  `@${handle} approves requests automatically.`;

/** 04 §11.3: under the waiting countdown, and the last sentence of /r's auto-approving body. */
const UPDATES_ITSELF = "This page updates by itself.";

const exclusiveWhileDeciding = (handle: string) =>
  `Exclusive request. While @${handle} decides, no one else can request this video.`;

/** The words with nothing to fill in, and the ones a view builds from the request. */
export const REQUEST_STATUS_COPY = {
  /** S27's "Buyer link dead" (05 §10): the 404 title, with no hint that the request exists. */
  deadLink:
    "This link doesn't work anymore. Check your email for the latest one.",
  canceledTitle: "Checkout not completed",
  canceledBody: "Checkout not completed. Nothing was charged.",
  paymentFailedTitle: "Payment didn't go through",
  paymentFailedBody: "Payment didn't go through. Nothing was charged.",
  unavailableBody:
    "This video isn't available for licensing right now. Nothing was charged.",
  backToLicense: "Back to the license page",
  finishingTitle: "Finishing checkout…",
  finishingBody:
    "If you closed the payment page, you can start again from the license link. Nothing has been charged.",
  waitingTitle: (handle: string) => `Waiting for @${handle}`,
  /**
   * `total` is formatMoney's; `deadline` formatDeadline's in the viewer's zone, read after mount: until then (null) the
   * sentence that names it is left out.
   */
  waitingBody: (handle: string, total: string, deadline: string | null) =>
    sentences(
      `Your card has a hold of ${total}, not a charge.`,
      deadline && `@${handle} has until ${deadline} to approve.`,
      "We'll email you either way.",
    ),
  /** 04 §11.3: under the waiting countdown. */
  updatesItself: UPDATES_ITSELF,
  /** 01 J7.6, 05 §4.3 callout 9, 05 §8 (07 D81): "@{handle} approves requests automatically." */
  autoApproves,
  /** 04 §11.2 (owner answer Q-173): an exclusive request while the creator decides; the license page and request-received. */
  exclusiveWhileDeciding,
  /**
   * An exclusive request's line while it waits (owner answers Q-173, Q-178): /r's waiting and auto-approving views and
   * request-received say the same; while auto-approve may still run, only its kind.
   */
  exclusiveWaiting: (handle: string, autoApproving: boolean) =>
    autoApproving ? "Exclusive request." : exclusiveWhileDeciding(handle),
  /** 05 §4.3 callouts 8–9 (proposed): /r while the automatic approval runs; no deadline. */
  autoApprovingBody: (handle: string, total: string) =>
    sentences(
      autoApproves(handle),
      `Your card has a hold of ${total} until it's approved.`,
      UPDATES_ITSELF,
    ),
  /** 04 §9.9, 07 D26: a claimed request's pill. */
  processing: "Processing…",
  approvedTitle: "Approved",
  approvedBody: (handle: string, total: string) =>
    `@${handle} approved. You were charged ${total}. Your file and license are ready.`,
  declinedTitle: "Not approved",
  declinedBody: (handle: string) =>
    `@${handle} didn't approve this request. You haven't been charged, and the hold on your card has been released.`,
  videoDisabledBody:
    "This video is no longer available. You haven't been charged, and the hold on your card has been released.",
  /** 01 §4.8, 04 §11.3, 05 §8 (07 D111): declined because the video was licensed exclusively meanwhile. */
  exclusiveConflictBody:
    "This video was licensed exclusively to someone else. You weren't charged, and the hold on your card has been released.",
  expiredTitle: "No answer in time",
  /** Like waitingBody, the sentence naming the deadline waits for the viewer's zone. */
  expiredBody: (handle: string, deadline: string | null) =>
    sentences(
      deadline && `@${handle} didn't answer by ${deadline}.`,
      "You haven't been charged, and the hold on your card has been released.",
    ),
  captureFailedBody: (handle: string) =>
    `@${handle} approved, but your card couldn't be charged, so no license was issued. You haven't been charged. You can try again from the license link.`,
  /** The summary card's labels (05 §4.3, proposed; owner answer Q-126 a). */
  scope: "Scope",
  total: "Total",
} as const;

const COPY = REQUEST_STATUS_COPY;

/** What a view's words are built from: the creator, the total and the deadline (null until the viewer's zone is read). */
export type ViewFacts = {
  handle: string;
  total: string;
  deadline: string | null;
};

type ViewCopy = {
  title: (handle: string) => string;
  body: (f: ViewFacts) => string;
  /** The view ends the checkout or the payment, so it offers "Back to the license page". */
  backLink: boolean;
};

const fixed = (text: string) => () => text;

/**
 * Every view /r shows (05 §4.3): `returning` is "Finishing checkout…" for a buyer just back from Checkout, which keeps
 * checking for a while; `waiting` covers a claimed request too, its countdown swapped for "Processing…" (07 D26);
 * `auto_approving`: 05 §4.3 callouts 8–9, no deadline (07 D81).
 */
export const VIEW_COPY = {
  canceled: {
    title: fixed(COPY.canceledTitle),
    body: fixed(COPY.canceledBody),
    backLink: true,
  },
  payment_failed: {
    title: fixed(COPY.paymentFailedTitle),
    body: fixed(COPY.paymentFailedBody),
    backLink: true,
  },
  unavailable: {
    title: fixed(COPY.canceledTitle),
    body: fixed(COPY.unavailableBody),
    backLink: true,
  },
  finishing: {
    title: fixed(COPY.finishingTitle),
    body: fixed(COPY.finishingBody),
    backLink: false,
  },
  returning: {
    title: fixed(COPY.finishingTitle),
    body: fixed(COPY.finishingBody),
    backLink: false,
  },
  waiting: {
    title: COPY.waitingTitle,
    body: (f) => COPY.waitingBody(f.handle, f.total, f.deadline),
    backLink: false,
  },
  auto_approving: {
    title: fixed(COPY.processing),
    body: (f) => COPY.autoApprovingBody(f.handle, f.total),
    backLink: false,
  },
  approved: {
    title: fixed(COPY.approvedTitle),
    body: (f) => COPY.approvedBody(f.handle, f.total),
    backLink: false,
  },
  declined: {
    title: fixed(COPY.declinedTitle),
    body: (f) => COPY.declinedBody(f.handle),
    backLink: false,
  },
  video_disabled: {
    title: fixed(COPY.declinedTitle),
    body: fixed(COPY.videoDisabledBody),
    backLink: false,
  },
  exclusive_conflict: {
    title: fixed(COPY.declinedTitle),
    body: fixed(COPY.exclusiveConflictBody),
    backLink: false,
  },
  expired: {
    title: fixed(COPY.expiredTitle),
    body: (f) => COPY.expiredBody(f.handle, f.deadline),
    backLink: false,
  },
  capture_failed: {
    title: fixed(COPY.paymentFailedTitle),
    body: (f) => COPY.captureFailedBody(f.handle),
    backLink: true,
  },
} as const satisfies Record<string, ViewCopy>;

export type RequestView = keyof typeof VIEW_COPY;

/** The "Not approved" views, one per reason a buyer is told (01 §4.8): /r and the request-declined email share them. */
export type DeclinedView = "declined" | "video_disabled" | "exclusive_conflict";

/**
 * A declined request's view, from its status_reason: a disabled video says so (07 D28), and so does an exclusive
 * conflict (07 D111); the creator's decline, or a reason it doesn't know, is the creator's body. VIEW_COPY and
 * request-declined share these, so /r and the email change together.
 */
export function declinedView(statusReason: string | null): DeclinedView {
  switch (statusReason) {
    case "video_disabled":
    case "exclusive_conflict":
      return statusReason;
    default:
      return "declined";
  }
}

/**
 * The view for a request (05 §4.3), from its stored status first (07 D25: an ending shows only once it is stored):
 * `canceled` (Stripe's cancel_url) and `returning` (its success_url) only mean something while checkout is pending, so
 * a link replayed later shows where the request is. An abandoned request says why, as 07 D27 words it; a reason it
 * doesn't know reads as a checkout not completed. A declined one says why through declinedView. A waiting one reads
 * Processing… while its automatic approval may still run (07 D81), else it waits for the creator. null (a 404) for the
 * renewal rows, which live on My licenses (01 §4.8).
 */
export function requestView(
  r: {
    status: LicenseRequestStatus;
    statusReason: string | null;
    autoApproving: boolean;
  },
  q: { canceled: boolean; returning: boolean },
): RequestView | null {
  switch (r.status) {
    case "checkout_pending":
      if (q.canceled) return "canceled";
      return q.returning ? "returning" : "finishing";
    case "awaiting_approval":
      return r.autoApproving ? "auto_approving" : "waiting";
    case "approved":
      return "approved";
    case "declined":
      return declinedView(r.statusReason);
    case "expired":
      return "expired";
    case "capture_failed":
      return "capture_failed";
    case "abandoned":
      switch (r.statusReason) {
        case "amount_mismatch":
        case "hold_too_short":
          return "payment_failed";
        case "video_unavailable":
          return "unavailable";
        default:
          return "canceled";
      }
    default:
      return null;
  }
}

/** A view's title, also the tab's (owner answer Q-121 a). */
export function viewTitle(view: RequestView, handle: string): string {
  return VIEW_COPY[view].title(handle);
}
