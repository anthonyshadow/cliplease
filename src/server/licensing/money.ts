import "server-only";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { creatorProfile, licenseRequest, moneyMovement } from "@/db/schema";
import type { MoneyMovementStatus, PayoutsStatus } from "@/lib/domain/values";
import { MINUTE_MS } from "@/lib/time";
import { type AuditEntry, writeAudit } from "../audit";
import { type Actor, LAZY } from "../auth/actor";
import { payoutsMayBeActive, refreshPayoutsStatus } from "../creators/profile";
import { errorName, logEvent } from "../log";
import { findTransfers, getAuthorization, transfer } from "../payments";
import { CREATOR_FIXABLE_TRANSFER_CODES } from "../payments/driver";

// Paying the creator (02 §5.7, §8.2 step 5; 03 §5.5; 07 D74–D77, D94, D95): the T5 transaction leaves one pending
// creator_transfer row, and sendCreatorTransfer sends it: claim, reconcile with findTransfers, the transfer call, a
// fenced finish. Never call PaymentsDriver inside db.transaction (07 D24, D75). A transfer never reads or writes
// license_request.status, its claim or the license: the buyer paid and the license stands whatever happens here. The
// amount is the row's, the license price, never the total. This module imports nothing from the licensing layer (the
// state machine imports it).

/** A claim older than this was dropped by its holder (07 D75). Every route that can send a transfer runs 60 s at most. */
const LEASE_MINUTES = 2;

/** A row a sweep tried this recently (a retried or failed transfer) waits before a sweep tries it again. */
const COOL_DOWN_MINUTES = 2;

/** The statuses a transfer can still be sent from. */
const SENDABLE: readonly MoneyMovementStatus[] = ["pending", "failed"];

/** Who a transfer runs as: always the system, named after what scheduled it (07 D47). */
export type TransferSource = Extract<Actor, { kind: "system" }>["source"];

export type TransferResult = "succeeded" | "skipped" | "retry" | "failed";

/** The transfer's source for work done as `actor`: a creator's Approve schedules it for the system to send. */
export function transferSourceOf(actor: Actor): TransferSource {
  return actor.kind === "system" ? actor.source : "lazy";
}

/**
 * Sends request `requestId`'s creator transfer (07 D75): 'succeeded' (sent now, or found already sent), 'skipped'
 * (nothing to send, payouts not active, or another claim holds it), 'retry' (Stripe couldn't be read or answered a
 * transient failure: nothing moved for sure, a later sweep tries again under a new key) or 'failed' (Stripe refused for
 * good, or a transfer that doesn't match the row exists: owner answer Q-151). Never throws for a payments read.
 * `source` names the audit actor (additive to 02 §5.7's signature).
 */
