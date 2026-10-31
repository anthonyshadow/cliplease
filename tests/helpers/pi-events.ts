import { randomUUID } from "node:crypto";
import type { Currency } from "../../src/lib/domain/values";
import { env } from "../../src/server/env";
import type { PaymentsEvent, PiStatus } from "../../src/server/payments/driver";
import type { WebhookOutcome } from "../../src/server/payments/events";

// Stripe's PaymentIntent events for [int] tests (P19; 02 §8.1): as the webhook route (P25) passes them to onWebhookEvent,
// for a request's fake PaymentIntent (`pi_fake_<request id>`). A test delivers one where Stripe would send it: after a
// capture or a cancel moved the PaymentIntent, or for a move of Stripe's own (07 D25).

/** The PaymentIntent events the webhook handles. */
export type PiEventType =
  | "payment_intent.amount_capturable_updated"
  | "payment_intent.succeeded"
  | "payment_intent.canceled"
  | "payment_intent.payment_failed";

/** A test-mode event of `type` for the request's PaymentIntent, with its own id. */
export function piEvent(type: PiEventType, requestId: string): PaymentsEvent {
  return {
    id: `evt_test_${randomUUID()}`,
    livemode: false,
    appUrl: env.APP_URL,
    type,
    paymentIntentId: `pi_fake_${requestId}`,
    requestId,
  };
}

/** The event Stripe sends when a capture or a cancel moves a PaymentIntent to `status`. */
export function eventFor(
  status: PiStatus,
): "payment_intent.succeeded" | "payment_intent.canceled" {
  if (status === "succeeded") return "payment_intent.succeeded";
  if (status === "canceled") return "payment_intent.canceled";
  throw new Error(`Stripe sends no event for a move to ${status}`);
}

/** Delivers `type` for the request's PaymentIntent from `currency`'s account (02 §8.1): the webhook's outcome. */
export async function deliverPiEvent(
  type: PiEventType,
  requestId: string,
  currency: Currency = "cad",
): Promise<WebhookOutcome> {
  const { onWebhookEvent } = await import("../../src/server/payments/events");
  return onWebhookEvent(piEvent(type, requestId), currency);
}
