import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { creatorProfile, licenseRequest, video } from "@/db/schema";
import type { LicenseRequest } from "@/db/schema/types";
import type { SocialProviderId } from "@/lib/domain/values";
import type { DeclineResult } from "@/lib/licensing/request-dto";
import {
  chosenMultipliers,
  feeTerms,
  scopeLabel,
} from "@/lib/licensing/selection";
import {
  isTerminal,
  type LicenseRequestEvent,
} from "@/lib/licensing/transitions";
import {
  approvalWindowOf,
  computeExpiresAt,
  HOLD_TOO_SHORT_MS,
} from "@/lib/payments/expires-at";
import { computeQuote } from "@/lib/pricing/compute-quote";
import type { StartCheckoutInput } from "@/lib/validation/checkout";
import { normalizeEmail } from "@/lib/validation/email";
import { normalizeTimeZone } from "@/lib/validation/time-zone";
import { writeAudit } from "../audit";
import { type Actor, LAZY, WEBHOOK } from "../auth/actor";
import { enabledCurrencies, env } from "../env";
import { errorName, logEvent } from "../log";
import {
  type CancelReason,
  cancel,
  createCheckout,
  getAuthorization,
  retrieveCheckout,
} from "../payments";
import {
  type Authorization,
  CHECKOUT_SESSION_TTL_MINUTES,
} from "../payments/driver";
import { CurrencyNotEnabledError } from "../payments/registry";
import {
  effectiveOptions,
  getRateCard,
  videoPricingOf,
} from "../pricing/rate-card";
import type { RequestContext } from "../request-context";
import { enabledPlatforms } from "../social/registry";
import { findRequestForBuyer, generateBuyerToken } from "../tokens/buyer-token";
import {
  isPubliclyAvailable,
  postingPlatformsColumn,
} from "../videos/visibility";
import { authorizationMismatches } from "./authorization";
import { overdueColumn, pastDeadline } from "./deadline";
import { runEffects } from "./effects";
import {
  applyTransition,
  type ClaimedRequest,
  canceledEventFor,
  claimOf,
  claimPaymentAction,
  type DeclineReason,
  finishCanceled,
  ignoredEvent,
  isStuckClaim,
  reconcileFromStripe,
  reconcileIfStuck,
  type TransitionResult,
  unchangedResult,
} from "./state-machine";

// A buyer's license request (02 §5.7, §8.1, §8.3; 03 §5.1 T1–T3; 06 §6; 07 D24, D27, D31, D32, D74, D79, D81, D82,
// D84, D94, D95): priced by the server, saved once per form submission, handed to Checkout, then authorized when the
// card is held. Payouts are not checked: buyers can pay before the creator sets them up (07 D74). The video lock and
// availability check (07 D110) arrive with P19f, whose tables they read (owner answer Q-122 a); until then
// markAuthorized re-checks that the video is published. Then its endings other than approval (03 T8–T10; P19): the
// creator's decline, expiry at the deadline, and Stripe's canceled event. Statuses change only through the state
// machine.

export type CreateLicenseRequestResult =
  | { ok: true; checkoutUrl: string }
  | { ok: false; reason: "price_changed"; totalCents: number }
  | {
      ok: false;
      reason:
        | "not_available"
        | "option_disabled"
        | "over_max"
        | "checkout_failed"
        | "already_submitted";
    };

/** The row as createLicenseRequest builds it; the transaction adds the creator's settings and the two timestamps. */
type NewRequest = Omit<
  typeof licenseRequest.$inferInsert,
  | "approvalWindowHours"
  | "autoApprove"
  | "termsAcceptedAt"
  | "checkoutExpiresAt"
>;

/**
 * The request for `i` (the parsed StartCheckoutSchema), checked against the video and its creator's rate card, or why
 * not. A `submissionId` makes one row: sending it again returns that request's open Checkout, unless anything the
 * buyer entered changed. `platforms`: the enabled social platforms (tests pass their own).
 */
