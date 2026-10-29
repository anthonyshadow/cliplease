import { APP_NAME } from "@/lib/app-name";

// The request emails' words (05 §8; 01 §4.8). The subject is also the headline (05 §8 callout 2). Button labels, footers
// and the test-mode line were proposed copy, confirmed by the owner (Q-124 a, Q-125 a). Pure: the templates and the
// sender share it.

export const REQUEST_EMAIL_COPY = {
  newSubject: (licenseeName: string, title: string) =>
    `New request: ${licenseeName} wants to license “${title}”`,
  receivedSubject: (handle: string) => `Request sent to @${handle}`,
  newBody: (scope: string, price: string, deadline: string) =>
    `${scope}. You get ${price}. Answer by ${deadline}. If you don't answer, the hold is released.`,
  /** request-new while the creator's payouts aren't active (07 D74, D77). */
  setUpPayouts: (deadline: string) =>
    `Set up payouts to approve before ${deadline}.`,
  receivedBody: (handle: string, total: string, deadline: string) =>
    `Your card has a hold of ${total}, not a charge. @${handle} has until ${deadline} to approve. We'll email you either way.`,
  reviewRequest: "Review request",
  seeRequestStatus: "See request status",
  orOpen: "Or open:",
  buyerReason: `You got this email because you requested a license on ${APP_NAME}.`,
  creatorReason: `You got this email because you have a creator account on ${APP_NAME}.`,
  questions: "Questions? Reply to this email.",
  testMode: "Test mode. No real money moved.",
} as const;
