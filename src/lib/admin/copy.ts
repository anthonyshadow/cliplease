// Every word the admin view prints (05 §7; design/P21-admin-view.md §2 and §6; owner answers Q-198 a, Q-199 a,
// Q-201–Q-203, Q-207–Q-209, Q-211): the tab row, the six tables' headers and cells, the Events lists, the Disable and Enable
// sheets, the Licenses tab's money words, and the Revoke and Retry sheets. Pure and client-safe. The status and transfer
// words, the revoke reasons and the movement kinds are in labels.ts, the disable reasons' in src/lib/videos/review.ts
// and "Standard" is MY_LICENSES_COPY's; the generic error is GENERIC_ERROR_MESSAGE.
import type { MoneyMovementKind } from "../domain/values";

/** 04 §9.22 / 05 §7's sentence, word for word: the release that comes with every Disable (07 D66). */
const RELEASE_SENTENCE =
  "Its verified posts are released, so the rightful owner can make them licensable.";
const SOLD_SENTENCE = "Licenses already sold don't change.";

export const ADMIN_COPY = {
  /** The tab row's name for screen readers. */
  tabsLabel: "Admin tables",
  caption: "Newest 50",
  empty: "Nothing here yet.",
  none: "—",
  /** A flagged Events row's word for screen readers, beside its warning icon. */
  flagged: "Flagged",
  stripeEventsHeading: "Unprocessed Stripe events",
  latestEventsHeading: "Latest events",
  failedEmailsHeading: "Failed emails",
  failedMovementsHeading: "Failed money movements",
  /** Videos' Postings cell: "3 · 2 verified". */
  postings: (total: number, verified: number) =>
    `${total} · ${verified} verified`,
  /** Videos' Ownership cell: "Verified · Demo", or Self-attested. */
  verifiedOn: (platform: string) => `Verified · ${platform}`,
  selfAttested: "Self-attested",
  /** The admin's note under the Reason cell (admins only, never a creator page). */
  note: (note: string) => `Note: ${note}`,
} as const;

/** Each table's column headers, in the canvas's order (design §6.2–§6.7). */
export const ADMIN_COLUMNS = {
  creators: {
    handle: "Handle",
    name: "Name",
    email: "Email",
    payoutCurrency: "Payout currency",
    payouts: "Payouts",
    videos: "Videos",
    created: "Created",
  },
  connections: {
    platform: "Platform",
    username: "Username",
    owner: "Owner",
    status: "Status",
    lastSync: "Last sync",
    lastError: "Last error",
    connected: "Connected",
    disconnected: "Disconnected",
  },
  videos: {
    title: "Title",
    creator: "Creator",
    ownership: "Ownership",
    postings: "Postings",
    status: "Status",
    waiting: "Waiting",
    reason: "Reason",
    created: "Created",
    action: "Action",
  },
  requests: {
    licensee: "Licensee",
    buyerEmail: "Buyer email",
    video: "Video",
    scope: "Scope",
    type: "Type",
    license: "License",
    fee: "Fee",
    total: "Total",
    checkout: "Checkout",
    paymentIntent: "PaymentIntent",
    charge: "Charge",
    status: "Status",
    reason: "Reason",
    autoApprove: "Auto-approve",
    deadline: "Deadline",
    created: "Created",
  },
  licenses: {
    code: "Code",
    licensedTo: "Licensed to",
    video: "Video",
    status: "Status",
    type: "Type",
    issued: "Issued",
    downloads: "Downloads",
    money: "Money",
    revoked: "Revoked",
    action: "Action",
  },
  auditEvents: {
    time: "Time",
    action: "Action",
    actor: "Actor",
    target: "Target",
    details: "Details",
  },
  failedMovements: {
    kind: "Kind",
    license: "License",
    amount: "Amount",
    attempt: "Attempt",
    error: "Error",
    updated: "Updated",
    retry: "Retry",
  },
  failedEmails: {
    time: "Time",
    template: "Template",
    entity: "Entity",
    attempts: "Attempts",
    error: "Error",
  },
  stripeEvents: {
    received: "Received",
    id: "Id",
    type: "Type",
    currency: "Currency",
    account: "Account",
    attempts: "Attempts",
    lastError: "Last error",
  },
} as const;

