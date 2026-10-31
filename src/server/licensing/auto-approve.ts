import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { licenseRequest, video } from "@/db/schema";
import { writeAudit } from "../audit";
import { AUTO_APPROVE } from "../auth/actor";
import { refreshPayoutsStatus } from "../creators/profile";
import { errorName, logEvent } from "../log";
import { getAuthorization } from "../payments";
import { approveLicenseRequest } from "./approve";
import { runEffects } from "./effects";
import { queueRequestEmails, reconcileFromStripe } from "./state-machine";

// Auto-approve (07 D81; 03 T4, §7.10; research/stripe-owner-answers.md §5 option A): every Checkout still holds the card,
// and once an auto_approve request is authorized its approval runs after the response, as the system actor through
// Approve's own path (capture, license, license-approved, the creator transfer). Guards first (payouts active, the
// original ready, a normal risk level); a guard that fails, or a retry still failing 10 minutes after authorization,
// hands the request to the creator: auto_approve_fallback_at, request-new and an audit row in one transaction. Never a
// payments call inside a transaction. requests.ts imports this file (markAuthorized schedules autoApproveRequest) and
// this file imports approve.ts, which imports requests.ts: the licensing layer's one runtime cycle. Nothing here runs at
// load but the constants, so it is safe; never import it dynamically.

/** A request still not approved this long after authorization falls back to the creator (07 §7.2). */
export const AUTO_APPROVE_GIVE_UP_MINUTES = 10;

/** The T2 run's head start: a retry takes a request only once it was authorized this long ago (03 §7.10). */
const RETRY_AFTER_MINUTES = 2;

export type AutoApproveOutcome = "approved" | "fallback" | "retry" | "skipped";

/** Why a request fell back to the creator: the audit's `reason`. */
type FallbackReason =
  | "payouts_not_active"
  | "original_missing"
  | "risk_not_normal"
  | "gave_up";

/** authorized_at at least AUTO_APPROVE_GIVE_UP_MINUTES ago, on the database's clock (false without one). */
const pastGiveUp = sql<boolean>`coalesce(${licenseRequest.authorizedAt} <= now() - make_interval(mins => ${AUTO_APPROVE_GIVE_UP_MINUTES}::int), false)`;

/**
 * Approves auto_approve request `requestId` (07 D81), the run markAuthorized schedules after T2: 'approved', 'fallback'
 * (handed to the creator), 'retry' (nothing decided; a later retry tries again) or 'skipped' (not a waiting auto request
 * any more, or another actor's to finish). It tries once whatever the request's age. Never throws.
 */
export async function autoApproveRequest(
  requestId: string,
): Promise<AutoApproveOutcome> {
  return settle(requestId, { giveUpFirst: false });
}

/**
 * Retries the auto-approvals that didn't finish (03 §7.10; 07 D81; owner answers Q-154, Q-156), oldest authorization
 * first: one request (/r), one creator's (the Inbox, the request page) or up to `limit` (the cron). Only waiting auto
 * requests with no fallback, no claim, authorized at least 2 minutes ago and before their deadline (the expiry handles
 * an overdue one, so they can't fill the batch). A request reached 10 minutes or more after authorization falls back with
 * gave_up, with no guard and no Stripe call. No request starts at or after `stopAt` (epoch ms). Returns how many were
 * approved or fell back: a retry doesn't count, so the cron doesn't spin on it.
 */
export async function retryAutoApprovals({
  limit,
  creatorId,
  requestId,
  stopAt,
}: {
  limit: number;
  creatorId?: string;
  requestId?: string;
  stopAt?: number;
}): Promise<number> {
  const due = await db
    .select({ id: licenseRequest.id })
    .from(licenseRequest)
    .where(
      and(
        requestId ? eq(licenseRequest.id, requestId) : undefined,
        creatorId ? eq(licenseRequest.creatorId, creatorId) : undefined,
        eq(licenseRequest.status, "awaiting_approval"),
        eq(licenseRequest.autoApprove, true),
        isNull(licenseRequest.autoApproveFallbackAt),
        isNull(licenseRequest.paymentAction),
        sql`${licenseRequest.authorizedAt} < now() - make_interval(mins => ${RETRY_AFTER_MINUTES}::int)`,
        sql`now() < ${licenseRequest.expiresAt}`,
      ),
    )
    .orderBy(asc(licenseRequest.authorizedAt), asc(licenseRequest.id))
    .limit(limit);
  let settled = 0;
  for (const row of due) {
    if (stopAt !== undefined && Date.now() >= stopAt) break;
    const outcome = await settle(row.id, { giveUpFirst: true });
    if (outcome === "approved" || outcome === "fallback") settled += 1;
  }
  return settled;
}

/**
 * One request's automatic approval (prompt steps 1–4). `giveUpFirst`, for a retry (owner answer Q-154): a request reached
 * 10 minutes or more after authorization falls back with gave_up, no guard, no Stripe call. A retry, returned or thrown,
 * gives up once the attempt ends 10 minutes or more after authorization, read on the database's clock as it is then.
 */