export async function sendCreatorTransfer(
  requestId: string,
  { source = "lazy" }: { source?: TransferSource } = {},
): Promise<TransferResult> {
  const actor: Actor = { kind: "system", source };
  const row = await transferRow(requestId);
  if (
    !row ||
    row.status === "succeeded" ||
    row.status === "canceled" ||
    isLive(row.claimedAt)
  ) {
    return "skipped";
  }
  let payouts: PayoutsStatus;
  try {
    payouts = await refreshPayoutsStatus(row.creatorId, {
      debitsActor: actor,
      row,
    });
  } catch (error) {
    logEvent("warn", "money_movement.payouts_read_failed", {
      requestId,
      error: errorName(error),
    });
    return "retry";
  }
  // A waiting transfer never blocks the license (owner answer OQ-05): it goes once payouts are on.
  const accountId = row.stripeAccountId;
  if (payouts !== "active" || !accountId) return "skipped";
  const chargeId = await chargeOf(row);
  if (!chargeId) return "retry";

  const claimedAt = new Date();
  const [claimed] = await db
    .update(moneyMovement)
    .set({
      attempt: sql`${moneyMovement.attempt} + 1`,
      claimedAt,
      updatedAt: claimedAt,
    })
    .where(
      and(
        eq(moneyMovement.id, row.id),
        eq(moneyMovement.kind, "creator_transfer"),
        inArray(moneyMovement.status, SENDABLE),
        unclaimed(),
      ),
    )
    .returning({
      attempt: moneyMovement.attempt,
      status: moneyMovement.status,
      lastError: moneyMovement.lastError,
    });
  if (!claimed) return "skipped";
  const claim: Claim = { id: row.id, claimedAt, ...claimed };

  // Reconcile first, so an earlier attempt that reached Stripe is never paid twice (03 I29).
  let found: Awaited<ReturnType<typeof findTransfers>>;
  try {
    found = await findTransfers(row.currency, requestId);
  } catch (error) {
    await releaseClaim(claim);
    logEvent("warn", "money_movement.transfer_lookup_failed", {
      requestId,
      error: errorName(error),
    });
    return "retry";
  }
  if (found.length > 0) {
    const [only] = found;
    const matches =
      found.length === 1 &&
      only !== undefined &&
      only.amountCents === row.amountCents &&
      only.destinationAccountId === accountId &&
      only.amountReversedCents === 0;
    return matches
      ? finishSucceeded(claim, row, actor, only.transferId, true)
      : finishFailed(claim, row, actor, "transfer_mismatch", {
          count: found.length,
        });
  }

  const outcome = await transfer(
    row.currency,
    requestId,
    chargeId,
    accountId,
    row.amountCents,
    claim.attempt,
  );
  if (outcome.ok) {
    return finishSucceeded(claim, row, actor, outcome.transferId, false);
  }
  if (outcome.kind === "transient") {
    // Maybe sent: the next claim reconciles before it calls again.
    await releaseClaim(claim);
    logEvent("warn", "money_movement.transfer_retry", {
      requestId,
      attempt: claim.attempt,
      stripeCode: outcome.code,
    });
    return "retry";
  }
  return finishFailed(claim, row, actor, outcome.code);
}

/**
 * Sends the creator transfers due now, one at a time, oldest first (02 §8.4; 03 §7.8, §7.10): returns how many ended
 * 'succeeded'. Without `creatorId` (the cron): pending rows older than `olderThanMinutes`, and failed rows whose code
 * the creator can fix (owner answer Q-148), of creators whose payouts may be active; a row that can't be paid now goes
 * behind the others, so it never holds the batch. With `creatorId` (Settings, the payouts return): all their pending and
 * failed rows of any age (no `olderThanMinutes`), except one tried in the last 2 minutes. A claim still held is skipped;
 * `stopAt` (epoch ms) starts no row after it; a row that fails is logged and the rest go on. Additive to 02 §5.7:
 * `actor`, `stopAt`.
 */
export async function sweepMoneyMovements(
  options: SweepScope & { limit: number; actor?: Actor; stopAt?: number },
): Promise<number> {
  const { limit, creatorId, actor = LAZY, stopAt } = options;
  const due = await db
    .select({
      id: moneyMovement.id,
      requestId: moneyMovement.licenseRequestId,
    })
    .from(moneyMovement)
    .innerJoin(
      licenseRequest,
      eq(licenseRequest.id, moneyMovement.licenseRequestId),
    )
    .innerJoin(creatorProfile, eq(creatorProfile.id, licenseRequest.creatorId))
    .where(
      and(
        eq(moneyMovement.kind, "creator_transfer"),
        unclaimed(),
        options.creatorId === undefined
          ? cronDue(options.olderThanMinutes)
          : creatorDue(options.creatorId),
      ),
    )
    .orderBy(asc(moneyMovement.updatedAt), asc(moneyMovement.id))
    .limit(limit);
  const source = transferSourceOf(actor);
  let paid = 0;
  for (const row of due) {
    const { requestId } = row;
    if (stopAt !== undefined && Date.now() >= stopAt) break;
    try {
      const result = await sendCreatorTransfer(requestId, { source });
      if (result === "succeeded") paid += 1;
      else if (!creatorId) await sendToBack(row.id);
    } catch (error) {
      logEvent("warn", "money_movement.sweep_failed", {
        requestId,
        error: errorName(error),
      });
    }
  }
  return paid;
}

