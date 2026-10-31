import "server-only";
import { and, asc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db, type Tx } from "@/db/client";
import { licenseRequest, video } from "@/db/schema";
import type { LicenseRequest, NewLicenseRequest } from "@/db/schema/types";
import { isOneOf, type LicenseRequestStatus } from "@/lib/domain/values";
import {
  type LicenseRequestEvent,
  nextStatus,
} from "@/lib/licensing/transitions";
import { MINUTE_MS } from "@/lib/time";
import { type AuditEntry, writeAudit } from "../audit";
import { type Actor, LAZY } from "../auth/actor";
import {
  type RequestEmailTemplate,
  requestEmailFacts,
  requestEnvelope,
} from "../email/request-emails";
import { queueEmail } from "../email/send";
import { licenseApprovedSubject } from "../email/subjects";
import { errorName, logEvent } from "../log";
import { cancel, getAuthorization } from "../payments";
import type { StripeCallOutcome } from "../payments/driver";
import { runEffects } from "./effects";
import { issueLicense } from "./issue";

// The license request state machine (02 §5.7; 03 §5.1; 07 §2.2, D24–D26, D47): the only writer of
// license_request.status, and the payment claims every capture and cancel of a waiting request goes through: claim,
// call Stripe outside any transaction, then a finish fenced on the claim.
// Never call PaymentsDriver inside db.transaction (07 D24): callers decide, commit, then call out.

/** Work a transition queues for after its commit: an email_log row to send (runEffects). */
export type Effect = { kind: "email"; emailLogId: string };

/**
 * The emails an accepted event queues (07 D34). license-approved is queued by finishCapture, after issueLicense. expired
 * and capture_failed queue nothing in CORE (07 D34): P33b adds the [H5] ones.
 */
const EMAILS: Partial<
  Record<LicenseRequestEvent, readonly RequestEmailTemplate[]>
> = {
  authorized: ["request-new", "request-received"],
  declined: ["request-declined"],
};

export type TransitionResult = {
  changed: boolean;
  from: LicenseRequestStatus;
  /** Where the request is now: `from` when nothing changed. */
  to: LicenseRequestStatus;
  effects: Effect[];
  /** The row as the transition left it (as locked when nothing changed): a cancel's key takes its stripe_attempt. */
  row: LicenseRequest;
};

/**
 * The columns a transition may set beside the status (03 §5.1): never the status or the payment claim. `stripe_attempt`
 * only goes up by one, through `incrementStripeAttempt`.
 */
export type LicenseRequestPatch = Pick<
  NewLicenseRequest,
  | "stripePaymentIntentId"
  | "stripeChargeId"
  | "authorizedAt"
  | "captureBefore"
  | "expiresAt"
  | "abandonedAt"
  | "approvedAt"
  | "declinedAt"
  | "expiredAt"
  | "captureFailedAt"
  | "statusReason"
> & { incrementStripeAttempt: boolean };

/** The status_reason values each ending of a waiting request takes (07 §2.1). P19g adds the exclusive conflict. */
const DECLINE_REASONS = ["creator", "video_disabled"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];
const EXPIRE_REASONS = ["deadline", "hold_released"] as const;
/** A Stripe error code as a capture failure stores it (03 T7): lowercase words, never free text. */
const CAPTURE_ERROR_CODE = /^[a-z0-9_]{1,64}$/;
const CAPTURE_FAILED_REASON =
  /^(pi_canceled_during_capture|capture_error:[a-z0-9_]{1,64})$/;
export type CaptureFailedReason =
  | "pi_canceled_during_capture"
  | `capture_error:${string}`;

/** A capture's failure reason (03 T7): Stripe's error code, or `unknown` for anything that doesn't look like one. */
function captureErrorReason(code: string): CaptureFailedReason {
  return `capture_error:${CAPTURE_ERROR_CODE.test(code) ? code : "unknown"}`;
}