async function settle(
  requestId: string,
  { giveUpFirst }: { giveUpFirst: boolean },
): Promise<AutoApproveOutcome> {
  try {
    const state = await autoState(requestId);
    if (!state?.eligible) return "skipped";
    if (giveUpFirst && state.pastGiveUp) {
      return await fallBack(requestId, "gave_up");
    }
    const outcome = await attempt(requestId, state).catch((error: unknown) => {
      logFailure(requestId, error);
      return "retry" as const;
    });
    if (outcome !== "retry") return outcome;
    return (await pastGiveUpNow(requestId))
      ? await fallBack(requestId, "gave_up")
      : "retry";
  } catch (error) {
    logFailure(requestId, error);
    return "retry";
  }
}

/** What settle needs to know before its guards: whether the request still waits for its automatic approval. */
async function autoState(requestId: string) {
  const [row] = await db
    .select({
      creatorId: licenseRequest.creatorId,
      currency: licenseRequest.currency,
      paymentIntentId: licenseRequest.stripePaymentIntentId,
      originalStatus: video.originalStatus,
      eligible: sql<boolean>`coalesce(${licenseRequest.status} = 'awaiting_approval' and ${licenseRequest.autoApprove} and ${licenseRequest.autoApproveFallbackAt} is null and ${licenseRequest.paymentAction} is null and now() < ${licenseRequest.expiresAt}, false)`,
      pastGiveUp,
    })
    .from(licenseRequest)
    .innerJoin(video, eq(video.id, licenseRequest.videoId))
    .where(eq(licenseRequest.id, requestId));
  return row ?? null;
}

type AutoState = NonNullable<Awaited<ReturnType<typeof autoState>>>;

/** Step 4's clock: whether the request was authorized 10 minutes or more ago, read now. */
async function pastGiveUpNow(requestId: string): Promise<boolean> {
  const [row] = await db
    .select({ pastGiveUp })
    .from(licenseRequest)
    .where(eq(licenseRequest.id, requestId));
  return row?.pastGiveUp ?? false;
}

/**
 * The guards, each outside any transaction, then Approve as the system actor. A hold no longer waiting for capture is
 * reconciled (captured elsewhere: finished; canceled: its ending) and skipped. Throws what a read throws.
 */
async function attempt(
  requestId: string,
  state: AutoState,
): Promise<AutoApproveOutcome> {
  const payouts = await refreshPayoutsStatus(state.creatorId, {
    debitsActor: AUTO_APPROVE,
  });
  if (payouts !== "active") return fallBack(requestId, "payouts_not_active");
  if (state.originalStatus !== "ready") {
    return fallBack(requestId, "original_missing");
  }
  if (!state.paymentIntentId) {
    throw new Error("autoApproveRequest: a waiting request without a hold");
  }
  const auth = await getAuthorization(state.currency, state.paymentIntentId);
  if (auth.status !== "requires_capture") {
    await reconcileFromStripe(requestId, { actor: AUTO_APPROVE });
    return "skipped";
  }
  // null, elevated, highest, not_assessed and unknown are not normal (research §5).
  if (auth.riskLevel !== "normal") {
    return fallBack(requestId, "risk_not_normal");
  }
  const result = await approveLicenseRequest(requestId, AUTO_APPROVE);
  if (result.ok) return "approved";
  switch (result.reason) {
    case "retry":
      return "retry";
    case "payouts_not_active":
    case "original_missing":
      return fallBack(requestId, result.reason);
    case "not_actionable":
    case "expired":
    case "capture_failed":
      // A held claim (an ok capture whose finish failed) is the stuck-claim reconcile's to finish; capture_failed is
      // T7's ending, which emails nobody in CORE (07 D34).
      return "skipped";
    default: {
      const unknown: never = result.reason;
      throw new Error(`autoApproveRequest: ${String(unknown)}`);
    }
  }
}

/**
 * Hands the request to the creator (07 D81), in one short transaction: auto_approve_fallback_at, request-new with the
 * fallback line, and the audit with its reason. Not a transition: the status stays awaiting_approval, and the state
 * machine still owns it. Only a waiting auto request with no fallback, no claim and time left: else 'skipped'.
 */
async function fallBack(
  requestId: string,
  reason: FallbackReason,
): Promise<AutoApproveOutcome> {
  const effects = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(licenseRequest)
      .set({ autoApproveFallbackAt: sql`now()` })
      .where(
        and(
          eq(licenseRequest.id, requestId),
          eq(licenseRequest.status, "awaiting_approval"),
          eq(licenseRequest.autoApprove, true),
          isNull(licenseRequest.autoApproveFallbackAt),
          isNull(licenseRequest.paymentAction),
          sql`now() < ${licenseRequest.expiresAt}`,
        ),
      )
      .returning({ id: licenseRequest.id });
    if (!row) return null;
    const queued = await queueRequestEmails(tx, requestId, ["request-new"]);
    await writeAudit(tx, AUTO_APPROVE, {
      action: "license_request.auto_approve_fallback",
      entityType: "license_request",
      entityId: requestId,
      data: { reason },
    });
    return queued;
  });
  if (!effects) return "skipped";
  runEffects(effects);
  return "fallback";
}

function logFailure(requestId: string, error: unknown): void {
  logEvent("warn", "license_request.auto_approve_failed", {
    requestId,
    error: errorName(error),
  });
}
