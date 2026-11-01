import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { license, licenseRequest, video } from "@/db/schema";
import type { ApproveResult } from "@/lib/licensing/request-dto";
import { type Actor, LAZY } from "../auth/actor";
import { type PayoutsRow, refreshPayoutsStatus } from "../creators/profile";
import { errorName, logEvent } from "../log";
import { capture } from "../payments";
import { overdueColumn } from "./deadline";
import { afterResponse } from "./effects";
import { expireLicenseRequest } from "./requests";
import {
  autoApproveOpen,
  type ClaimedRequest,
  claimPaymentAction,
  finishCapture,
  reconcileFromStripe,
  reconcileIfStuck,
} from "./state-machine";

// Approve (02 §8.2; 03 T4–T6; 07 D24–D26, D29, D33, D74, D77): one tap claims the request, captures the hold outside any
// transaction under the claim's key, and the fenced T5 finish issues the license. Never "not charged" while money may
// have moved: a request whose capture outcome is unknown reads as claimed ("Processing…") until it is reconciled.
// Auto-approve (P19c; 07 D81) approves as the system actor through the same path. The video lock and availability check
// (07 D110) arrive with P19f and P19g (owner answer Q-122 a).

/**
 * Whose requests `actor` may approve (02 §8.2; 03 T4): a creator their own; the auto-approve system actor only an
 * auto_approve request that hasn't fallen back (07 D81), which its claim checks again. Null for anyone else: nothing
 * about the request is told.
 */
type ApproveScope = { creatorId: string } | { autoApproveOpen: true };

function approveScope(actor: Actor): ApproveScope | null {
  if (actor.kind === "creator") return { creatorId: actor.creatorId };
  return actor.kind === "system" && actor.source === "auto_approve"
    ? { autoApproveOpen: true }
    : null;
}

/** Approve's view of a request in `scope`: null when it is out of it. */
async function approveState(requestId: string, scope: ApproveScope) {
  const [row] = await db
    .select({
      creatorId: licenseRequest.creatorId,
      status: licenseRequest.status,
      paymentAction: licenseRequest.paymentAction,
      paymentActionAt: licenseRequest.paymentActionAt,
      overdue: overdueColumn,
      originalStatus: video.originalStatus,
      licenseCode: license.code,
    })
    .from(licenseRequest)
    .innerJoin(video, eq(video.id, licenseRequest.videoId))
    .leftJoin(license, eq(license.licenseRequestId, licenseRequest.id))
    .where(
      and(
        eq(licenseRequest.id, requestId),
        "creatorId" in scope
          ? eq(licenseRequest.creatorId, scope.creatorId)
          : autoApproveOpen,
      ),
    );
  return row ?? null;
}

type ApproveState = NonNullable<Awaited<ReturnType<typeof approveState>>>;

/**
 * A request this tap can't act on: decided or claimed by another tab or actor (not_actionable with its status, J8.8;
 * Processing… while claimed), or past its deadline. Only the tap whose claim captured reports ok.
 */
function refusedResult(s: ApproveState): ApproveResult | null {
  if (s.status !== "awaiting_approval" || s.paymentAction) {
    return { ok: false, reason: "not_actionable", status: s.status };
  }
  if (s.overdue) return { ok: false, reason: "expired", status: s.status };
  return null;
}

/**
 * Approves waiting request `requestId` for its creator (02 §8.2): a stuck claim reconciled first; then the request must
 * be unclaimed and before its deadline, the video's original ready (07 D33) and payouts active (07 D29, D74, D77; the
 * reading at most 10 minutes old), else nothing is claimed. A refused claim reports the request as it is. A capture
 * that isn't ok goes to reconcileFromStripe, and the result follows Stripe: approved, a released claim (retry), or
 * capture_failed (T7 cancels the hold first). A tap past the deadline schedules the expiry it found due (02 §8.4), as
 * the system's work after the response. `actor`: the request's creator, or the auto-approve system actor on an
 * auto_approve request that hasn't fallen back (approveScope). `payoutsRow`: the caller's creator context, read with the
 * session.
 */
export async function approveLicenseRequest(
  requestId: string,
  actor: Actor,
  options: { payoutsRow?: PayoutsRow } = {},
): Promise<ApproveResult> {
  const result = await approve(requestId, actor, options);
  if (!result.ok && result.reason === "expired") {
    afterResponse(() => expireLicenseRequest(requestId, LAZY));
  }
  return result;
}

