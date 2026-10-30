import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { licenseRequest, stripeEvent } from "@/db/schema";
import type { Currency, LicenseRequestStatus } from "@/lib/domain/values";
import { isUuid } from "@/lib/validation/uuid";
import { writeAudit } from "../audit";
import type { Actor } from "../auth/actor";
import { runEffects } from "../licensing/effects";
import { markAuthorized } from "../licensing/requests";
import { applyTransition, ignoredEvent } from "../licensing/state-machine";
import { errorName, logEvent } from "../log";
import type { PaymentsEvent } from "./driver";
import { retrieveCheckout } from "./index";

// Stripe's events, as the webhook route (P25) and the dev fake checkout pass them (02 §8.1; 07 D24, D96). Each event is
// claimed once in stripe_event, its request resolved, then routed; nothing here holds a transaction around a payments
// call. Imported from this file, never through ./index: licensing/requests imports ./index.

const WEBHOOK: Actor = { kind: "system", source: "webhook" };

export type WebhookOutcome = "processed" | "duplicate" | "ignored";

type RequestEvent = Exclude<PaymentsEvent, { type: "ignored" }>;

type Handled = {
  outcome: "processed" | "ignored";
  requestId: string | null;
  lastError: string | null;
};

/**
 * Handles one Stripe event (02 §8.1 steps 1–6). `platformCurrency` is the Stripe platform account it came from: the
 * route's [currency], or the request's for a fake event (07 D96). An event seen before is a duplicate once processed,
 * and processed again (attempts + 1) when it never finished. An exception is stored on the event, then rethrown, so
 * Stripe retries it.
 */
export async function onWebhookEvent(
  e: PaymentsEvent,
  platformCurrency: Currency,
): Promise<WebhookOutcome> {
  if (!(await claim(e, platformCurrency))) return "duplicate";
  try {
    const handled = await handle(e, platformCurrency);
    await db
      .update(stripeEvent)
      .set({
        processedAt: sql`now()`,
        licenseRequestId: handled.requestId,
        lastError: handled.lastError,
      })
      .where(eq(stripeEvent.id, e.id));
    return handled.outcome;
  } catch (error) {
    // Fenced on processed_at: the claim takes an unfinished event again (P25 adds the lease), so another delivery of it
    // may have finished meanwhile, and its outcome stands.
    await db
      .update(stripeEvent)
      .set({ lastError: failureOf(error) })
      .where(and(eq(stripeEvent.id, e.id), isNull(stripeEvent.processedAt)));
    throw error;
  }
}

/** Step 1: true when this delivery should be processed, a new event or one that never finished. */
async function claim(
  e: PaymentsEvent,
  platformCurrency: Currency,
): Promise<boolean> {
  // The request is linked once resolved: an unknown id here would break the foreign key.
  const [claimed] = await db
    .insert(stripeEvent)
    .values({
      id: e.id,
      platformCurrency,
      type: e.type === "ignored" ? e.stripeType : e.type,
      livemode: e.livemode,
      objectId: objectIdOf(e),
    })
    .onConflictDoNothing({ target: stripeEvent.id })
    .returning({ id: stripeEvent.id });
  if (claimed) return true;
  const [retried] = await db
    .update(stripeEvent)
    .set({ attempts: sql`${stripeEvent.attempts} + 1` })
    .where(and(eq(stripeEvent.id, e.id), isNull(stripeEvent.processedAt)))
    .returning({ id: stripeEvent.id });
  return retried !== undefined;
}

function objectIdOf(e: PaymentsEvent): string | null {
  if (e.type === "ignored") return null;
  return "sessionId" in e ? e.sessionId : e.paymentIntentId;
}