/** Why `patch` can't go with `event` (03 T2–T10), or null. */
function patchProblem(
  event: LicenseRequestEvent,
  patch: Partial<LicenseRequestPatch>,
): string | null {
  switch (event) {
    case "captured":
      if (!patch.approvedAt) return "needs approvedAt";
      return patch.statusReason === undefined
        ? null
        : "an approval has no status reason";
    case "declined":
      return patch.declinedAt &&
        isOneOf(DECLINE_REASONS, patch.statusReason ?? "")
        ? null
        : "needs declinedAt and a decline reason";
    case "expired":
      return patch.expiredAt &&
        isOneOf(EXPIRE_REASONS, patch.statusReason ?? "")
        ? null
        : "needs expiredAt and an expiry reason";
    case "capture_failed":
      return patch.captureFailedAt &&
        CAPTURE_FAILED_REASON.test(patch.statusReason ?? "")
        ? null
        : "needs captureFailedAt and a capture failure reason";
    case "authorized":
      if (!patch.stripePaymentIntentId || !patch.authorizedAt) {
        return "needs the PaymentIntent and authorizedAt";
      }
      return patch.expiresAt && patch.expiresAt > patch.authorizedAt
        ? null
        : "needs an expiresAt after authorizedAt";
    case "checkout_expired":
    case "checkout_failed":
    case "amount_mismatch":
    case "hold_too_short":
    case "video_unavailable":
      if (!patch.abandonedAt || patch.statusReason !== event) {
        return "needs abandonedAt and the event as statusReason";
      }
      return patch.authorizedAt === undefined &&
        patch.captureBefore === undefined &&
        patch.expiresAt === undefined
        ? null
        : "an abandoned request is never authorized";
  }
}

/** The result of a call that left `row` as it was. */
export function unchangedResult(row: LicenseRequest): TransitionResult {
  return { changed: false, from: row.status, to: row.status, effects: [], row };
}

/** The audit entry for an event a request's status ignores (03 T13), plus any `data` the caller adds. */
export function ignoredEvent(
  requestId: string,
  from: LicenseRequestStatus,
  event: LicenseRequestEvent,
  data: Record<string, unknown> = {},
): AuditEntry {
  return {
    action: "license_request.ignored_event",
    entityType: "license_request",
    entityId: requestId,
    data: { from, event, ...data },
  };
}

/**
 * Moves request `requestId` by `event` (07 §2.2), inside the caller's transaction: the row locked FOR UPDATE, then
 * either an `ignored_event` audit when its status doesn't take the event (late or duplicate, 03 T13), or an update
 * guarded on that status with `patch`, and its `transition` audit. The table has no self-loop (transitions.test.ts), so
 * an accepted event always moves the request. An unknown id throws; so does a patch that doesn't fit the event.
 */
export async function applyTransition(
  tx: Tx,
  requestId: string,
  event: LicenseRequestEvent,
  patch: Partial<LicenseRequestPatch>,
  actor: Actor,
): Promise<TransitionResult> {
  const problem = patchProblem(event, patch);
  if (problem) throw new Error(`applyTransition ${event}: ${problem}`);
  const [locked] = await tx
    .select()
    .from(licenseRequest)
    .where(eq(licenseRequest.id, requestId))
    .for("update");
  if (!locked) throw new Error("applyTransition: unknown request");
  const from = locked.status;
  const unchanged = unchangedResult(locked);
  const to = nextStatus(from, event);
  if (!to) {
    await writeAudit(tx, actor, ignoredEvent(requestId, from, event));
    return unchanged;
  }
  // Each column named, so nothing else (the status, the claim) can ride along in the patch.
  const [row] = await tx
    .update(licenseRequest)
    .set({
      stripePaymentIntentId: patch.stripePaymentIntentId,
      stripeChargeId: patch.stripeChargeId,
      authorizedAt: patch.authorizedAt,
      captureBefore: patch.captureBefore,
      expiresAt: patch.expiresAt,
      abandonedAt: patch.abandonedAt,
      approvedAt: patch.approvedAt,
      declinedAt: patch.declinedAt,
      expiredAt: patch.expiredAt,
      captureFailedAt: patch.captureFailedAt,
      statusReason: patch.statusReason,
      stripeAttempt: patch.incrementStripeAttempt
        ? sql`${licenseRequest.stripeAttempt} + 1`
        : undefined,
      status: to,
    })
    .where(
      and(eq(licenseRequest.id, requestId), eq(licenseRequest.status, from)),
    )
    .returning();
  if (!row) return unchanged;
  await writeAudit(tx, actor, {
    action: "license_request.transition",
    entityType: "license_request",
    entityId: requestId,
    data: { from, to, event },
  });
  const effects = await queueEmails(tx, requestId, EMAILS[event] ?? []);
  return { changed: true, from, to, effects, row };
}