/** What the creator's failed transfers add up to, in their payout currency (I33: one currency per creator); 0 for none. */
export async function failedTransferTotalCents(
  creatorId: string,
): Promise<number> {
  const [row] = await db
    .select({
      total:
        sql<number>`coalesce(sum(${moneyMovement.amountCents}), 0)`.mapWith(
          Number,
        ),
    })
    .from(moneyMovement)
    .innerJoin(
      licenseRequest,
      eq(licenseRequest.id, moneyMovement.licenseRequestId),
    )
    .where(
      and(
        eq(licenseRequest.creatorId, creatorId),
        eq(moneyMovement.kind, "creator_transfer"),
        eq(moneyMovement.status, "failed"),
      ),
    );
  return row?.total ?? 0;
}

/** The cron's rows, older than `olderThanMinutes`, or one creator's of any age. */
type SweepScope =
  | { olderThanMinutes: number; creatorId?: undefined }
  | { creatorId: string; olderThanMinutes?: undefined };

type TransferRow = NonNullable<Awaited<ReturnType<typeof transferRow>>>;

/**
 * This call's claim on the movement: its fence (`claimedAt`, a JS Date), the attempt its key carries, and the row's
 * status and last error as the claim found them (no one else changes them while it holds).
 */
type Claim = {
  id: string;
  claimedAt: Date;
  attempt: number;
  status: MoneyMovementStatus;
  lastError: string | null;
};

/** The request's creator_transfer row, with what sending it needs from the request and the creator (its payouts row). */
async function transferRow(requestId: string) {
  const [row] = await db
    .select({
      id: moneyMovement.id,
      requestId: moneyMovement.licenseRequestId,
      status: moneyMovement.status,
      currency: moneyMovement.currency,
      amountCents: moneyMovement.amountCents,
      claimedAt: moneyMovement.claimedAt,
      creatorId: licenseRequest.creatorId,
      paymentIntentId: licenseRequest.stripePaymentIntentId,
      chargeId: licenseRequest.stripeChargeId,
      stripeAccountId: creatorProfile.stripeAccountId,
      payoutsStatus: creatorProfile.payoutsStatus,
      payoutsStatusSyncedAt: creatorProfile.payoutsStatusSyncedAt,
      payoutCurrency: creatorProfile.payoutCurrency,
      negativeBalanceDebitsEnabledAt:
        creatorProfile.negativeBalanceDebitsEnabledAt,
    })
    .from(moneyMovement)
    .innerJoin(
      licenseRequest,
      eq(licenseRequest.id, moneyMovement.licenseRequestId),
    )
    .innerJoin(creatorProfile, eq(creatorProfile.id, licenseRequest.creatorId))
    .where(
      and(
        eq(moneyMovement.licenseRequestId, requestId),
        eq(moneyMovement.kind, "creator_transfer"),
      ),
    );
  return row ?? null;
}

/** The charge the transfer draws on (its source_transaction): stored at T2, else read from the PaymentIntent. */
async function chargeOf(row: TransferRow): Promise<string | null> {
  if (row.chargeId) return row.chargeId;
  if (!row.paymentIntentId) return null;
  try {
    return (await getAuthorization(row.currency, row.paymentIntentId)).chargeId;
  } catch (error) {
    logEvent("warn", "money_movement.charge_read_failed", {
      requestId: row.requestId,
      error: errorName(error),
    });
    return null;
  }
}

const leaseCutoff = () => new Date(Date.now() - LEASE_MINUTES * MINUTE_MS);

/** A claim taken less than the lease ago: its holder may still be sending. */
const isLive = (claimedAt: Date | null) =>
  claimedAt !== null && claimedAt >= leaseCutoff();

/** No claim, or one its holder dropped; the cutoff on the claim's own (JS) clock. */
const unclaimed = () =>
  or(
    isNull(moneyMovement.claimedAt),
    lt(moneyMovement.claimedAt, leaseCutoff()),
  );

/** `minutes` before now on the database's clock (the updated_at cut-offs). */
const minutesAgo = (minutes: number) =>
  sql`now() - make_interval(mins => ${minutes}::int)`;

/** The cron's rows (owner answer Q-148). */
function cronDue(olderThanMinutes: number) {
  return and(
    payoutsMayBeActive(),
    or(
      and(
        eq(moneyMovement.status, "pending"),
        lt(moneyMovement.updatedAt, minutesAgo(olderThanMinutes)),
      ),
      and(
        eq(moneyMovement.status, "failed"),
        inArray(moneyMovement.lastError, CREATOR_FIXABLE_TRANSFER_CODES),
        lt(moneyMovement.updatedAt, minutesAgo(COOL_DOWN_MINUTES)),
      ),
    ),
  );
}

