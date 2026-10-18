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

/** Settings' payouts button (01 J11.1): Set up payouts, Finish setup, or none (on, pending, unavailable). */
export function payoutsSetupLabel(
  status: PayoutsStatus,
): "Set up payouts" | "Finish setup" | null {
  if (status === "not_started") return "Set up payouts";
  if (status === "restricted") return "Finish setup";
  return null;
}

/** The read-only approval window (05 §1.5's labels); P19c makes it a choice (07 D81). */
export const APPROVAL_WINDOW_LABEL = {
  24: "24 hours",
  48: "48 hours",
  72: "72 hours",
  120: "5 days",
} as const satisfies Record<ApprovalWindowHours, string>;