export async function createLicenseRequest(
  i: StartCheckoutInput,
  ctx: RequestContext,
  platforms: readonly SocialProviderId[] = enabledPlatforms(),
): Promise<CreateLicenseRequestResult> {
  const [row] = await db
    .select({
      id: video.id,
      creatorId: video.creatorId,
      title: video.title,
      status: video.status,
      disabledUses: video.disabledUses,
      basePriceOverrideCents: video.basePriceOverrideCents,
      postingPlatforms: postingPlatformsColumn,
    })
    .from(video)
    .where(eq(video.id, i.videoId));
  if (!row || !isPubliclyAvailable(row, platforms)) {
    return { ok: false, reason: "not_available" };
  }
  const options = effectiveOptions(
    await getRateCard(row.creatorId),
    videoPricingOf(row),
  );
  const multipliers = chosenMultipliers(options, {
    use: i.useKey,
    term: i.termKey,
    territory: i.territoryKey,
    territoryCode: i.territoryCode,
  });
  if (!multipliers) return { ok: false, reason: "option_disabled" };
  const { currency } = options;
  const fees = feeTerms(options, env.PLATFORM_FEE_BPS);
  const result = computeQuote({
    currency,
    basePriceCents: options.basePriceCents,
    ...multipliers,
    ...fees,
  });
  if (!result.ok) {
    if (result.reason === "over_max") return { ok: false, reason: "over_max" };
    throw new Error("License request: the quote's input is out of range");
  }
  const { quote } = result;
  if (quote.totalCents !== i.expectedTotalCents) {
    return { ok: false, reason: "price_changed", totalCents: quote.totalCents };
  }
  // Before the row: a currency without its platform account must not leave a request behind (06 §6).
  if (!enabledCurrencies().includes(currency)) {
    throw new CurrencyNotEnabledError(currency);
  }

  const id = randomUUID();
  const token = generateBuyerToken(id);
  const buyerEmail = normalizeEmail(i.buyerEmail);
  const values: NewRequest = {
    id,
    videoId: row.id,
    creatorId: row.creatorId,
    licenseeName: i.licenseeName,
    contactName: i.contactName,
    buyerEmail,
    intendedUse: i.intendedUse || null,
    buyerTimeZone: normalizeTimeZone(i.timeZone),
    buyerTokenHash: token.hash,
    buyerTokenEnc: token.enc,
    useKey: i.useKey,
    termKey: i.termKey,
    territoryKey: i.territoryKey,
    territoryCode: i.territoryCode,
    currency,
    basePriceCents: options.basePriceCents,
    useMultiplierBps: multipliers.useBps,
    termMultiplierBps: multipliers.termBps,
    territoryMultiplierBps: multipliers.territoryBps,
    ...fees,
    licensePriceCents: quote.licensePriceCents,
    platformFeeCents: quote.platformFeeCents,
    amountTotalCents: quote.totalCents,
    termsVersion: i.termsVersion,
    termsAcceptedIp: ctx.ip,
    termsAcceptedUserAgent: ctx.userAgent,
    checkoutSubmissionId: i.submissionId,
  };
  const saved = await saveRequest(values);
  if (saved.kind === "existing") return resubmitted(saved.request, values);

  // After the commit, never inside it (07 D24).
  let session: { sessionId: string; url: string };
  try {
    session = await createCheckout(currency, {
      currency,
      requestId: id,
      buyerToken: token.token,
      buyerEmail,
      licensePriceCents: quote.licensePriceCents,
      platformFeeCents: quote.platformFeeCents,
      licenseLabel: `${row.title} · ${scopeLabel(i)}`,
      checkoutExpiresAt: saved.checkoutExpiresAt,
    });
  } catch (error) {
    // The row stays checkout_pending with no session; [H4]'s sweep abandons it (07 D57).
    logEvent("warn", "license_request.checkout_failed", {
      requestId: id,
      error: errorName(error),
    });
    return { ok: false, reason: "checkout_failed" };
  }
  const [stored] = await db
    .update(licenseRequest)
    .set({ stripeCheckoutSessionId: session.sessionId })
    .where(
      and(
        eq(licenseRequest.id, id),
        isNull(licenseRequest.stripeCheckoutSessionId),
      ),
    )
    .returning({ id: licenseRequest.id });
  if (!stored) return { ok: false, reason: "checkout_failed" };
  return { ok: true, checkoutUrl: session.url };
}