/** One creator's rows (03 §7.8): a crashed transfer (attempt 0) at once, a tried one after the cool-down. */
function creatorDue(creatorId: string) {
  return and(
    eq(licenseRequest.creatorId, creatorId),
    inArray(moneyMovement.status, SENDABLE),
    or(
      eq(moneyMovement.attempt, 0),
      lt(moneyMovement.updatedAt, minutesAgo(COOL_DOWN_MINUTES)),
    ),
  );
}

/**
 * A cron row that couldn't be paid now (payouts off or unreadable, no charge yet, a retry) goes behind the others, so it
 * never holds the batch ahead of rows that can be paid. Only while it still waits unclaimed: never under a live claim.
 */
async function sendToBack(id: string): Promise<void> {
  await db
    .update(moneyMovement)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(moneyMovement.id, id),
        inArray(moneyMovement.status, SENDABLE),
        unclaimed(),
      ),
    );
}

/** Lets the claim go after a call that may not have reached Stripe: fenced, so a newer claim keeps its own. */
async function releaseClaim(claim: Claim): Promise<void> {
  await db.update(moneyMovement).set({ claimedAt: null }).where(fence(claim));
}

function fence(claim: Claim) {
  return and(
    eq(moneyMovement.id, claim.id),
    eq(moneyMovement.kind, "creator_transfer"),
    eq(moneyMovement.claimedAt, claim.claimedAt),
  );
}

/** Sent (or found sent): the row records the transfer, with the owner's success audit (Q-145). */
async function finishSucceeded(
  claim: Claim,
  row: TransferRow,
  actor: Actor,
  transferId: string,
  reconciled: boolean,
): Promise<TransferResult> {
  const done = await finish(
    claim,
    {
      status: "succeeded",
      stripeObjectId: transferId,
      succeededAt: new Date(),
      lastError: null,
    },
    actor,
    audit(claim, row, "license_request.transfer_succeeded", {
      transferId,
      reconciled,
    }),
  );
  if (done) return "succeeded";
  logEvent("warn", "money_movement.finish_lost", {
    requestId: row.requestId,
  });
  return "skipped";
}

/**
 * Refused for good: the row fails with the code, for the creator's Banner and the admin. The audit is written once per
 * failure, not on every retry that fails the same way.
 */
async function finishFailed(
  claim: Claim,
  row: TransferRow,
  actor: Actor,
  code: string,
  extra: Record<string, unknown> = {},
): Promise<TransferResult> {
  const repeated = claim.status === "failed" && claim.lastError === code;
  const done = await finish(
    claim,
    { status: "failed", lastError: code },
    actor,
    repeated
      ? null
      : audit(claim, row, "license_request.transfer_failed", {
          code,
          ...extra,
        }),
  );
  return done ? "failed" : "skipped";
}

/** The audit row of a transfer's ending, on its request: `data` with the attempt and the amount, no account ids. */
function audit(
  claim: Claim,
  row: TransferRow,
  action: string,
  data: Record<string, unknown>,
): AuditEntry {
  return {
    action,
    entityType: "license_request",
    entityId: row.requestId,
    data: {
      ...data,
      attempt: claim.attempt,
      amountCents: row.amountCents,
      currency: row.currency,
    },
  };
}

/**
 * The fenced finish (03 §5.5): the row's ending, which lets the claim go, and its audit in one short transaction, the
 * audit only when the fence held, so two racing senders never both record one. No payments call in here. True when this
 * claim still held the row.
 */
async function finish(
  claim: Claim,
  patch: {
    status: MoneyMovementStatus;
    lastError: string | null;
    stripeObjectId?: string;
    succeededAt?: Date;
  },
  actor: Actor,
  entry: AuditEntry | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(moneyMovement)
      .set({ ...patch, claimedAt: null })
      .where(fence(claim))
      .returning({ id: moneyMovement.id });
    if (!updated) return false;
    if (entry) await writeAudit(tx, actor, entry);
    return true;
  });
}