async function approve(
  requestId: string,
  actor: Actor,
  { payoutsRow }: { payoutsRow?: PayoutsRow },
): Promise<ApproveResult> {
  const scope = approveScope(actor);
  let before = scope && (await approveState(requestId, scope));
  if (!scope || !before) {
    return { ok: false, reason: "not_actionable", status: null };
  }
  // Later reads follow the request's creator: a fallback committed meanwhile still reports the request as it is.
  const { creatorId } = before;
  if (await reconcileIfStuck(requestId, before, actor)) {
    before = await stateOf(requestId, creatorId);
  }
  const refused = refusedResult(before);
  if (refused) return refused;
  if (before.originalStatus !== "ready") {
    return {
      ok: false,
      reason: "original_missing",
      status: "awaiting_approval",
    };
  }
  let payouts: Awaited<ReturnType<typeof refreshPayoutsStatus>>;
  try {
    payouts = await refreshPayoutsStatus(creatorId, { row: payoutsRow });
  } catch (error) {
    // Nothing is claimed: the creator can tap again.
    logEvent("warn", "license_request.payouts_read_failed", {
      requestId,
      error: errorName(error),
    });
    return { ok: false, reason: "retry", status: "awaiting_approval" };
  }
  if (payouts !== "active") {
    return {
      ok: false,
      reason: "payouts_not_active",
      status: "awaiting_approval",
    };
  }
  const claimed = await claimPaymentAction(requestId, "capture", {
    autoApproveOnly: "autoApproveOpen" in scope,
  });
  if (!claimed) {
    const now = await stateOf(requestId, creatorId);
    return (
      refusedResult(now) ?? {
        ok: false,
        reason: "not_actionable",
        status: now.status,
      }
    );
  }
  return captureClaimed(claimed, actor);
}

/** Approve's state after a step that may have changed it; the request was the creator's a moment ago. */
async function stateOf(
  requestId: string,
  creatorId: string,
): Promise<ApproveState> {
  const state = await approveState(requestId, { creatorId });
  if (!state) throw new Error("approveLicenseRequest: the request is gone");
  return state;
}

/** The claimed capture and its finish, or Stripe's word when the capture isn't ok (07 D25). */
async function captureClaimed(
  claimed: ClaimedRequest,
  actor: Actor,
): Promise<ApproveResult> {
  const { id, creatorId, stripePaymentIntentId } = claimed;
  if (!stripePaymentIntentId) {
    throw new Error("approveLicenseRequest: a waiting request without a hold");
  }
  const claim = {
    action: claimed.paymentAction,
    claimedAt: claimed.paymentActionAt,
  };
  const outcome = await capture(
    claimed.currency,
    id,
    stripePaymentIntentId,
    claimed.stripeAttempt,
  );
  if (outcome.ok) {
    try {
      const done = await finishCapture(id, { claim, actor });
      if (done) return { ok: true, licenseCode: done.licenseCode };
    } catch (error) {
      // Captured, but the license wasn't written: the claim stays, and the stuck-claim reconcile issues it.
      logEvent("error", "license_request.finish_failed", {
        requestId: id,
        error: errorName(error),
      });
      return {
        ok: false,
        reason: "not_actionable",
        status: "awaiting_approval",
      };
    }
  }
  try {
    await reconcileFromStripe(
      id,
      outcome.ok
        ? { actor, claim: null }
        : { actor, claim, captureOutcome: outcome },
    );
  } catch (error) {
    // Stripe can't be asked now: the claim stays for the next reconcile.
    logEvent("warn", "license_request.reconcile_failed", {
      requestId: id,
      error: errorName(error),
    });
  }
  const after = await stateOf(id, creatorId);
  if (after.status === "approved" && after.licenseCode) {
    return { ok: true, licenseCode: after.licenseCode };
  }
  if (after.status === "capture_failed") {
    return { ok: false, reason: "capture_failed", status: after.status };
  }
  // A released claim after a failed capture: nothing moved, try again. After an ok capture, never: it reads as claimed.
  const unclaimed =
    after.status === "awaiting_approval" && !after.paymentAction;
  return unclaimed && !outcome.ok
    ? { ok: false, reason: "retry", status: after.status }
    : { ok: false, reason: "not_actionable", status: after.status };
}