/**
 * The insert (T1), in one short transaction: the creator's row FOR SHARE, so the currency, the approval window and
 * auto-approve are the ones in force (07 D81, D94, I33), then the row, or nothing when the submission already has one,
 * and its audit. Nothing here calls the payments driver.
 */
async function saveRequest(
  values: NewRequest,
): Promise<
  | { kind: "created"; checkoutExpiresAt: Date }
  | { kind: "existing"; request: LicenseRequest }
> {
  return db.transaction(async (tx) => {
    const [creator] = await tx
      .select({
        payoutCurrency: creatorProfile.payoutCurrency,
        approvalWindowHours: creatorProfile.approvalWindowHours,
        autoApprove: creatorProfile.autoApprove,
      })
      .from(creatorProfile)
      .where(eq(creatorProfile.id, values.creatorId))
      .for("share");
    if (creator?.payoutCurrency !== values.currency) {
      // Priced in another currency than the creator's now: not possible before P34 lets a creator change it.
      throw new Error("License request: the creator's currency changed");
    }
    const [inserted] = await tx
      .insert(licenseRequest)
      .values({
        ...values,
        approvalWindowHours: creator.approvalWindowHours,
        autoApprove: creator.autoApprove,
        termsAcceptedAt: sql`now()`,
        checkoutExpiresAt: sql`now() + make_interval(mins => ${CHECKOUT_SESSION_TTL_MINUTES}::int)`,
      })
      .onConflictDoNothing({ target: licenseRequest.checkoutSubmissionId })
      .returning({
        id: licenseRequest.id,
        checkoutExpiresAt: licenseRequest.checkoutExpiresAt,
      });
    if (inserted) {
      await writeAudit(
        tx,
        { kind: "buyer", requestId: inserted.id },
        {
          action: "license_request.created",
          entityType: "license_request",
          entityId: inserted.id,
          data: { videoId: values.videoId, creatorId: values.creatorId },
        },
      );
      return { kind: "created", checkoutExpiresAt: inserted.checkoutExpiresAt };
    }
    const [request] = await tx
      .select()
      .from(licenseRequest)
      .where(
        eq(licenseRequest.checkoutSubmissionId, values.checkoutSubmissionId),
      );
    if (!request)
      throw new Error("License request: the conflicting row is gone");
    return { kind: "existing", request };
  });
}

/** What a resubmit is compared on (07 D31, J7.9; owner answer Q-120 a: the names and the use too). */
const RESUBMIT_KEYS = [
  "videoId",
  "buyerEmail",
  "licenseeName",
  "contactName",
  "intendedUse",
  "useKey",
  "termKey",
  "territoryKey",
  "territoryCode",
] as const;

/**
 * The same submission again (a double tap, Back, a retry): its open Checkout when the buyer entered the same things and
 * it is still in checkout (07 D31, J7.9), else "already sent". A Checkout that can't be read throws, so the page keeps
 * the submission and a retry reads it again: a fresh one could open a second Checkout beside the first.
 */
async function resubmitted(
  request: LicenseRequest,
  sent: NewRequest,
): Promise<CreateLicenseRequestResult> {
  const same =
    request.status === "checkout_pending" &&
    RESUBMIT_KEYS.every((key) => request[key] === sent[key]);
  if (!same || !request.stripeCheckoutSessionId) {
    return { ok: false, reason: "already_submitted" };
  }
  const session = await retrieveCheckout(
    request.currency,
    request.stripeCheckoutSessionId,
  );
  return session.status === "open" && session.url
    ? { ok: true, checkoutUrl: session.url }
    : { ok: false, reason: "already_submitted" };
}

