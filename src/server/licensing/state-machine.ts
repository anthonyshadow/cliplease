import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { licenseRequest } from "@/db/schema";
import type { LicenseRequest, NewLicenseRequest } from "@/db/schema/types";
import type { LicenseRequestStatus } from "@/lib/domain/values";
import {
  type LicenseRequestEvent,
  nextStatus,
} from "@/lib/licensing/transitions";
import { type AuditEntry, writeAudit } from "../audit";
import type { Actor } from "../auth/actor";

// The license request state machine (02 §5.7; 03 §5.1; 07 §2.2, D47): the only writer of license_request.status.
// Never call PaymentsDriver inside db.transaction (07 D24): callers decide, commit, then call out.

/** Work a transition queues for after its commit. P17 adds the email outbox; until then none. */
export type Effect = { kind: "email"; emailLogId: string };

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
  | "statusReason"
> & { incrementStripeAttempt: boolean };

/** Why `patch` can't go with `event` (03 T2, T3, T11), or null. Events P18 and P19 bring check their own fields. */
function patchProblem(
  event: LicenseRequestEvent,
  patch: Partial<LicenseRequestPatch>,
): string | null {
  switch (event) {
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
    default:
      return null;
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
  return { changed: true, from, to, effects: [], row };
}