/** Steps 2–4: the request, the account check, then the route by type. */
async function handle(
  e: PaymentsEvent,
  platformCurrency: Currency,
): Promise<Handled> {
  if (e.type === "ignored") {
    return { outcome: "ignored", requestId: null, lastError: null };
  }
  const row = await resolveRequest(e);
  if (!row) {
    logEvent("warn", "stripe_event.unmatched", { eventId: e.id, type: e.type });
    return { outcome: "ignored", requestId: null, lastError: null };
  }
  const requestId = row.id;
  // Another account's event for this request: before any transition or payments call (07 D96).
  if (row.currency !== platformCurrency) {
    await writeAudit(db, WEBHOOK, {
      action: "stripe_event.currency_mismatch",
      entityType: "stripe_event",
      entityId: e.id,
      data: { requestId },
    });
    return { outcome: "ignored", requestId, lastError: "currency_mismatch" };
  }
  switch (e.type) {
    case "checkout.session.completed":
    case "payment_intent.amount_capturable_updated":
      await markAuthorized(requestId, WEBHOOK);
      break;
    case "checkout.session.expired":
      await checkoutExpired(row, e.sessionId);
      break;
    case "payment_intent.payment_failed":
      // T12: the buyer can try another card on the same Checkout; nothing changes.
      await writeAudit(db, WEBHOOK, {
        action: "license_request.payment_failed",
        entityType: "license_request",
        entityId: requestId,
        data: { from: row.status },
      });
      break;
    default:
      // payment_intent.succeeded and .canceled: P18 and P19.
      return { outcome: "ignored", requestId, lastError: null };
  }
  return { outcome: "processed", requestId, lastError: null };
}

type ResolvedRequest = {
  id: string;
  status: LicenseRequestStatus;
  currency: Currency;
  sessionId: string | null;
};

/** Step 2: the event's request id, else the session or PaymentIntent the request stored; null when none matches. */
async function resolveRequest(
  e: RequestEvent,
): Promise<ResolvedRequest | null> {
  const columns = {
    id: licenseRequest.id,
    status: licenseRequest.status,
    currency: licenseRequest.currency,
    sessionId: licenseRequest.stripeCheckoutSessionId,
  };
  if (e.requestId && isUuid(e.requestId)) {
    const [byId] = await db
      .select(columns)
      .from(licenseRequest)
      .where(eq(licenseRequest.id, e.requestId));
    if (byId) return byId;
  }
  const [byObject] = await db
    .select(columns)
    .from(licenseRequest)
    .where(
      "sessionId" in e
        ? eq(licenseRequest.stripeCheckoutSessionId, e.sessionId)
        : eq(licenseRequest.stripePaymentIntentId, e.paymentIntentId),
    );
  return byObject ?? null;
}

/**
 * T11 (03 §5.1; 07 D27): the request's own session ended unpaid. Stripe is asked first: a session it calls complete was
 * paid, so the late event changes nothing and is only recorded. A checkout that ends unpaid charges nothing, so there
 * is nothing to cancel.
 */
async function checkoutExpired(
  row: ResolvedRequest,
  sessionId: string,
): Promise<void> {
  if (row.sessionId !== sessionId) {
    logEvent("info", "stripe_event.stale_session", { requestId: row.id });
    return;
  }
  const session = await retrieveCheckout(row.currency, sessionId);
  if (session.status === "complete") {
    await writeAudit(
      db,
      WEBHOOK,
      ignoredEvent(row.id, row.status, "checkout_expired"),
    );
    return;
  }
  const result = await db.transaction((tx) =>
    applyTransition(
      tx,
      row.id,
      "checkout_expired",
      { abandonedAt: new Date(), statusReason: "checkout_expired" },
      WEBHOOK,
    ),
  );
  runEffects(result.effects);
}

/**
 * What last_error keeps of a failure: the error's class and its Postgres code, never its message, which can hold a
 * query's bound values (a buyer's name or email).
 */
function failureOf(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  const pgCode =
    cause && typeof cause === "object" && "code" in cause
      ? cause.code
      : undefined;
  return typeof pgCode === "string"
    ? `${errorName(error)} ${pgCode}`
    : errorName(error);
}