/**
 * T2 or T3 (02 §8.1 row 1; 03 T2, T3; 07 D27, D28, D32): a request in checkout whose card is held becomes
 * awaiting_approval, or abandoned when the hold, the video or the time it leaves is wrong. Stripe is read first, the
 * decision is one short transaction; after the commit its emails are sent (after the response) or the abandoned hold is
 * released. Anything else changes
 * nothing: another status (a webhook's late or second event is audited), no session or PaymentIntent, a session of
 * another request, a PaymentIntent not held. `platforms`: the enabled social platforms (tests pass their own).
 */
export async function markAuthorized(
  requestId: string,
  actor: Actor,
  platforms: readonly SocialProviderId[] = enabledPlatforms(),
): Promise<TransitionResult> {
  const [row] = await db
    .select()
    .from(licenseRequest)
    .where(eq(licenseRequest.id, requestId));
  if (!row) throw new Error("markAuthorized: unknown request");
  const unchanged = unchangedResult(row);
  if (row.status !== "checkout_pending") {
    if (actor.kind === "system" && actor.source === "webhook") {
      await writeAudit(
        db,
        actor,
        ignoredEvent(row.id, row.status, "authorized"),
      );
    }
    return unchanged;
  }
  if (!row.stripeCheckoutSessionId) return unchanged;
  const session = await retrieveCheckout(
    row.currency,
    row.stripeCheckoutSessionId,
  );
  if (session.requestId !== row.id || !session.paymentIntentId) {
    return unchanged;
  }
  const auth = await getAuthorization(row.currency, session.paymentIntentId);
  if (auth.status === "succeeded") {
    // Charged before any approval (07 D32): recorded only, until P18 and P25 reconcile it (owner answer Q-123 a).
    await writeAudit(
      db,
      actor,
      ignoredEvent(row.id, row.status, "authorized", { piStatus: auth.status }),
    );
    return unchanged;
  }
  if (auth.status !== "requires_capture") return unchanged;
  const { result, reason } = await decideAuthorization(
    row,
    auth,
    session.currency,
    actor,
    platforms,
  );
  runEffects(result.effects);
  if (result.changed && reason) await releaseHold(result.row, reason, actor);
  return result;
}

/** Why a held card is let go before approval (07 D27): each is the abandon event, its status_reason and the cancel's. */
type AbandonReason = Extract<CancelReason, LicenseRequestEvent>;

/**
 * After an abandon commits (07 D24, D27): cancels the hold, keyed by the attempt that abandon counted, so a retry sends
 * the same key. A cancel that fails (a thrown call comes back as transient: Stripe may or may not have canceled it) is
 * audited; the hold then lapses at capture_before, uncharged.
 */
async function releaseHold(
  row: LicenseRequest,
  reason: AbandonReason,
  actor: Actor,
): Promise<void> {
  if (!row.stripePaymentIntentId) return;
  const outcome = await cancel(
    row.currency,
    row.id,
    row.stripePaymentIntentId,
    reason,
    row.stripeAttempt,
  );
  if (outcome.ok) return;
  await writeAudit(db, actor, {
    action: "license_request.cancel_failed",
    entityType: "license_request",
    entityId: row.id,
    data: { reason, kind: outcome.kind, code: outcome.code },
  });
}

/**
 * The buyer is back from Checkout (02 §8.3), maybe before the webhook: with their own link and the session it stored,
 * once Stripe calls that session complete (owner answer Q-119 a) and the card is held, markAuthorized runs as the
 * webhook's would. Anything else changes nothing, and the page shows the stored status.
 */
export async function reconcileCheckoutReturn(
  requestId: string,
  token: string,
  sessionId: string,
): Promise<void> {
  const row = await findRequestForBuyer(requestId, token);
  if (
    row?.status !== "checkout_pending" ||
    row.stripeCheckoutSessionId !== sessionId
  ) {
    return;
  }
  const session = await retrieveCheckout(row.currency, sessionId);
  if (
    session.status !== "complete" ||
    session.requestId !== row.id ||
    !session.paymentIntentId
  ) {
    return;
  }
  const auth = await getAuthorization(row.currency, session.paymentIntentId);
  if (auth.status !== "requires_capture") return;
  await markAuthorized(row.id, { kind: "system", source: "return_url" });
}

