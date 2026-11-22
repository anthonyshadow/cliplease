// Every word the admin view prints (05 §7; design/P21-admin-view.md §2 and §6; owner answers Q-198 a, Q-199 a,
// Q-201–Q-203): the tab row, the six tables' headers and cells, the Events lists, and the Disable and Enable sheets. Pure
// and client-safe. The status and transfer words are in labels.ts, the disable reasons' in src/lib/videos/review.ts and
// "Standard" is MY_LICENSES_COPY's; the generic error is GENERIC_ERROR_MESSAGE.

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
    transfer: "Transfer",
    revoked: "Revoked",
  },
  auditEvents: {
    time: "Time",
    action: "Action",
    actor: "Actor",
    target: "Target",
    details: "Details",
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
