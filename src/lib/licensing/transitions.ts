import type { LicenseRequestStatus, PaymentAction } from "@/lib/domain/values";

// The license request state table (02 §5.7; 03 §5.1; 07 §2.2, D117). Pure: the state machine (src/server/licensing/
// state-machine.ts) is its only writer. The three renewal statuses have no transition yet: P22b adds the renewal events
// and fills renewal_pending.

/** What can happen to a request (07 §2.2). Not a database value, so not in values.ts. */
export const LICENSE_REQUEST_EVENTS = [
  "authorized",
  "checkout_expired",
  "checkout_failed",
  "amount_mismatch",
  "hold_too_short",
  "video_unavailable",
  "captured",
  "capture_failed",
  "declined",
  "expired",
] as const;

export type LicenseRequestEvent = (typeof LICENSE_REQUEST_EVENTS)[number];

/** From each status, the status each event leads to; an event a status doesn't list is ignored there (03 T13). */
export const TRANSITIONS: Record<
  LicenseRequestStatus,
  Partial<Record<LicenseRequestEvent, LicenseRequestStatus>>
> = {
  checkout_pending: {
    authorized: "awaiting_approval",
    checkout_expired: "abandoned",
    checkout_failed: "abandoned",
    amount_mismatch: "abandoned",
    hold_too_short: "abandoned",
    video_unavailable: "abandoned",
  },
  awaiting_approval: {
    captured: "approved",
    capture_failed: "capture_failed",
    declined: "declined",
    expired: "expired",
  },
  approved: {},
  declined: {},
  expired: {},
  abandoned: {},
  capture_failed: {},
  renewal_pending: {},
  renewal_canceled: {},
  renewal_failed: {},
};

/** Where `event` takes a request in status `from`, or null when it doesn't apply there. */
export function nextStatus(
  from: LicenseRequestStatus,
  event: LicenseRequestEvent,
): LicenseRequestStatus | null {
  return TRANSITIONS[from][event] ?? null;
}

/** The statuses nothing leaves (03 §5.1; 07 D117): the five endings and the two renewal endings. */
const TERMINAL: ReadonlySet<LicenseRequestStatus> = new Set([
  "approved",
  "declined",
  "expired",
  "abandoned",
  "capture_failed",
  "renewal_canceled",
  "renewal_failed",
]);

export function isTerminal(status: LicenseRequestStatus): boolean {
  return TERMINAL.has(status);
}

/** A request's status as a page names it: a stored one, or 'processing' while a claim is in flight (07 D26). */
export type DisplayStatus = LicenseRequestStatus | "processing";

/**
 * What P17's pages show (07 D26): 'processing' while an approve or decline is claimed on a waiting request, else the
 * stored status. No clock: an overdue request keeps waiting, its countdown at "Expires in 0 min", until expiry stores
 * `expired`, so "not charged" copy never shows before the hold is released (07 D25; 04 §9.10; 02 §4.4 rule 3).
 */
export function displayStatus(r: {
  status: LicenseRequestStatus;
  paymentAction: PaymentAction | null;
}): DisplayStatus {
  return r.status === "awaiting_approval" && r.paymentAction
    ? "processing"
    : r.status;
}

/**
 * The status a page shows (07 D26): 'processing' while a claim on an awaiting_approval row is in flight (even past its
 * deadline), 'expired' for an awaiting_approval row at or past its deadline with no claim, else the stored status.
 */
export function effectiveStatus(
  r: {
    status: LicenseRequestStatus;
    expiresAt: Date | null;
    paymentAction: PaymentAction | null;
  },
  now: Date,
): DisplayStatus {
  if (r.status !== "awaiting_approval") return r.status;
  if (r.paymentAction) return "processing";
  if (r.expiresAt && now >= r.expiresAt) return "expired";
  return r.status;
}