/** Who may decline, and why (07 D28): the request's creator, as `creator`. P21 adds the admin with `video_disabled`. */
function declineScope(
  actor: Actor,
  reason: DeclineReason,
): { creatorId: string } | null {
  return actor.kind === "creator" && reason === "creator"
    ? { creatorId: actor.creatorId }
    : null;
}

/** Decline's view of a request, scoped to the creator: null when it isn't theirs. */
async function declineState(requestId: string, creatorId: string) {
  const [row] = await db
    .select({
      status: licenseRequest.status,
      paymentAction: licenseRequest.paymentAction,
      paymentActionAt: licenseRequest.paymentActionAt,
      overdue: overdueColumn,
    })
    .from(licenseRequest)
    .where(
      and(
        eq(licenseRequest.id, requestId),
        eq(licenseRequest.creatorId, creatorId),
      ),
    );
  return row ?? null;
}

type DeclineState = NonNullable<Awaited<ReturnType<typeof declineState>>>;

/** Decline's state after a step that may have changed it; the request was the creator's a moment ago. */
async function declineStateOf(
  requestId: string,
  creatorId: string,
): Promise<DeclineState> {
  const state = await declineState(requestId, creatorId);
  if (!state) throw new Error("declineLicenseRequest: the request is gone");
  return state;
}

const notActionable = (s: DeclineState): DeclineResult => ({
  ok: false,
  reason: "not_actionable",
  status: s.status,
});

/**
 * Declines waiting request `requestId` (02 §8.2; 03 T8; 07 D24, D25, D28; owner answer OQ-31: one tap). A stuck claim is
 * reconciled first, and past its deadline the request expires instead (T9). Otherwise: the decline claim, the cancel
 * (requested_by_customer, `pi-cancel:<id>:decline:<attempt>`) outside any transaction, the fenced finish, or Stripe's
 * word when the cancel isn't ok. ok only once the request is stored declined: a released claim says retry, a claim
 * still held reads Processing…, and a late capture that won reports approved. `reason` is the server's (declineScope).
 */
export async function declineLicenseRequest(
  requestId: string,
  actor: Actor,
  reason: DeclineReason = "creator",
): Promise<DeclineResult> {
  const scope = declineScope(actor, reason);
  if (!scope) return { ok: false, reason: "not_actionable", status: null };
  const { creatorId } = scope;
  let state = await declineState(requestId, creatorId);
  if (!state) return { ok: false, reason: "not_actionable", status: null };
  if (await reconcileIfStuck(requestId, state, actor)) {
    state = await declineStateOf(requestId, creatorId);
  }
  if (
    state.status === "awaiting_approval" &&
    !state.paymentAction &&
    state.overdue
  ) {
    // T8: the deadline passed, so the request expires; it reads expired only once Stripe has released the hold.
    await expireLicenseRequest(requestId, LAZY);
    return notActionable(await declineStateOf(requestId, creatorId));
  }
  const claimed = await claimPaymentAction(requestId, "decline");
  if (!claimed)
    return notActionable(await declineStateOf(requestId, creatorId));
  const done = await cancelClaimed(claimed, actor, reason);
  if (done?.to === "declined") return { ok: true };
  const after = await declineStateOf(requestId, creatorId);
  if (after.status === "declined") return { ok: true };
  return after.status === "awaiting_approval" && !after.paymentAction
    ? { ok: false, reason: "retry", status: after.status }
    : notActionable(after);
}

/**
 * The cancel a decline or an expiry claimed (02 §8.2; 03 T8, T9; 07 D24, D25, D30), outside any transaction and keyed
 * by the claim's attempt: ok → the fenced finish; else Stripe's word through reconcileFromStripe with the claim, which
 * releases it while the hold still waits. Never throws: after a failure the claim stays for the stuck-claim reconcile.
 * The finish's result when this call wrote the ending, else null.
 */
