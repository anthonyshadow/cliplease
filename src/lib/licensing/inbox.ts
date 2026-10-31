import type { LicenseRequestStatus } from "@/lib/domain/values";
import { formatMoney, sentences } from "@/lib/format";
import { GENERIC_ERROR_MESSAGE } from "@/lib/result";
import type {
  ApproveResult,
  CreatorRequest,
  DeclineResult,
} from "./request-dto";
import { REQUEST_STATUS_COPY } from "./request-status";
import { type DisplayStatus, isTerminal } from "./transitions";

// The creator's Inbox and request page (S14, S15; 04 §9.11, §11.5; 05 §6.3, §6.4; 01 J8): their words, and what each
// request shows. Deadlines are formatted in the viewer's zone after mount (07 D84): a sentence that names one is left
// out until then (null). "Open request" and the request page's heading were proposed copy (owner answer Q-126 a);
// "No decided requests yet." is the owner's answer Q-127 a. Pure.

export const INBOX_COPY = {
  /** The SegmentedControl's name and the request page's tab title (Q-126 a). */
  inbox: "Inbox",
  title: "Inbox.",
  waitingForYou: (n: number) => `${n} waiting for you.`,
  caughtUp: "All caught up.",
  waitingSegment: (n: number) => `Waiting ${n}`,
  history: "History",
  /** Read before a creator's countdown by screen readers (04 §9.9). */
  waitingForYouSr: "Waiting for you",
  /** "{title} · You get CA$1,575.00" on a waiting row; History prints the price alone (05 §6.3). */
  youGet: (price: string) => `You get ${price}`,
  details: "Details",
  openRequest: "Open request",
  empty: "No requests yet. Share a link to get your first one.",
  makeLicensable: "Make a video licensable",
  historyEmpty: "No decided requests yet.",
  setUpPayouts: "Set up payouts",
  /** 01 J8.3, 07 D77: while a request waits and payouts aren't active. */
  payoutsWaiting: (deadline: string | null) =>
    sentences(
      "Finish payout setup to approve.",
      deadline && `This request stays open until ${deadline}.`,
    ),
  detailHeading: (licenseeName: string, title: string) =>
    `${licenseeName} wants to license ${title}`,
  facts: {
    licensedTo: "Licensed to",
    contact: "Contact",
    plannedUse: "Planned use",
    scope: "Scope",
    youGet: "You get",
    payment: "Payment",
    answerBy: "Answer by",
  },
  youGetFact: (price: string, total: string) =>
    `${price} (buyer pays ${total} incl. service fee)`,
  paymentFact: "Card on hold. Charged only if you approve.",
  answerByFact: (deadline: string | null) =>
    sentences(
      deadline && `${deadline}.`,
      "If you don't answer, the hold is released.",
    ),
  expiredLine: (deadline: string | null) =>
    sentences(
      "Expired.",
      deadline && `No answer by ${deadline}.`,
      "The buyer wasn't charged.",
    ),
  captureFailedLine:
    "Payment didn't go through. No license was issued and the buyer wasn't charged.",
  videoDisabledLine:
    "This video was disabled, so the request was declined. The buyer wasn't charged.",
  approve: "Approve",
  approving: "Approving…",
  decline: "Decline",
  declining: "Declining…",
  /** 04 §11.5 (01 J8.4): a decline's line and its toast (no seal), once the request is stored declined (07 D25). */
  declinedLine: "Declined. The buyer wasn't charged.",
  /** 04 §11.5, 07 D99: the creator's approval toast. */
  approvedToast: (price: string) =>
    `Approved. ${price} is on its way to your Stripe balance.`,
  /** 04 §11.5: the settled row and the request page; P20 adds " · View license". */
  licenseIssued: (code: string) => `License ${code} issued`,
  /**
   * Approve after the deadline, before the hold is released: 07 D25 keeps "The buyer wasn't charged." for the stored
   * expiry (owner answer, P18 Q2).
   */
  approveExpired: "This request expired.",
  /** 04 §11.5 (01 J8.6): a decline that finds the expiry stored, so the hold is released (owner answer Q-143 a). */
  expiredNotCharged: "This request expired. The buyer wasn't charged.",
  retry: "Couldn't reach the payment service. Try again.",
  /** P18 Q1 (owner answer): followed by the support address as a link. */
  originalMissing:
    "The original file for this video is missing, so this request can't be approved yet. Questions?",
} as const;

