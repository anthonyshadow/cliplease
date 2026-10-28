// The buyer's request status page, /r/{id} (S03; 01 §4.8, J7.13; 04 §11.3; 05 §4.3, §10): its words. Pure.

export const REQUEST_STATUS_COPY = {
  /** S27's "Buyer link dead" (05 §10): the 404 title, with no hint that the request exists. */
  deadLink:
    "This link doesn't work anymore. Check your email for the latest one.",
  canceledTitle: "Checkout not completed",
  canceledBody: "Checkout not completed. Nothing was charged.",
  backToLicense: "Back to the license page",
  finishingTitle: "Finishing checkout…",
  finishingBody:
    "If you closed the payment page, you can start again from the license link. Nothing has been charged.",
} as const;
