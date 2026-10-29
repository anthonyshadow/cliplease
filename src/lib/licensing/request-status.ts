import type { LicenseRequestStatus } from "@/lib/domain/values";
import { sentences } from "@/lib/format";

// The buyer's request status page, /r/{id} (S03; 01 §4.8, J7.13, J7.14, J7.16, J7.17, J7.19; 04 §11.3; 05 §4.3, §10;
// 07 D25, D27, D28): its words, and which view a request shows. Pure.

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
  updatesItself: "This page updates by itself.",
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
 * checking for a while; `waiting` covers a claimed request too, its countdown swapped for "Processing…" (07 D26).
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

/**
 * The view for a request (05 §4.3), from its stored status first (07 D25: an ending shows only once it is stored):
 * `canceled` (Stripe's cancel_url) and `returning` (its success_url) only mean something while checkout is pending, so
 * a link replayed later shows where the request is. An abandoned request says why, as 07 D27 words it; a reason it
 * doesn't know reads as a checkout not completed. A declined one names a disabled video (07 D28). null (a 404) for the
 * renewal rows, which live on My licenses (01 §4.8).
 */
export function requestView(
  r: { status: LicenseRequestStatus; statusReason: string | null },
  q: { canceled: boolean; returning: boolean },
): RequestView | null {
  switch (r.status) {
    case "checkout_pending":
      if (q.canceled) return "canceled";
      return q.returning ? "returning" : "finishing";
    case "awaiting_approval":
      return "waiting";
    case "approved":
      return "approved";
    case "declined":
      return r.statusReason === "video_disabled"
        ? "video_disabled"
        : "declined";
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