async function cancelClaimed(
  claimed: ClaimedRequest,
  actor: Actor,
  statusReason?: DeclineReason,
): Promise<TransitionResult | null> {
  const claim = {
    action: claimed.paymentAction,
    claimedAt: claimed.paymentActionAt,
  };
  const reason = claim.action === "decline" ? "decline" : "expire";
  try {
    if (!claimed.stripePaymentIntentId) {
      throw new Error("cancelClaimed: a waiting request without a hold");
    }
    const outcome = await cancel(
      claimed.currency,
      claimed.id,
      claimed.stripePaymentIntentId,
      reason,
      claimed.stripeAttempt,
    );
    if (outcome.ok) {
      return await finishCanceled(claimed.id, { claim, actor, statusReason });
    }
    await reconcileFromStripe(claimed.id, { actor, claim });
  } catch (error) {
    logEvent("warn", "license_request.cancel_claim_failed", {
      requestId: claimed.id,
      action: claim.action,
      error: errorName(error),
    });
  }
  return null;
}

/** The stored request. */
async function storedRequest(requestId: string): Promise<LicenseRequest> {
  const [row] = await db
    .select()
    .from(licenseRequest)
    .where(eq(licenseRequest.id, requestId));
  if (!row) throw new Error("license request: unknown request");
  return row;
}

/**
 * T9 (03 §5.1; 07 D25, D57, D77): expires waiting request `requestId` once its deadline has passed on the database's
 * clock: the expire claim, the cancel (abandoned, `pi-cancel:<id>:expire:<attempt>`), then expired / deadline, or
 * Stripe's word when the cancel isn't ok (a hold that still waits releases the claim, so the request is due again). Any
 * actor: the deadline decides, not who asks. Null when nothing was claimed (not due, claimed or decided); the finish's
 * result when this call wrote the ending; else the request as it now is (expired by the webhook, approved by a late
 * capture, or waiting).
 */
export async function expireLicenseRequest(
  requestId: string,
  actor: Actor,
): Promise<TransitionResult | null> {
  const claimed = await claimPaymentAction(requestId, "expire");
  if (!claimed) return null;
  const done = await cancelClaimed(claimed, actor);
  return done ?? unchangedResult(await storedRequest(requestId));
}

/**
 * Expires the waiting requests nobody holds whose deadline has passed (02 §8.4; 03 §7.10), soonest first, one at a time:
 * one request (/r), one creator's (their pages), or up to `limit` (the cron, which starts none after `stopAt`, epoch
 * ms). A request that fails is logged and the rest go on. Returns how many are now expired, never how many were tried:
 * a released claim is due again, so a caller rerunning only after a full batch stops.
 */
export async function expireDueRequests({
  requestId,
  creatorId,
  limit = 100,
  actor = LAZY,
  stopAt,
}: {
  requestId?: string;
  creatorId?: string;
  limit?: number;
  actor?: Actor;
  stopAt?: number;
} = {}): Promise<number> {
  const due = await db
    .select({ id: licenseRequest.id })
    .from(licenseRequest)
    .where(
      and(
        requestId ? eq(licenseRequest.id, requestId) : undefined,
        creatorId ? eq(licenseRequest.creatorId, creatorId) : undefined,
        eq(licenseRequest.status, "awaiting_approval"),
        isNull(licenseRequest.paymentAction),
        pastDeadline,
      ),
    )
    .orderBy(asc(licenseRequest.expiresAt), asc(licenseRequest.id))
    .limit(limit);
  let expired = 0;
  for (const { id } of due) {
    if (stopAt !== undefined && Date.now() >= stopAt) break;
    try {
      const result = await expireLicenseRequest(id, actor);
      if (result?.to === "expired") expired += 1;
    } catch (error) {
      logEvent("warn", "license_request.expire_failed", {
        requestId: id,
        error: errorName(error),
      });
    }
  }
  return expired;
}