/** "1 waiting request" · "{n} waiting requests". */
const waiting = (n: number) =>
  n === 1 ? "1 waiting request" : `${n} waiting requests`;

/** The Disable sheet (05 §7 callout 6; design §6.8; owner answers Q-198 a, Q-199 a, Q-201–Q-203). */
export const DISABLE_COPY = {
  action: "Disable",
  /** The row action's name for screen readers. */
  actionLabel: (title: string) => `Disable ${title}`,
  title: (title: string) => `Disable ${title}?`,
  /** The body by the video's waiting requests: none, one, several. */
  body: (n: number) => {
    if (n === 0) {
      return `The license page goes dark. ${SOLD_SENTENCE} ${RELEASE_SENTENCE}`;
    }
    const buyers = n === 1 ? "The buyer isn't" : "The buyers aren't";
    return `The license page goes dark and ${waiting(n)} ${n === 1 ? "is" : "are"} declined. ${buyers} charged. ${SOLD_SENTENCE} ${RELEASE_SENTENCE}`;
  },
  reason: "Reason",
  reasonPlaceholder: "Choose a reason",
  reasonRequired: "Choose a reason.",
  note: "Note (optional)",
  noteHelper: "Only admins see this. Up to 200 characters.",
  cancel: "Keep it live",
  confirm: "Disable video",
  pending: "Disabling…",
  /** After a sweep that left requests waiting (Q-198 a): the warning, the body, and the buttons. */
  stillOpen: (n: number) =>
    `${waiting(n)} ${n === 1 ? "is" : "are"} still open.`,
  /** The still-open body by the requests left open (owner answers Q-201, Q-203). */
  stillOpenBody: (n: number) =>
    n === 1
      ? "The video is disabled and its posts are released. Try again to decline the request. If you close this, the request can't be charged and its hold is released at its deadline."
      : "The video is disabled and its posts are released. Try again to decline them. If you close this, they can't be charged and their holds are released at their deadlines.",
  /** The warning's line for the payments already going through when the video was disabled (owner answer Q-202). */
  capturing: (n: number) =>
    n === 1
      ? "1 payment was already going through when the video was disabled, so its license may still be issued."
      : `${n} payments were already going through when the video was disabled, so their licenses may still be issued.`,
  close: "Close",
  tryAgain: "Try again",
  toast: "Video disabled.",
} as const;

/** The Enable sheet (design §6.9; owner answer Q-199 a). */
export const ENABLE_COPY = {
  action: "Enable",
  actionLabel: (title: string) => `Enable ${title}`,
  title: (title: string) => `Enable ${title}?`,
  body: "It goes back to Off. Its released posts stay not verified until the creator taps Check again.",
  cancel: "Keep it disabled",
  confirm: "Enable video",
  pending: "Enabling…",
  toast: "Video enabled.",
} as const;

/**
 * The Licenses tab's Money cell for a revoked license (05 §7 callouts 8, 9; owner answer Q-209): the refund part, then
 * the take-back part, joined with " · ". A license that isn't revoked reads transferLabel's words (labels.ts).
 */
export const MONEY_COPY = {
  separator: " · ",
  refunded: (total: string) => `Refunded ${total}`,
  refundPending: "Refund pending",
  refundFailed: "Refund failed",
  /** Payment reversed: the money went back before the revoke (05 §7 callout 8). */
  noRefund: "No refund (money already returned)",
  takenBack: (price: string) => `Taken back ${price}`,
  takeBackPending: "Take-back pending",
  takeBackFailed: "Take-back failed",
  /** The revoke canceled a payout that wasn't sent yet, or its take-back found it never landed (owner answer Q-210). */
  payoutCanceled: "Payout canceled",
  nothingToTakeBack: "Nothing to take back",
} as const;