/** Queues `templates` for the request in the transition's transaction: one email_log row each, keyed `<template>/<id>`. */
async function queueEmails(
  tx: Tx,
  requestId: string,
  templates: readonly RequestEmailTemplate[],
): Promise<Effect[]> {
  if (templates.length === 0) return [];
  const facts = await requestEmailFacts(tx, requestId);
  if (!facts)
    throw new Error("applyTransition: the request's emails have no recipient");
  const effects: Effect[] = [];
  for (const template of templates) {
    const emailLogId = await queueEmail(tx, {
      template,
      entityType: "license_request",
      entityId: requestId,
      idempotencyKey: `${template}/${requestId}`,
      ...requestEnvelope(template, facts),
    });
    if (emailLogId) effects.push({ kind: "email", emailLogId });
  }
  return effects;
}

/** The claims a waiting request takes (02 §5.7); the renewal actions are claimRenewalAction's (P22e). */
const REQUEST_ACTIONS = ["capture", "decline", "expire"] as const;
export type RequestAction = (typeof REQUEST_ACTIONS)[number];

/** A claim on a waiting request: its action and the instant it was taken, set from JS (ms) so the fence compares equal. */
export type PaymentClaim = { action: RequestAction; claimedAt: Date };

/** A request as claimPaymentAction leaves it: its stripe_attempt is the claim's key attempt. */
export type ClaimedRequest = LicenseRequest & {
  paymentAction: RequestAction;
  paymentActionAt: Date;
};

/** A claim older than this is stuck: its holder died between the claim and the finish (07 D26). */
export const STUCK_CLAIM_MINUTES = 2;

/** Claims taken before this are older than `olderThanMinutes`, on the claim's own (JS) clock. */
const claimedBefore = (olderThanMinutes: number) =>
  new Date(Date.now() - olderThanMinutes * MINUTE_MS);

/** A claim reconcileStuckClaims would take up now (07 D26). */
export const isStuckClaim = (claimedAt: Date | null) =>
  claimedAt !== null && claimedAt < claimedBefore(STUCK_CLAIM_MINUTES);

/** A waiting request held by `claim`, or by no claim at all. Finished rows keep their claim, so the status is checked too. */
function heldBy(claim: PaymentClaim | null) {
  return and(
    eq(licenseRequest.status, "awaiting_approval"),
    claim
      ? and(
          eq(licenseRequest.paymentAction, claim.action),
          eq(licenseRequest.paymentActionAt, claim.claimedAt),
        )
      : isNull(licenseRequest.paymentAction),
  );
}

/** The row's own claim, or null. */
export function claimOf(row: LicenseRequest): PaymentClaim | null {
  const { paymentAction: action, paymentActionAt: claimedAt } = row;
  return action && claimedAt && isOneOf(REQUEST_ACTIONS, action)
    ? { action, claimedAt }
    : null;
}

const sameClaim = (a: PaymentClaim, b: PaymentClaim | undefined | null) =>
  b != null &&
  a.action === b.action &&
  a.claimedAt.getTime() === b.claimedAt.getTime();