/**
 * payment_intent.canceled (02 §8.1; 03 T6, T10, T13; 07 D25, D26). The event is never trusted alone: a waiting request is
 * reconciled from its own PaymentIntent, so it ends only once Stripe says the hold is canceled (declined for a decline
 * claim; expired with deadline for an expire claim, with hold_released for none, Stripe's own cancel, J8.7). A capture
 * claim is its holder's to finish, unless stuck (07 D26: then capture_failed). An ended request records the late event.
 * Acts as the webhook. A retrieve that throws throws, so the delivery fails and Stripe sends it again.
 */
export async function handlePaymentIntentCanceled(
  requestId: string,
): Promise<TransitionResult> {
  const before = await storedRequest(requestId);
  if (before.status !== "awaiting_approval") {
    if (isTerminal(before.status)) {
      await writeAudit(
        db,
        WEBHOOK,
        ignoredEvent(
          requestId,
          before.status,
          canceledEventFor(claimOf(before)),
          { stripeEvent: "payment_intent.canceled" },
        ),
      );
    }
    return unchangedResult(before);
  }
  const claim = claimOf(before);
  if (claim?.action === "capture" && !isStuckClaim(claim.claimedAt)) {
    return unchangedResult(before);
  }
  await reconcileFromStripe(requestId, { actor: WEBHOOK });
  const after = await storedRequest(requestId);
  return {
    changed: after.status !== before.status,
    from: before.status,
    to: after.status,
    effects: [],
    row: after,
  };
}

/** The video can still be licensed (07 D27): published, and not hidden by a mock posting (07 D51). */
async function videoAvailable(
  tx: Tx,
  videoId: string,
  platforms: readonly SocialProviderId[],
): Promise<boolean> {
  const [row] = await tx
    .select({ status: video.status, postingPlatforms: postingPlatformsColumn })
    .from(video)
    .where(eq(video.id, videoId));
  return row !== undefined && isPubliclyAvailable(row, platforms);
}

/**
 * T2 or T3 in one short transaction (02 §8.1 row 1; 07 D32, D81): the asserts, then the video, then the hold's length:
 * at least an hour to approve (03 T2), from the request's own window. The first that fails abandons the request,
 * naming the asserts that failed; all passing authorizes it. P19f locks the video here, before applyTransition.
 */
async function decideAuthorization(
  row: LicenseRequest,
  auth: Authorization,
  sessionCurrency: string | null,
  actor: Actor,
  platforms: readonly SocialProviderId[],
): Promise<{ result: TransitionResult; reason: AbandonReason | null }> {
  const mismatches = authorizationMismatches(row, auth, sessionCurrency);
  const now = new Date();
  // The deadline counts from the instant stored as authorized_at.
  const authorizedAt = auth.authorizedAt ?? now;
  const expiresAt = computeExpiresAt({
    authorizedAt,
    captureBefore: auth.captureBefore,
    approvalWindowHours: approvalWindowOf(row.approvalWindowHours),
  });
  const ids = {
    stripePaymentIntentId: auth.paymentIntentId,
    stripeChargeId: auth.chargeId,
  };
  return db.transaction(async (tx) => {
    let reason: AbandonReason | null = null;
    if (mismatches.length > 0) reason = "amount_mismatch";
    else if (!(await videoAvailable(tx, row.videoId, platforms))) {
      reason = "video_unavailable";
    } else if (expiresAt.getTime() < now.getTime() + HOLD_TOO_SHORT_MS) {
      reason = "hold_too_short";
    }
    if (!reason) {
      const patch = {
        ...ids,
        authorizedAt,
        captureBefore: auth.captureBefore,
        expiresAt,
      };
      const result = await applyTransition(
        tx,
        row.id,
        "authorized",
        patch,
        actor,
      );
      return { result, reason };
    }
    const patch = {
      ...ids,
      abandonedAt: now,
      statusReason: reason,
      incrementStripeAttempt: true,
    };
    const result = await applyTransition(tx, row.id, reason, patch, actor);
    if (result.changed && mismatches.length > 0) {
      await writeAudit(tx, actor, {
        action: "license_request.amount_mismatch",
        entityType: "license_request",
        entityId: row.id,
        data: { fields: mismatches },
      });
    }
    return { result, reason };
  });
}
