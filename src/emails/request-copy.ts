import { APP_NAME } from "@/lib/app-name";
import { sentences } from "@/lib/format";
import { INBOX_COPY } from "@/lib/licensing/inbox";
import {
  type DeclinedView,
  REQUEST_STATUS_COPY,
} from "@/lib/licensing/request-status";

// The request and license emails' words (05 §8; 01 §4.8). The subject is also the headline (05 §8 callout 2); the
// licensee name in it can't hold a web address (WEB_ADDRESS_RE, owner answer Q-136 a). Button labels, footers and the test-mode line
// were proposed copy, confirmed by the owner (Q-124 a, Q-125 a). Pure: the templates and the sender share it.

export const REQUEST_EMAIL_COPY = {
  newSubject: (licenseeName: string, title: string) =>
    `New request: ${licenseeName} wants to license “${title}”`,
  receivedSubject: (handle: string) => `Request sent to @${handle}`,
  newBody: (scope: string, price: string, deadline: string) =>
    `${scope}. You get ${price}. Answer by ${deadline}. If you don't answer, the hold is released.`,
  /** 04 §11.5: the Inbox row's line, word for word (07 D49). */
  autoApproveFellBack: (deadline: string) =>
    INBOX_COPY.autoApproveFellBack(deadline),
  /** request-new while the creator's payouts aren't active (07 D74, D77). */
  setUpPayouts: (deadline: string) =>
    `Set up payouts to approve before ${deadline}.`,
  /** 05 §8 callout 3: the status page's waiting sentence, word for word (07 D49). */
  receivedBody: REQUEST_STATUS_COPY.waitingBody,
  /** 05 §8 (owner answer Q-152). */
  receivedAutoBody: (handle: string, total: string, deadline: string) =>
    sentences(
      REQUEST_STATUS_COPY.autoApproves(handle),
      `Your card has a hold of ${total} until it's approved, and we'll email your file and license in a moment.`,
      `If it can't be approved automatically, @${handle} has until ${deadline} to approve.`,
    ),
  /** license-approved (05 §8): the subject names the code, never a link or key (07 D34). */
  approvedSubject: (code: string) => `Approved: your license ${code} is ready`,
  /** /r's approved sentence, word for word (01 §4.8). */
  approvedBody: REQUEST_STATUS_COPY.approvedBody,
  /** request-declined (05 §8): the same subject whatever the reason. */
  declinedSubject: "Not approved: you weren't charged",
  /** Its first paragraph: /r's "Not approved" body for the request's DeclinedView, word for word (05 §8 callout 3). */
  declinedBody: {
    declined: REQUEST_STATUS_COPY.declinedBody,
    video_disabled: () => REQUEST_STATUS_COPY.videoDisabledBody,
  } satisfies Record<DeclinedView, (handle: string) => string>,
  /** 05 §8 callout 10, 07 D98: under the first paragraph. */
  amountsIn: (label: string) => `Amounts in ${label}.`,
  licenseLine: (code: string) => `License ${code}`,
  /** 05 §8 callout 7: followed by the {APP_URL}/verify/{code} link and a period. */
  verifyLead: "Anyone can check this license at",
  getFileAndLicense: "Get file and license",
  reviewRequest: "Review request",
  seeRequestStatus: "See request status",
  orOpen: "Or open:",
  buyerReason: `You got this email because you requested a license on ${APP_NAME}.`,
  creatorReason: `You got this email because you have a creator account on ${APP_NAME}.`,
  questions: "Questions? Reply to this email.",
  testMode: "Test mode. No real money moved.",
} as const;
