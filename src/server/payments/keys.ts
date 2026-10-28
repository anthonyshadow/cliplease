import "server-only";

// Stripe idempotency keys and the transfer group (07 §2.4, D74, D95). Pure, so the drivers and the domain wrappers share
// them without an import cycle (index.ts re-exports transferGroupFor and CancelReason). A key never names the currency:
// request ids are unique across platform accounts. P19b and P21b add the transfer, refund and reversal keys.

/** Why a PaymentIntent is canceled (02 §5.8). Stripe hears requested_by_customer for a decline, abandoned otherwise. */
export type CancelReason =
  | "decline"
  | "expire"
  | "capture_failed"
  | "amount_mismatch"
  | "hold_too_short"
  | "video_unavailable";

/** The Checkout Session for a request: one per request, whatever retries the creation. */
export function checkoutSessionKey(requestId: string): string {
  return `checkout-session:${requestId}`;
}

/** A capture claim: `attempt` is the request's stripe_attempt of that claim, so a new claim gets a new key. */
export function captureKey(requestId: string, attempt: number): string {
  return `pi-capture:${requestId}:${attempt}`;
}

/** A cancel claim, keyed like a capture plus the reason. */
export function cancelKey(
  requestId: string,
  reason: CancelReason,
  attempt: number,
): string {
  return `pi-cancel:${requestId}:${reason}:${attempt}`;
}

/** The charge's and the creator transfer's transfer_group (separate charges and transfers, 07 D74). */
export const transferGroupFor = (requestId: string) =>
  `license-request:${requestId}`;

/** Stripe's cancellation_reason for `reason` (ADR-22, 07 D30). */
export const stripeCancelReason = (
  reason: CancelReason,
): "requested_by_customer" | "abandoned" =>
  reason === "decline" ? "requested_by_customer" : "abandoned";
