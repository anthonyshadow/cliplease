import { APP_NAME } from "@/lib/app-name";
import { REQUEST_STATUS_COPY } from "@/lib/licensing/request-status";

// The request emails' words (05 §8; 01 §4.8). The subject is also the headline (05 §8 callout 2); the licensee name in
// it can't hold a web address (WEB_ADDRESS_RE, owner answer Q-136 a). Button labels, footers and the test-mode line
// were proposed copy, confirmed by the owner (Q-124 a, Q-125 a). Pure: the templates and the sender share it.

export const REQUEST_EMAIL_COPY = {
  newSubject: (licenseeName: string, title: string) =>
    `New request: ${licenseeName} wants to license “${title}”`,
  receivedSubject: (handle: string) => `Request sent to @${handle}`,
  newBody: (scope: string, price: string, deadline: string) =>
    `${scope}. You get ${price}. Answer by ${deadline}. If you don't answer, the hold is released.`,
  /** request-new while the creator's payouts aren't active (07 D74, D77). */
  setUpPayouts: (deadline: string) =>
    `Set up payouts to approve before ${deadline}.`,
  /** 05 §8 callout 3: the status page's waiting sentence, word for word (07 D49). */
  receivedBody: REQUEST_STATUS_COPY.waitingBody,
  reviewRequest: "Review request",
  seeRequestStatus: "See request status",
  orOpen: "Or open:",
  buyerReason: `You got this email because you requested a license on ${APP_NAME}.`,
  creatorReason: `You got this email because you have a creator account on ${APP_NAME}.`,
  questions: "Questions? Reply to this email.",
  testMode: "Test mode. No real money moved.",
} as const;