/**
 * Claims waiting request `requestId` for `action` before any Stripe call (03 §5.1): one conditional UPDATE … RETURNING
 * that sets the claim and stripe_attempt + 1, only while nobody holds it and within the action's time (capture before
 * the deadline, expire at or after it). A refused claim reconciles a stuck one (07 D26) and tries once more. Null when
 * refused.
 */
export async function claimPaymentAction(
  requestId: string,
  action: RequestAction,
): Promise<ClaimedRequest | null> {
  const claimed = await takeClaim(requestId, action);
  if (claimed) return claimed;
  const resolved = await reconcileStuckClaims({
    requestId,
    olderThanMinutes: STUCK_CLAIM_MINUTES,
  });
  return resolved > 0 ? takeClaim(requestId, action) : null;
}

async function takeClaim(
  requestId: string,
  action: RequestAction,
): Promise<ClaimedRequest | null> {
  const claimedAt = new Date();
  const [claimed] = await db
    .update(licenseRequest)
    .set({
      paymentAction: action,
      paymentActionAt: claimedAt,
      stripeAttempt: sql`${licenseRequest.stripeAttempt} + 1`,
    })
    .where(
      and(
        eq(licenseRequest.id, requestId),
        heldBy(null),
        action === "capture"
          ? sql`now() < ${licenseRequest.expiresAt}`
          : action === "expire"
            ? sql`now() >= ${licenseRequest.expiresAt}`
            : undefined,
      ),
    )
    .returning();
  return claimed
    ? { ...claimed, paymentAction: action, paymentActionAt: claimedAt }
    : null;
}

/**
 * Takes `claim` again for its next Stripe call (03 T7; 07 D30): a fresh claim time and stripe_attempt + 1, so the call
 * gets its own key, fenced on the old claim. Null when another actor resolved the request first.
 */
async function refenceClaim(
  requestId: string,
  claim: PaymentClaim,
): Promise<ClaimedRequest | null> {
  const claimedAt = new Date();
  const [row] = await db
    .update(licenseRequest)
    .set({
      paymentActionAt: claimedAt,
      stripeAttempt: sql`${licenseRequest.stripeAttempt} + 1`,
    })
    .where(and(eq(licenseRequest.id, requestId), heldBy(claim)))
    .returning();
  return row
    ? { ...row, paymentAction: claim.action, paymentActionAt: claimedAt }
    : null;
}

/** Lets go of `claim` while the request still waits under it (07 D26). False when another actor resolved it first. */
export async function releaseClaim(
  requestId: string,
  claim: PaymentClaim,
): Promise<boolean> {
  const released = await db
    .update(licenseRequest)
    .set({ paymentAction: null, paymentActionAt: null })
    .where(and(eq(licenseRequest.id, requestId), heldBy(claim)))
    .returning({ id: licenseRequest.id });
  return released.length > 0;
}

/**
 * Reconciles waiting requests whose claim is older than `olderThanMinutes` (07 D26), oldest first: one request, one
 * creator's (the Inbox), or up to `limit` (the cron, which stops starting requests at `stopAt`, epoch ms). A request
 * Stripe can't be asked about now keeps its claim and is logged. Returns how many claims were resolved (finished, or
 * released), so a caller looping while there is more to do stops.
 */
export async function reconcileStuckClaims({
  requestId,
  creatorId,
  olderThanMinutes,
  limit = 50,
  actor = LAZY,
  stopAt,
}: {
  requestId?: string;
  creatorId?: string;
  olderThanMinutes: number;
  limit?: number;
  actor?: Actor;
  stopAt?: number;
}): Promise<number> {
  // The cutoff on the claim's own (JS) clock, so a 0-minute threshold takes every claim.
  const cutoff = claimedBefore(olderThanMinutes);
  const stuck = await db
    .select()
    .from(licenseRequest)
    .where(
      and(
        requestId ? eq(licenseRequest.id, requestId) : undefined,
        creatorId ? eq(licenseRequest.creatorId, creatorId) : undefined,
        eq(licenseRequest.status, "awaiting_approval"),
        isNotNull(licenseRequest.paymentAction),
        lt(licenseRequest.paymentActionAt, cutoff),
      ),
    )
    .orderBy(asc(licenseRequest.paymentActionAt))
    .limit(limit);
  let resolved = 0;
  for (const row of stuck) {
    if (stopAt !== undefined && Date.now() >= stopAt) break;
    try {
      const outcome = await reconcileFromStripe(row.id, {
        actor,
        claim: claimOf(row),
      });
      if (outcome !== "unchanged") resolved += 1;
    } catch (error) {
      logEvent("warn", "license_request.reconcile_failed", {
        requestId: row.id,
        error: errorName(error),
      });
    }
  }
  return resolved;
}

