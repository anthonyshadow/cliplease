import "server-only";
import type { Currency } from "@/lib/domain/values";
import {
  type Authorization,
  type CreateCheckoutInput,
  type StripeCallOutcome,
  settled,
} from "./driver";
import {
  type CancelReason,
  cancelKey,
  captureKey,
  stripeCancelReason,
} from "./keys";
import { paymentsDriver } from "./registry";

// The domain's payment calls (02 §5.8, 07 §8.2, D95): the currency comes first and picks that platform account's driver;
// callers pass license_request.currency. Never called inside db.transaction (07 D24): claim and commit, then call.
// capture and cancel never throw: a thrown call or a timeout comes back as a transient failure, and the caller's
// reconcileFromStripe reads what really happened (07 D25). A configuration error (a currency not enabled) still throws.

export { type CancelReason, transferGroupFor } from "./keys";

/** A Checkout Session for a request (a platform charge, no destination, 07 D74). */
export async function createCheckout(
  currency: Currency,
  i: CreateCheckoutInput,
): Promise<{ sessionId: string; url: string }> {
  return paymentsDriver(currency).createCheckout(i);
}

/** A session as Stripe has it now (the resubmit's URL, P16b's return path). */
export async function retrieveCheckout(currency: Currency, sessionId: string) {
  return paymentsDriver(currency).retrieveCheckout(sessionId);
}

export async function getAuthorization(
  currency: Currency,
  paymentIntentId: string,
): Promise<Authorization> {
  return paymentsDriver(currency).getAuthorization(paymentIntentId);
}

/** Captures the hold; `attempt` is the request's stripe_attempt of this claim. */
export async function capture(
  currency: Currency,
  requestId: string,
  paymentIntentId: string,
  attempt: number,
): Promise<StripeCallOutcome> {
  const driver = paymentsDriver(currency);
  return settled(() =>
    driver.capture(paymentIntentId, captureKey(requestId, attempt)),
  );
}

/** Releases the hold; a decline tells Stripe the customer asked, every other reason that it was abandoned. */
export async function cancel(
  currency: Currency,
  requestId: string,
  paymentIntentId: string,
  reason: CancelReason,
  attempt: number,
): Promise<StripeCallOutcome> {
  const driver = paymentsDriver(currency);
  return settled(() =>
    driver.cancel(
      paymentIntentId,
      stripeCancelReason(reason),
      cancelKey(requestId, reason, attempt),
    ),
  );
}