/** A request's pill (04 §9.9, 01 §3.0), or null while it waits on its countdown. */
export function requestPill(
  status: DisplayStatus,
): { label: string; tone: "neutral" | "cleared" | "danger" } | null {
  switch (status) {
    case "processing":
      return { label: REQUEST_STATUS_COPY.processing, tone: "neutral" };
    case "approved":
      return { label: "Approved", tone: "cleared" };
    case "declined":
      return { label: "Declined", tone: "neutral" };
    case "expired":
      return { label: "Expired", tone: "neutral" };
    case "capture_failed":
      return { label: "Payment failed", tone: "danger" };
    default:
      return null;
  }
}

/**
 * The line under a decided request (04 §11.5): an expiry, a failed capture (danger text) or a disabled video. Approved
 * and plainly declined requests have none.
 */
export function outcomeLine(
  r: Pick<CreatorRequest, "status" | "statusReason">,
  deadline: string | null,
): { text: string; danger: boolean } | null {
  if (r.status === "expired") {
    return { text: INBOX_COPY.expiredLine(deadline), danger: false };
  }
  if (r.status === "capture_failed") {
    return { text: INBOX_COPY.captureFailedLine, danger: true };
  }
  if (r.status === "declined" && r.statusReason === "video_disabled") {
    return { text: INBOX_COPY.videoDisabledLine, danger: false };
  }
  return null;
}

/**
 * A line a row or the request page shows for an action's result. `recorded`: the decided request's own record shows it
 * too (as an issued license's code always does), so the request page leaves it to the record.
 */
export type ResultLine =
  | { kind: "issued"; code: string }
  | { kind: "text"; text: string; danger: boolean; recorded?: true }
  | { kind: "payouts" }
  | { kind: "original_missing" };

/**
 * What a row shows after Approve or Decline (05 §6.3 States; 04 §11.5): `settles` keeps the row in place until the next
 * refresh (02 §4.4 rule 2); `pill` replaces the countdown (null keeps it; Approved brings the 16 px seal before "You
 * get"); `line` the result where the buttons were; `toast` the polite toast.
 */
export type RowOutcome = {
  settles: boolean;
  pill: DisplayStatus | null;
  line: ResultLine | null;
  toast: string | null;
};

const outcome = (o: Partial<RowOutcome> = {}): RowOutcome => ({
  settles: false,
  pill: null,
  line: null,
  toast: null,
  ...o,
});

/** An approval shows the cleared seal: on the row, and in its toast (04 §10.3, §9.23). */
export const showsSeal = (o: RowOutcome | null) => o?.pill === "approved";

/** The action's own failure, or a request that isn't the creator's: the generic error, the row live. */
const genericError = () =>
  outcome({
    line: { kind: "text", text: GENERIC_ERROR_MESSAGE, danger: false },
  });

/** Stripe can't be reached (01 J8.9): nothing settles, the line says to try again and the buttons come back. */
const tryAgain = () =>
  outcome({ line: { kind: "text", text: INBOX_COPY.retry, danger: false } });

/**
 * Another claim or ending got there first (J8.8; 07 D160): a terminal status settles the row quietly with its pill, no
 * line, no toast; a claim still running settles nothing (the refresh shows Processing…); null is the generic error.
 */
function lostTo(status: LicenseRequestStatus | null): RowOutcome {
  if (status === null) return genericError();
  return isTerminal(status)
    ? outcome({ settles: true, pill: status })
    : outcome();
}