/**
 * Before an action on request `requestId`: reconciles its claim when it waits under a stuck one (07 D26), as `actor`.
 * True when it did, so the caller reads the request again.
 */
export async function reconcileIfStuck(
  requestId: string,
  row: Pick<LicenseRequest, "status" | "paymentActionAt">,
  actor: Actor,
): Promise<boolean> {
  if (row.status !== "awaiting_approval" || !isStuckClaim(row.paymentActionAt))
    return false;
  await reconcileStuckClaims({
    requestId,
    olderThanMinutes: STUCK_CLAIM_MINUTES,
    actor,
  });
  return true;
}

/** What reconcileFromStripe did: wrote an ending, released the caller's claim, or nothing. */
export type ReconcileOutcome = "finished" | "released" | "unchanged";

/** Endings that never charge: Stripe saying a PaymentIntent of theirs succeeded is money moved late (OQ-12). */
const NOT_CHARGED: ReadonlySet<LicenseRequestStatus> = new Set([
  "declined",
  "expired",
  "capture_failed",
  "abandoned",
]);

/**
 * Reads the request's PaymentIntent and makes the row agree with it (07 D25): after every non-ok capture or cancel, for
 * stuck claims, and for payment_intent.succeeded. `succeeded` on a waiting request → T5 (finishCapture), whatever was
 * claimed; on an ending that never charges → audit `license_request.money_moved_late`, nothing else (OQ-12); on an
 * approved request → nothing (P19b hooks the transfer here). `canceled` on a waiting request → the claimed action's
 * ending (finishCanceled). `requires_capture` → the caller's own `claim` is released (the caller says retry), unless
 * its capture failed for good (`captureOutcome` permanent): then T7 cancels the hold (cancelFailedCapture). A claim the
 * caller doesn't hold is left alone. A retrieve that throws throws: the claim stays for the next reconcile, and a
 * webhook delivery fails, so Stripe sends it again. Requests without a PaymentIntent are left as they are.
 */
export async function reconcileFromStripe(
  requestId: string,
  opts: {
    actor?: Actor;
    claim?: PaymentClaim | null;
    captureOutcome?: StripeCallOutcome;
  } = {},
): Promise<ReconcileOutcome> {
  const actor = opts.actor ?? LAZY;
  const [row] = await db
    .select()
    .from(licenseRequest)
    .where(eq(licenseRequest.id, requestId));
  if (!row) throw new Error("reconcileFromStripe: unknown request");
  const known = row.status === "awaiting_approval" || row.status === "approved";
  if (!row.stripePaymentIntentId || !(known || NOT_CHARGED.has(row.status))) {
    return "unchanged";
  }
  const pi = await getAuthorization(row.currency, row.stripePaymentIntentId);
  const waiting = row.status === "awaiting_approval";
  const claim = claimOf(row);
  switch (pi.status) {
    case "succeeded":
      if (waiting) {
        const done = await finishCapture(requestId, { claim, actor });
        return done ? "finished" : "unchanged";
      }
      if (NOT_CHARGED.has(row.status)) {
        await writeAudit(db, actor, {
          action: "license_request.money_moved_late",
          entityType: "license_request",
          entityId: requestId,
          data: { piStatus: pi.status, status: row.status },
        });
      }
      return "unchanged";
    case "canceled":
      if (!waiting) return "unchanged";
      return (await finishCanceled(requestId, { claim, actor })) !== null
        ? "finished"
        : "unchanged";
    case "requires_capture": {
      if (!waiting || !claim || !sameClaim(claim, opts.claim)) {
        return "unchanged";
      }
      const failed = opts.captureOutcome;
      if (
        claim.action === "capture" &&
        failed &&
        !failed.ok &&
        failed.kind === "permanent"
      ) {
        return cancelFailedCapture(row, row.stripePaymentIntentId, {
          claim,
          code: failed.code,
          actor,
        });
      }
      return (await releaseClaim(requestId, claim)) ? "released" : "unchanged";
    }
    default:
      return "unchanged";
  }
}