/**
 * The Revoke sheet (05 §7 callout 10; 04 §9.22, §11.10; 07 D86; owner answers Q-207, Q-209): the body by what the revoke
 * does with the money, the buttons and the in-flight refusal. Its reasons are labels.ts's; its reason and note fields
 * read Disable's words (ReasonNoteFields): admins only, never a creator, buyer or public page.
 */
export const REVOKE_COPY = {
  action: "Revoke",
  /** The row action's name for screen readers. */
  actionLabel: (code: string) => `Revoke ${code}`,
  title: (code: string) => `Revoke ${code}?`,
  /** The creator's transfer was sent: the revoke takes it back. */
  takeBackBody: (total: string, price: string, handle: string) =>
    `This refunds the buyer ${total} and takes back ${price} from @${handle}.`,
  /** The transfer wasn't sent yet (pending or failed): the revoke cancels it. */
  cancelPayoutBody: (total: string, price: string, handle: string) =>
    `This refunds the buyer ${total} and cancels the ${price} payout to @${handle}.`,
  /** No payout to take back or cancel (owner answer Q-211). */
  refundOnlyBody: (total: string) => `This refunds the buyer ${total}.`,
  /** Reason Payment reversed, switched live. */
  paymentReversedBody: "No refund: the money already went back.",
  cancel: "Keep license",
  confirm: "Revoke and refund",
  /** Payment reversed's confirm: nothing to refund. */
  confirmNoRefund: "Revoke",
  pending: "Revoking…",
  toast: "License revoked.",
  /** Owner answer Q-207: the creator transfer is in flight, so nothing was revoked. */
  inProgress: (handle: string) =>
    `A payout to @${handle} is in progress. Try again in a minute.`,
} as const;

/** What a Retry names and asks, by the movement's kind (owner answers Q-208, Q-209, Q-211). */
type RetryWords = {
  /** The button's name for screen readers, naming the license; its visible word is RETRY_COPY.action. */
  actionLabel: (code: string) => string;
  title: string;
  body: (amount: string, handle: string) => string;
};

/**
 * The Retry button and its sheet (05 §7 callout 9; 02 §6.1; owner answers Q-208, Q-211): it asks first, by kind, with a
 * primary Retry and Cancel; done → the toast; nothing left to retry → its toast; failed again → the code in the sheet;
 * another retry running → its line in the sheet; no answer → Stripe's.
 */
export const RETRY_COPY = {
  action: "Retry",
  kind: {
    buyer_refund: {
      actionLabel: (code) => `Retry refund for ${code}`,
      title: "Retry this refund?",
      body: (total) => `This tries again to refund the buyer ${total}.`,
    },
    transfer_reversal: {
      actionLabel: (code) => `Retry take-back for ${code}`,
      title: "Retry this take-back?",
      body: (price, handle) =>
        `This tries again to take back ${price} from @${handle}.`,
    },
    creator_transfer: {
      actionLabel: (code) => `Retry transfer for ${code}`,
      title: "Retry this transfer?",
      body: (price, handle) =>
        `This tries again to send ${price} to @${handle}.`,
    },
  } satisfies Record<MoneyMovementKind, RetryWords>,
  confirm: "Retry",
  cancel: "Cancel",
  pending: "Retrying…",
  toast: "Retry done.",
  /** Owner answer Q-211: the movement went through or was canceled meanwhile. */
  nothingToRetry: "Nothing to retry.",
  failed: (code: string) => `That didn't work (${code}). Try again later.`,
  /** Owner answer Q-211: another retry holds the movement. */
  inProgress: "It's already being retried. Try again in a minute.",
  transient: "Stripe didn't answer. Try again in a minute.",
} as const;
