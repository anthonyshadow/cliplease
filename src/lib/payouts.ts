// Payouts and request labels for Settings (01 J11.1, 05 §1.5). Pure.
import type { ApprovalWindowHours, PayoutsStatus } from "./domain/values";

export const PAYOUTS_STATUS_LABEL = {
  not_started: "Not set up",
  pending: "Stripe is checking your details",
  active: "Payouts on",
  restricted: "Stripe needs more information",
  rejected: "Payouts unavailable",
  unsupported: "Payouts unavailable",
} as const satisfies Record<PayoutsStatus, string>;

/** Back from payout setup, or Check again, with payouts on (05 §6.11 States, proposed copy). */
export const PAYOUTS_ON_MESSAGE = "Payouts are on.";

/** Settings' payouts button (01 J11.1): Set up payouts, Finish setup, or none (on, pending, unavailable). */
export function payoutsSetupLabel(
  status: PayoutsStatus,
): "Set up payouts" | "Finish setup" | null {
  if (status === "not_started") return "Set up payouts";
  if (status === "restricted") return "Finish setup";
  return null;
}

/** Rejected or unsupported: no setup button, but "Payouts unavailable. Contact {SUPPORT_EMAIL}." (P05 owner answer). */
export function isPayoutsUnavailable(status: PayoutsStatus): boolean {
  return status === "rejected" || status === "unsupported";
}

/**
 * Payouts not on yet (07 D74): the line the onboarding payouts step and the Review's Notice share, and the Notice's
 * pending line with "Check again" (05 §6.5 callout 50 and States; owner answer Q-95 a).
 */
export const PAYOUTS_NOTICE_COPY = {
  canPublish:
    "You can publish now. You'll need payouts set up to approve a request.",
  pending: `${PAYOUTS_STATUS_LABEL.pending}. You can approve requests as soon as they're done.`,
  checkAgain: "Check again",
} as const;

/** "Set up payouts" / "Finish setup" (02 §6.2): the setup route, coming back to `returnTo` when given (owner answer Q-94 a). */
export function payoutsSetupHref(returnTo?: string): string {
  const path = "/api/stripe/onboarding";
  return returnTo ? `${path}?${new URLSearchParams({ returnTo })}` : path;
}

/** The read-only approval window (05 §1.5's labels); P19c makes it a choice (07 D81). */
export const APPROVAL_WINDOW_LABEL = {
  24: "24 hours",
  48: "48 hours",
  72: "72 hours",
  120: "5 days",
} as const satisfies Record<ApprovalWindowHours, string>;