/**
 * T7 (03 §5.1; 07 D25, D30): Stripe refused the capture for good while the card is still held. The capture claim is
 * taken again (its own key), the hold canceled, and the request fails with the error's code. A cancel that isn't ok
 * leaves the new claim for the stuck-claim reconcile, so nothing says "not charged" before Stripe releases the hold.
 */
async function cancelFailedCapture(
  row: LicenseRequest,
  paymentIntentId: string,
  { claim, code, actor }: { claim: PaymentClaim; code: string; actor: Actor },
): Promise<ReconcileOutcome> {
  const refenced = await refenceClaim(row.id, claim);
  if (!refenced) return "unchanged";
  const outcome = await cancel(
    row.currency,
    row.id,
    paymentIntentId,
    "capture_failed",
    refenced.stripeAttempt,
  );
  if (!outcome.ok) {
    // `stripeCode`, not `code`: log lines redact a `code` key (sign-in codes), and Stripe's error code is no secret.
    logEvent("warn", "license_request.capture_cancel_failed", {
      requestId: row.id,
      kind: outcome.kind,
      stripeCode: outcome.code,
    });
    return "unchanged";
  }
  const done = await finishCanceled(row.id, {
    claim: { action: "capture", claimedAt: refenced.paymentActionAt },
    actor,
    statusReason: captureErrorReason(code),
  });
  return done ? "finished" : "unchanged";
}

/** Locks waiting request `requestId` while `claim` (or no claim) holds it; false when another actor resolved it. */
async function lockHeld(
  tx: Tx,
  requestId: string,
  claim: PaymentClaim | null,
): Promise<boolean> {
  const [held] = await tx
    .select({ id: licenseRequest.id })
    .from(licenseRequest)
    .where(and(eq(licenseRequest.id, requestId), heldBy(claim)))
    .for("update");
  return held !== undefined;
}

/**
 * T5 (03 §5.1; 07 D33): Stripe captured the hold, so the waiting request becomes approved with its license, in one
 * transaction fenced on `claim` (or on no claim): the license starts at the capture claim's time (approved_at =
 * payment_action_at = starts_at), or now when the capture wasn't the app's; then license-approved is queued (its subject
 * names the code) and sent after the commit. Null when the fence finds the request resolved by another actor. A finish
 * that throws is audited `license_request.issue_failed` and rethrown. Every T5 goes through here: Approve,
 * reconcileFromStripe, and later auto-approve (P19c).
 */
export async function finishCapture(
  requestId: string,
  { claim, actor }: { claim: PaymentClaim | null; actor: Actor },
): Promise<{ licenseCode: string } | null> {
  const startsAt = claim?.action === "capture" ? claim.claimedAt : new Date();
  const finished = await db
    .transaction(async (tx) => {
      if (!(await lockHeld(tx, requestId, claim))) return null;
      const issued = await issueLicense(tx, requestId, startsAt, { actor });
      const result = await applyTransition(
        tx,
        requestId,
        "captured",
        { approvedAt: startsAt },
        actor,
      );
      if (!result.changed) throw new Error("finishCapture: no transition");
      const emailLogId = await queueEmail(tx, {
        template: "license-approved",
        entityType: "license_request",
        entityId: requestId,
        idempotencyKey: `license-approved/${requestId}`,
        to: result.row.buyerEmail,
        subject: licenseApprovedSubject(issued.code),
      });
      const effects: Effect[] = emailLogId
        ? [...result.effects, { kind: "email", emailLogId }]
        : result.effects;
      return { licenseCode: issued.code, effects };
    })
    .catch(async (error: unknown) => {
      // Stripe has the money and the license wasn't written: on record for an admin; the claim stays for reconcile.
      await writeAudit(db, actor, {
        action: "license_request.issue_failed",
        entityType: "license_request",
        entityId: requestId,
        data: { error: errorName(error) },
      });
      throw error;
    });
  if (!finished) return null;
  runEffects(finished.effects);
  return { licenseCode: finished.licenseCode };
}

