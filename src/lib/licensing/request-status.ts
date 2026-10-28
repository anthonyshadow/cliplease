import type { LicenseRequestStatus } from "@/lib/domain/values";

// The buyer's request status page, /r/{id} (S03; 01 §4.8, J7.13, J7.14, J7.16, J7.19; 04 §11.3; 05 §4.3, §10; 07 D27):
// its words, and which view a request shows. Pure.

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
    [
      `Your card has a hold of ${total}, not a charge.`,
      deadline ? `@${handle} has until ${deadline} to approve.` : null,
      "We'll email you either way.",
    ]
      .filter(Boolean)
      .join(" "),
} as const;

const COPY = REQUEST_STATUS_COPY;

/**
 * What /r shows: `returning` is "Finishing checkout…" for a buyer just back from Checkout, which keeps checking for a
 * while; `waiting` names the creator, so its words come from REQUEST_STATUS_COPY.
 */
export type RequestView =
  | "canceled"
  | "payment_failed"
  | "unavailable"
  | "finishing"
  | "returning"
  | "waiting";

/**
 * Every view's title (also the tab's) and body, but `waiting`'s. `backLink`: the view ends the checkout, so it offers
 * "Back to the license page".
 */
export const VIEW_COPY = {
  canceled: {
    title: COPY.canceledTitle,
    body: COPY.canceledBody,
    backLink: true,
  },
  payment_failed: {
    title: COPY.paymentFailedTitle,
    body: COPY.paymentFailedBody,
    backLink: true,
  },
  unavailable: {
    title: COPY.canceledTitle,
    body: COPY.unavailableBody,
    backLink: true,
  },
  finishing: {
    title: COPY.finishingTitle,
    body: COPY.finishingBody,
    backLink: false,
  },
  returning: {
    title: COPY.finishingTitle,
    body: COPY.finishingBody,
    backLink: false,
  },
} as const satisfies Record<
  Exclude<RequestView, "waiting">,
  { title: string; body: string; backLink: boolean }
>;

/**
 * The view for a request (05 §4.3), its status first: `canceled` (Stripe's cancel_url) and `returning` (its
 * success_url) only mean something while checkout is pending, so a link replayed later shows where the request is. An
 * abandoned request says why, as 07 D27 words it; a reason it doesn't know reads as a checkout not completed. null (a
 * 404 for now) for the states P17 draws.
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
  return view === "waiting" ? COPY.waitingTitle(handle) : VIEW_COPY[view].title;
}