/**
 * Approve's result (or the action's own failure, `null`), as `request` shows it: approved with the seal, the code line
 * and the toast; capture_failed and a race lost to a decision settle with that status's pill and no toast (J8.8); the
 * deadline settles with the neutral Expired pill (the database's clock said so; owner answer Q-142 a) and only "This
 * request expired." until the expiry is stored (07 D25; Q-140 a); retry, payouts and a missing original leave the row
 * live with their line; a claim still running settles nothing (the refresh shows Processing…).
 */
export function approveOutcome(
  result: ApproveResult | null,
  request: Pick<CreatorRequest, "licensePriceCents" | "currency">,
): RowOutcome {
  if (!result) return genericError();
  if (result.ok) {
    return outcome({
      settles: true,
      pill: "approved",
      line: { kind: "issued", code: result.licenseCode },
      toast: INBOX_COPY.approvedToast(
        formatMoney(request.licensePriceCents, request.currency),
      ),
    });
  }
  switch (result.reason) {
    case "expired":
      return outcome({
        settles: true,
        pill: "expired",
        line: { kind: "text", text: INBOX_COPY.approveExpired, danger: false },
      });
    case "capture_failed":
      return outcome({
        settles: true,
        pill: "capture_failed",
        line: {
          kind: "text",
          text: INBOX_COPY.captureFailedLine,
          danger: true,
          recorded: true,
        },
      });
    case "retry":
      return tryAgain();
    case "payouts_not_active":
      return outcome({ line: { kind: "payouts" } });
    case "original_missing":
      return outcome({ line: { kind: "original_missing" } });
    case "not_actionable":
      return lostTo(result.status);
  }
}

/**
 * Decline's result (or the action's own failure, `null`), as a row shows it (05 §6.3 States; 01 J8.4): declined with
 * its line and the same sentence as a toast, no seal, only once the request is stored declined (07 D25); retry leaves
 * the row live with its line. A decline that finds the request stored expired (past the deadline T8 runs T9, or the
 * expiry got there first) settles with the Expired pill and that ending's sentence, recorded, no toast (owner answer
 * Q-143 a); any other race lost, as Approve's (J8.8).
 */
export function declineOutcome(result: DeclineResult | null): RowOutcome {
  if (!result) return genericError();
  if (result.ok) {
    return outcome({
      settles: true,
      pill: "declined",
      line: { kind: "text", text: INBOX_COPY.declinedLine, danger: false },
      toast: INBOX_COPY.declinedLine,
    });
  }
  if (result.reason === "retry") return tryAgain();
  if (result.status !== "expired") return lostTo(result.status);
  return outcome({
    settles: true,
    pill: "expired",
    line: {
      kind: "text",
      text: INBOX_COPY.expiredNotCharged,
      danger: false,
      recorded: true,
    },
  });
}

/**
 * The result line the request page adds (05 §6.4): none that the page's record shows (a recorded line, or once the
 * refreshed request has a code or a stored line), nor the payouts sentence while the page's payouts Notice shows it,
 * nor a line that left the request live once it no longer waits (Expired or Processing…). A line the record never
 * carries stays after the refresh (a plain decline's "Declined. The buyer wasn't charged.").
 */
export function requestPageLine(
  outcome: RowOutcome | null,
  request: Pick<
    CreatorRequest,
    "licenseCode" | "status" | "statusReason" | "displayStatus"
  >,
  payoutsNotice: boolean,
): ResultLine | null {
  const line = outcome?.line;
  if (
    !outcome ||
    !line ||
    line.kind === "issued" ||
    (line.kind === "text" && line.recorded)
  )
    return null;
  // A line that leaves the request live (retry, payouts, a missing original) goes with the actions it came with.
  if (!outcome.settles && request.displayStatus !== "awaiting_approval") {
    return null;
  }
  if (request.licenseCode || outcomeLine(request, null)) return null;
  return line.kind === "payouts" && payoutsNotice ? null : line;
}
