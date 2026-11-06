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
  /** `total` is formatMoney's: "Pay CA$1,732.50". */
  pay: (total: string) => `Pay ${total}`,
  cancel: "Cancel",
  /** 02 §5.8, 07 D35: the session ends unpaid. */
  letItExpire: "Let it expire",
  /** The unpaid hold (owner answer Q-176): the same words on standard and exclusive rows. `time` is formatDuration's. */
  holdClock: (time: string) => `Reserved for you · ${time}`,
  holdEnding: "Your reservation ends in 1 minute.",
  holdExtend: "Extend 10 minutes",
  holdExtending: "Extending…",
  holdEnded: "Your reservation ended. Extend it to keep going.",
  holdTaken: "Someone else has reserved this video. Nothing was charged.",
  sessionEnded: "This checkout has ended. Nothing was charged.",
} as const;