/** The ending a canceled hold gives a waiting request, by its claim (03 T6, T8–T10): no claim means Stripe's own cancel. */
export function canceledEventFor(
  claim: PaymentClaim | null,
): "declined" | "capture_failed" | "expired" {
  switch (claim?.action) {
    case "decline":
      return "declined";
    case "capture":
      return "capture_failed";
    default:
      return "expired";
  }
}

/**
 * Stripe canceled the hold of a waiting request (03 T6–T10; 07 D25): the claimed action's ending, fenced on `claim`, in
 * one transaction, then its effects. A decline becomes declined (`statusReason`, else video_disabled when the video was
 * disabled, else creator); an expiry, expired (deadline); a capture, capture_failed (`statusReason`, else
 * pi_canceled_during_capture); no claim, expired (hold_released). Every ending of a waiting request that isn't an
 * approval goes through here, so later work hooks in once (P19g's audit, P22c's saved card). Null when another actor
 * resolved the request first.
 */
export async function finishCanceled(
  requestId: string,
  {
    claim,
    actor,
    statusReason,
  }: {
    claim: PaymentClaim | null;
    actor: Actor;
    statusReason?: DeclineReason | CaptureFailedReason;
  },
): Promise<TransitionResult | null> {
  const at = new Date();
  const event = canceledEventFor(claim);
  const result = await db.transaction(async (tx) => {
    // The patch before the request's lock: P19g's decline reason locks the video, and the video's lock comes first.
    const patch = await canceledPatch(tx, requestId, event, {
      claim,
      statusReason,
      at,
    });
    if (!(await lockHeld(tx, requestId, claim))) return null;
    return applyTransition(tx, requestId, event, patch, actor);
  });
  if (!result) return null;
  if (!result.changed) throw new Error("finishCanceled: no transition");
  runEffects(result.effects);
  return result;
}

/** A canceled hold's ending as a patch (07 §2.1, D28): when it ended, and the caller's reason, else the ending's own. */
async function canceledPatch(
  tx: Tx,
  requestId: string,
  event: ReturnType<typeof canceledEventFor>,
  {
    claim,
    statusReason,
    at,
  }: { claim: PaymentClaim | null; statusReason?: string; at: Date },
): Promise<Partial<LicenseRequestPatch>> {
  switch (event) {
    case "declined":
      return {
        declinedAt: at,
        statusReason: statusReason ?? (await declineReasonFor(tx, requestId)),
      };
    case "capture_failed":
      return {
        captureFailedAt: at,
        statusReason: statusReason ?? "pi_canceled_during_capture",
      };
    case "expired":
      return {
        expiredAt: at,
        statusReason: statusReason ?? (claim ? "deadline" : "hold_released"),
      };
  }
}

/** Why a decline claim ended (07 D28): the video was disabled meanwhile, or the creator declined. */
async function declineReasonFor(
  tx: Tx,
  requestId: string,
): Promise<"video_disabled" | "creator"> {
  const [row] = await tx
    .select({ status: video.status })
    .from(licenseRequest)
    .innerJoin(video, eq(video.id, licenseRequest.videoId))
    .where(eq(licenseRequest.id, requestId));
  return row?.status === "disabled" ? "video_disabled" : "creator";
}
