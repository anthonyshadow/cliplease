import "server-only";
import type { Currency } from "@/lib/domain/values";
import {
  type Authorization,
  type CreateCheckoutInput,
  type MoneyCallFailure,
  type StripeCallOutcome,
  settled,
} from "./driver";
import {
  type CancelReason,
  cancelKey,
  captureKey,
  stripeCancelReason,
  transferKey,
} from "./keys";
import { paymentsDriver } from "./registry";

// The domain's payment calls (02 §5.8, 07 §8.2, D95): the currency comes first and picks that platform account's driver;
// callers pass license_request.currency. Never called inside db.transaction (07 D24): claim and commit, then call.
// capture, cancel and transfer never throw: a thrown call or a timeout comes back as a transient failure, and the caller
// reads what really happened (reconcileFromStripe, findTransfers; 07 D25, D75). A configuration error (a currency not
// enabled) still throws.

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

/**
 * Pays the creator their share of `chargeId` (07 D74, D75): `attempt` is the money_movement row's attempt of this claim,
 * so a new claim gets a new key. The caller has reconciled with findTransfers first.
 */
export async function transfer(
  currency: Currency,
  requestId: string,
  chargeId: string,
  destinationAccountId: string,
  amountCents: number,
  attempt: number,
): Promise<{ ok: true; transferId: string } | MoneyCallFailure> {
  const driver = paymentsDriver(currency);
  return settled(() =>
    driver.createTransfer({
      requestId,
      chargeId,
      destinationAccountId,
      amountCents,
      idempotencyKey: transferKey(requestId, attempt),
    }),
  );
}

/** The request's transfers on that currency's account (at most one per transfer_group, 07 D75). Throws when unreadable. */
export async function findTransfers(currency: Currency, requestId: string) {
  return paymentsDriver(currency).findTransfers(requestId);
}
