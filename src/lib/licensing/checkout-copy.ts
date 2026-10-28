import { APP_NAME } from "@/lib/app-name";

// The checkout's words (05 §10 S28): the dev fake checkout's page, and from P25 the Stripe Checkout line items (05 §4.2
// "ClipLease service fee"). Pure.

export const CHECKOUT_COPY = {
  /** 05 §10 callout 2 *(proposed)*; dev and test only. */
  fakeBanner: "Fake checkout. Development only. No card is used.",
  fakeTitle: "Fake checkout",
  license: "License",
  serviceFee: `${APP_NAME} service fee`,
  total: "Total",
  cancel: "Cancel",
} as const;
