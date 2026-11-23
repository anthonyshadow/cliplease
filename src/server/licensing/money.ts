import "server-only";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { alias, type BuildAliasTable } from "drizzle-orm/pg-core";
import { db, type Tx } from "@/db/client";
import {
  creatorProfile,
  license,
  licenseRequest,
  moneyMovement,
} from "@/db/schema";
import type {
  Currency,
  MoneyMovementKind,
  MoneyMovementStatus,
  PayoutsStatus,
} from "@/lib/domain/values";
import { MINUTE_MS } from "@/lib/time";
import { isUuid } from "@/lib/validation/uuid";
import { type AuditEntry, writeAudit } from "../audit";
import { type Actor, LAZY, requireAdminActor } from "../auth/actor";
import { payoutsMayBeActive, refreshPayoutsStatus } from "../creators/profile";
import { errorName, logEvent } from "../log";
import {
  findTransfers,
  getAuthorization,
  refund,
  reverseTransfer,
  transfer,
} from "../payments";
import {
  CREATOR_FIXABLE_TRANSFER_CODES,
  type FoundTransfer,
  type MoneyCallFailure,
} from "../payments/driver";

// Paying the creator and giving money back (02 §5.7, §8.2 step 5; 03 §5.5; 07 D74–D77, D86, D94, D95). The T5
// transaction leaves one pending creator_transfer row, which sendCreatorTransfer sends; an admin revoke (issue.ts) leaves
// a pending buyer_refund and, whenever money may be with the creator, a pending transfer_reversal (owner answer Q-210),
// which refundRevokedLicense gives back.
// Every step is a claim, a reconcile with Stripe, one driver call keyed by the claim's attempt, then a fenced finish; no
// PaymentsDriver call ever runs inside a database transaction (07 D24, D75). No step reads or writes
// license_request.status, its claim or the license: the buyer paid and the license stands (or stays revoked) whatever
// happens here. A transfer's amount is the row's (the license price), a refund's the row's (the request's total). This
// module imports nothing from the licensing layer (the state machine and issue.ts import it).

/** A claim older than this was dropped by its holder (07 D75). Every route that can send a transfer runs 60 s at most. */
const LEASE_MINUTES = 2;

/** A row a sweep tried this recently (a retried or failed transfer) waits before a sweep tries it again. */
const COOL_DOWN_MINUTES = 2;

/** The statuses a transfer can still be sent from, and an admin Retry claims any movement from. */
const SENDABLE: readonly MoneyMovementStatus[] = ["pending", "failed"];

/** What a refund's or a take-back's automatic run claims: a failed one waits for admin Retry (03 §7.10). */
const DUE: readonly MoneyMovementStatus[] = ["pending"];

/** The movements a revoke gives back (07 D86). */
type ReturnKind = Extract<
  MoneyMovementKind,
  "buyer_refund" | "transfer_reversal"
>;

const RETURN_KINDS: readonly ReturnKind[] = [
  "buyer_refund",
  "transfer_reversal",
];

/** The word a return's audits and log lines use: license.refund_failed, money_movement.reversal_retry. */
const STEP_OF = {
  buyer_refund: "refund",
  transfer_reversal: "reversal",
} as const satisfies Record<ReturnKind, string>;

/** Who a money step runs as: always the system, named after what scheduled it (07 D47). */
export type TransferSource = Extract<Actor, { kind: "system" }>["source"];

export type TransferResult = "succeeded" | "skipped" | "retry" | "failed";

/**
 * How a refund or take-back step, or an admin Retry, ended (07 D86): 'succeeded' (done now, or found done), 'failed'
 * (Stripe refused for good: `code`), 'transient' (Stripe couldn't be read or didn't answer: nothing moved for sure, the
 * claim is let go), 'in_progress' (another claim holds the movement) or 'noop' (nothing to do: done, canceled, none, or a
 * failed one an automatic run leaves to admin Retry).
 */
export type MoneyStepResult =
  | { outcome: "succeeded" }
  | { outcome: "failed"; code: string }
  | { outcome: "transient" }
  | { outcome: "in_progress" }
  | { outcome: "noop" };

/** What refundRevokedLicense did with the license's refund and its take-back, by each one's step word. */
type RevokedMoney = Record<(typeof STEP_OF)[ReturnKind], MoneyStepResult>;

/**
 * Why a send sent nothing now (sendCreatorTransfer's 'skipped'), which an admin Retry words: the row is gone, done or
 * canceled; another claim holds it (or took it over); or the creator's payouts aren't on (07 D77).
 */
type SendSkip = "gone" | "succeeded" | "canceled" | "held" | "payouts_off";

/** How a send ended: sendCreatorTransfer's TransferResult, with a failure's code and a skip's reason. */
type Sent =
  | { result: "succeeded" | "retry" }
  | { result: "failed"; code: string }
  | { result: "skipped"; why: SendSkip };

/** A Retry's code for a creator transfer that can't go yet: the creator's payouts aren't on (07 D77). */
export const PAYOUTS_NOT_ACTIVE = "payouts_not_active";

/** retryMoneyMovement's answer to an id that names no movement. */
export class MoneyMovementNotFoundError extends Error {
  constructor() {
    super("money_movement_not_found");
    this.name = "MoneyMovementNotFoundError";
  }
}

const SUCCEEDED: MoneyStepResult = { outcome: "succeeded" };
const TRANSIENT: MoneyStepResult = { outcome: "transient" };
const IN_PROGRESS: MoneyStepResult = { outcome: "in_progress" };
const NOOP: MoneyStepResult = { outcome: "noop" };

/** An admin Retry's answer to each reason a creator transfer's send skipped (owner answer Q-211). */
const RETRIED_SKIP: Record<SendSkip, MoneyStepResult> = {
  gone: NOOP,
  canceled: NOOP,
  succeeded: SUCCEEDED,
  held: IN_PROGRESS,
  payouts_off: { outcome: "failed", code: PAYOUTS_NOT_ACTIVE },
};

const SENT: Sent = { result: "succeeded" };
const RETRY: Sent = { result: "retry" };
const skipped = (why: SendSkip): Sent => ({ result: "skipped", why });
/** A refusal's finish as a send's end: a lost fence means another claim took the row over. */
const refusedSend = (finished: boolean, code: string): Sent =>
  finished ? { result: "failed", code } : skipped("held");

/** The transfer's source for work done as `actor`: a creator's Approve schedules it for the system to send. */
export function transferSourceOf(actor: Actor): TransferSource {
  return actor.kind === "system" ? actor.source : "lazy";
}

/**
 * Sends request `requestId`'s creator transfer (07 D75): 'succeeded' (sent now, or found already sent), 'skipped'
 * (nothing to send, payouts not active, or another claim holds it), 'retry' (Stripe couldn't be read or answered a
 * transient failure: nothing moved for sure, a later sweep tries again under a new key) or 'failed' (Stripe refused for
 * good, or a transfer that doesn't match the row exists: owner answer Q-151). A call that went through, or maybe did,
 * after a revoke canceled the row leaves a pending take-back (owner answer Q-210). Never throws for a payments read.
 * `source` names the audit actor (additive to 02 §5.7's signature).
 */
export async function sendCreatorTransfer(
  requestId: string,
  { source = "lazy" }: { source?: TransferSource } = {},
): Promise<TransferResult> {
  return (await send(requestId, source)).result;
}

/** sendCreatorTransfer, with why it skipped and what it failed with, for an admin Retry's words. */
async function send(requestId: string, source: TransferSource): Promise<Sent> {
  const actor: Actor = { kind: "system", source };
  const row = await transferRow(requestId);
  if (!row) return skipped("gone");
  if (row.status === "succeeded" || row.status === "canceled") {
    return skipped(row.status);
  }
  if (isLive(row.claimedAt)) return skipped("held");
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
    return RETRY;
  }
  // A waiting transfer never blocks the license (owner answer OQ-05): it goes once payouts are on.
  const accountId = row.stripeAccountId;
  if (payouts !== "active" || !accountId) return skipped("payouts_off");
  const chargeId = await chargeOf(row);
  if (!chargeId) return RETRY;

  const claim = await claimMovement(row.id, SENDABLE);
  if (!claim) return skipped("held");
  const ending = transferEnding(requestId);

  // Reconcile first, so an earlier attempt that reached Stripe is never paid twice (03 I29).
  let found: FoundTransfer[];
  try {
    found = await findTransfers(row.currency, requestId);
  } catch (error) {
    await releaseClaim(claim);
    logEvent("warn", "money_movement.transfer_lookup_failed", {
      requestId,
      error: errorName(error),
    });
    return RETRY;
  }
  if (found.length > 0) {
    const [only] = found;
    const matches =
      found.length === 1 &&
      only !== undefined &&
      only.amountCents === row.amountCents &&
      only.destinationAccountId === accountId &&
      only.amountReversedCents === 0;
    if (matches) {
      const done = await finishSucceeded(
        claim,
        ending,
        actor,
        only.transferId,
        true,
      );
      return done ? SENT : skipped("held");
    }
    const code = "transfer_mismatch";
    const failed = await finishFailed(claim, ending, actor, code, {
      count: found.length,
    });
    return refusedSend(failed, code);
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
    const done = await finishSucceeded(
      claim,
      ending,
      actor,
      outcome.transferId,
      false,
    );
    if (done) return SENT;
    return skipped((await owedLateTakeBack(claim)) ? "canceled" : "held");
  }
  if (outcome.kind === "transient") {
    // Maybe sent: the next claim reconciles before it calls again.
    if (!(await releaseClaim(claim))) await owedLateTakeBack(claim);
    logEvent("warn", "money_movement.transfer_retry", {
      requestId,
      attempt: claim.attempt,
      stripeCode: outcome.code,
    });
    return RETRY;
  }
  const failed = await finishFailed(claim, ending, actor, outcome.code);
  return refusedSend(failed, outcome.code);
}

/**
 * Gives a revoked license's money back (07 D75, D86; 03 §5.5): the refund step (its buyer_refund, the request's total),
 * then the reversal step (its transfer_reversal, the take-back of the creator's transfer), which runs whatever the
 * refund's outcome. The revoke wrote both rows (owner answer Q-210), read here with the license in one query, so a step
 * with no row has nothing to do. Each claims its pending row (a failed one waits for admin Retry), reconciles with
 * Stripe, makes at most one driver call keyed by the claim's attempt and finishes fenced. A license that isn't revoked,
 * or isn't known, gets nothing. A payments read or a step that throws answers transient, and the sweep tries that step
 * again. `source` names the audit actor, as sendCreatorTransfer's does.
 */
export async function refundRevokedLicense(
  licenseId: string,
  { source = "lazy" }: { source?: TransferSource } = {},
): Promise<RevokedMoney> {
  const actor: Actor = { kind: "system", source };
  const revoked = await revokedLicense(licenseId);
  if (!revoked) return { refund: NOOP, reversal: NOOP };
  const { subject, movements } = revoked;
  const step = (kind: ReturnKind) =>
    guarded(subject, kind, async () => {
      const row = movements[kind];
      return row ? returnStep(row, kind, subject, DUE, actor) : NOOP;
    });
  const refunded = await step("buyer_refund");
  const reversed = await step("transfer_reversal");
  return { refund: refunded, reversal: reversed };
}

/**
 * An admin's Retry of one movement (07 D75, D86; 02 §6.1 adminRetryMoneyMovement): a refund or a take-back is claimed
 * from pending or failed (the lease still holds) and its step runs again under attempt + 1, so a new key; a creator
 * transfer goes through sendCreatorTransfer's send, which claims it itself, its skip worded by why (a send payouts don't
 * allow yet answers failed with PAYOUTS_NOT_ACTIVE). A succeeded or canceled movement is a no-op; a live claim is in
 * progress. When a retry starts it writes `money_movement.retried { movementId, kind }` as the admin; the step's own
 * audits are the system's, as every send's. Throws MoneyMovementNotFoundError for an id that names no movement.
 */
export async function retryMoneyMovement(
  a: Actor,
  movementId: string,
): Promise<MoneyStepResult> {
  const admin = requireAdminActor(a);
  const row = isUuid(movementId) ? await movementById(movementId) : null;
  if (!row) throw new MoneyMovementNotFoundError();
  const { kind, licenseId } = row;
  const retried = () =>
    writeAudit(db, admin, {
      action: "money_movement.retried",
      entityType: "money_movement",
      entityId: row.id,
      data: { movementId: row.id, kind },
    });
  if (kind === "creator_transfer") {
    const settled = standing(row);
    if (settled) return settled;
    await retried();
    return retriedTransfer(row.requestId);
  }
  // A refund or a take-back: the revoke that wrote it revoked its license.
  if (!licenseId || !row.revokedAt) return NOOP;
  const subject: Revoked = {
    licenseId,
    requestId: row.requestId,
    paymentIntentId: row.paymentIntentId,
  };
  return returnStep(row, kind, subject, SENDABLE, LAZY, retried);
}

/**
 * Sends the money movements due now, one at a time, oldest first (02 §8.4; 03 §7.8, §7.10): returns how many ended
 * 'succeeded'. Without `creatorId` (the cron), first the refunds and take-backs left pending (unclaimed, untouched for
 * `olderThanMinutes`; one refundRevokedLicense per license), then, in what is left of the `limit` batch, the creator
 * transfers: pending rows older than `olderThanMinutes`, and failed rows whose code the creator can fix (owner answer
 * Q-148), of creators whose payouts may be active; a transfer that can't be paid now goes behind the others, so it never
 * holds the batch. With `creatorId` (Settings, the payouts return): that creator's pending and failed transfers of any
 * age (no `olderThanMinutes`), except one tried in the last 2 minutes. The count never passes `limit`, and reaches it
 * only when every row taken succeeded, so the cron's "a full batch may have left more" still holds. A claim still held
 * is skipped; `stopAt` (epoch ms) starts no license or row after it; one that fails is logged and the rest go on.
 * Additive to 02 §5.7: `actor`, `stopAt`.
 */
export async function sweepMoneyMovements(
  options: SweepScope & { limit: number; actor?: Actor; stopAt?: number },
): Promise<number> {
  const { limit, actor = LAZY, stopAt } = options;
  const source = transferSourceOf(actor);
  const cron = options.creatorId === undefined;
  const returns = cron
    ? await sweepReturns(options.olderThanMinutes, limit, source, stopAt)
    : { taken: 0, succeeded: 0 };
  const room = limit - returns.taken;
  if (room <= 0) return returns.succeeded;
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
        cron
          ? cronDue(options.olderThanMinutes)
          : creatorDue(options.creatorId),
      ),
    )
    .orderBy(asc(moneyMovement.updatedAt), asc(moneyMovement.id))
    .limit(room);
  let paid = 0;
  for (const row of due) {
    const { requestId } = row;
    if (stopAt !== undefined && Date.now() >= stopAt) break;
    try {
      const result = await sendCreatorTransfer(requestId, { source });
      if (result === "succeeded") paid += 1;
      else if (cron) await sendToBack(row.id);
    } catch (error) {
      logEvent("warn", "money_movement.sweep_failed", {
        requestId,
        error: errorName(error),
      });
    }
  }
  return returns.succeeded + paid;
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

/**
 * What a revoke found of the request's creator transfer (owner answers Q-207, Q-210): sent, or canceled now, with its
 * amount and the attempts made on it (a call was made when it is above 0).
 */
type RevokedTransfer =
  | { transfer: "none" | "in_flight" }
  | { transfer: "sent" | "canceled"; amountCents: number; attempt: number };

/**
 * The creator transfer under a revoke (07 D86; owner answers Q-207, Q-210), in the revoke's own transaction `tx`: the
 * row locked FOR UPDATE, so no claim starts meanwhile. One still to send is canceled, its claim cleared, so no sweep pays
 * it and a late fenced finish can't overwrite it; one a live claim holds is 'in_flight' (the caller refuses the revoke).
 * A sent or canceled one comes back with its amount and attempt, for the take-back. The lease is read on this module's
 * clock, as the claims write it. No payments call.
 */
export async function cancelUnsentTransfer(
  tx: Tx,
  requestId: string,
): Promise<RevokedTransfer> {
  const [row] = await tx
    .select({
      id: moneyMovement.id,
      status: moneyMovement.status,
      claimedAt: moneyMovement.claimedAt,
      amountCents: moneyMovement.amountCents,
      attempt: moneyMovement.attempt,
    })
    .from(moneyMovement)
    .where(
      and(
        eq(moneyMovement.licenseRequestId, requestId),
        eq(moneyMovement.kind, "creator_transfer"),
      ),
    )
    .for("update");
  if (!row || row.status === "canceled") return { transfer: "none" };
  const { amountCents, attempt } = row;
  if (row.status === "succeeded") {
    return { transfer: "sent", amountCents, attempt };
  }
  if (isLive(row.claimedAt)) return { transfer: "in_flight" };
  await tx
    .update(moneyMovement)
    .set({ status: "canceled", claimedAt: null, updatedAt: new Date() })
    .where(eq(moneyMovement.id, row.id));
  return { transfer: "canceled", amountCents, attempt };
}

/**
 * A pending movement of `kind` for the request (07 D75, D86), in its request's currency (I33): one per kind, so a repeat
 * inserts nothing (ON CONFLICT (license_request_id, kind) DO NOTHING).
 */
export async function insertMovement(
  exec: Pick<typeof db, "insert">,
  movement: {
    requestId: string;
    kind: MoneyMovementKind;
    currency: Currency;
    amountCents: number;
  },
): Promise<void> {
  await exec
    .insert(moneyMovement)
    .values({
      licenseRequestId: movement.requestId,
      kind: movement.kind,
      status: "pending",
      currency: movement.currency,
      amountCents: movement.amountCents,
    })
    .onConflictDoNothing({
      target: [moneyMovement.licenseRequestId, moneyMovement.kind],
    });
}

/** The cron's rows, older than `olderThanMinutes`, or one creator's of any age. */
type SweepScope =
  | { olderThanMinutes: number; creatorId?: undefined }
  | { creatorId: string; olderThanMinutes?: undefined };

type TransferRow = NonNullable<Awaited<ReturnType<typeof transferRow>>>;

/**
 * This call's claim on a movement: its fence (`claimedAt`, a JS Date), the attempt its key carries, the row's status and
 * last error as the claim found them (no one else changes them while it holds), and its request, amount and currency.
 */
type Claim = {
  id: string;
  kind: MoneyMovementKind;
  requestId: string;
  claimedAt: Date;
  attempt: number;
  status: MoneyMovementStatus;
  lastError: string | null;
  amountCents: number;
  currency: Currency;
};

/** A revoked license, with what giving its money back needs from its request. */
type Revoked = {
  licenseId: string;
  requestId: string;
  paymentIntentId: string | null;
};

/** A refund or take-back row, as a step decides on it. */
type MovementRow = {
  id: string;
  status: MoneyMovementStatus;
  claimedAt: Date | null;
};

/** The request's refund and its take-back (money_movement_request_kind_uidx: one of each at most). */
const refundMovement = alias(moneyMovement, "refund_movement");
const reversalMovement = alias(moneyMovement, "reversal_movement");

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

/** A movement's columns as a step decides on it, from `m`, one of the license's joined movements. */
const movementColumns = <N extends string>(
  m: BuildAliasTable<typeof moneyMovement, N>,
) => ({
  id: m.id,
  status: m.status,
  claimedAt: m.claimedAt,
});

/**
 * The license, when it is revoked, with its request's PaymentIntent and its refund and take-back rows (each null when
 * there is none), in one read; null otherwise.
 */
async function revokedLicense(licenseId: string): Promise<{
  subject: Revoked;
  movements: Record<ReturnKind, MovementRow | null>;
} | null> {
  if (!isUuid(licenseId)) return null;
  const [row] = await db
    .select({
      revokedAt: license.revokedAt,
      requestId: license.licenseRequestId,
      paymentIntentId: licenseRequest.stripePaymentIntentId,
      refund: movementColumns(refundMovement),
      reversal: movementColumns(reversalMovement),
    })
    .from(license)
    .innerJoin(licenseRequest, eq(licenseRequest.id, license.licenseRequestId))
    // The kind in each ON clause, so a license without one of them is still one row; Drizzle answers a joined movement
    // whose columns are all null (none of that kind) as null.
    .leftJoin(
      refundMovement,
      and(
        eq(refundMovement.licenseRequestId, license.licenseRequestId),
        eq(refundMovement.kind, "buyer_refund"),
      ),
    )
    .leftJoin(
      reversalMovement,
      and(
        eq(reversalMovement.licenseRequestId, license.licenseRequestId),
        eq(reversalMovement.kind, "transfer_reversal"),
      ),
    )
    .where(eq(license.id, licenseId));
  if (!row?.revokedAt) return null;
  return {
    subject: {
      licenseId,
      requestId: row.requestId,
      paymentIntentId: row.paymentIntentId,
    },
    movements: { buyer_refund: row.refund, transfer_reversal: row.reversal },
  };
}

/** Whether the request's creator transfer reads canceled now (a revoke canceled it before it was sent). */
async function payoutCanceled(requestId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: moneyMovement.status })
    .from(moneyMovement)
    .where(
      and(
        eq(moneyMovement.licenseRequestId, requestId),
        eq(moneyMovement.kind, "creator_transfer"),
      ),
    );
  return row?.status === "canceled";
}

/**
 * Any movement by id, with its request's PaymentIntent and its license (null for a transfer whose license isn't issued,
 * never in practice) and when that was revoked.
 */
async function movementById(id: string) {
  const [row] = await db
    .select({
      id: moneyMovement.id,
      kind: moneyMovement.kind,
      status: moneyMovement.status,
      claimedAt: moneyMovement.claimedAt,
      requestId: moneyMovement.licenseRequestId,
      paymentIntentId: licenseRequest.stripePaymentIntentId,
      licenseId: license.id,
      revokedAt: license.revokedAt,
    })
    .from(moneyMovement)
    .innerJoin(
      licenseRequest,
      eq(licenseRequest.id, moneyMovement.licenseRequestId),
    )
    .leftJoin(
      license,
      eq(license.licenseRequestId, moneyMovement.licenseRequestId),
    )
    .where(eq(moneyMovement.id, id));
  return row ?? null;
}

/** A Retry of a creator transfer: its send, and why it ended as it did, in the words a Retry answers with. */
async function retriedTransfer(requestId: string): Promise<MoneyStepResult> {
  const sent = await send(requestId, "lazy");
  switch (sent.result) {
    case "succeeded":
      return SUCCEEDED;
    case "retry":
      return TRANSIENT;
    case "failed":
      return { outcome: "failed", code: sent.code };
    case "skipped":
      return RETRIED_SKIP[sent.why];
  }
}

/** A movement nothing is to be done with now: done or canceled (noop), or held by a live claim (in progress). */
function standing(row: MovementRow): MoneyStepResult | null {
  if (row.status === "succeeded" || row.status === "canceled") return NOOP;
  return isLive(row.claimedAt) ? IN_PROGRESS : null;
}

/** A step that throws (a database error) answers transient, logged, so the next step still runs and the sweep retries. */
async function guarded(
  subject: Revoked,
  kind: ReturnKind,
  step: () => Promise<MoneyStepResult>,
): Promise<MoneyStepResult> {
  try {
    return await step();
  } catch (error) {
    logEvent("warn", "money_movement.step_failed", {
      licenseId: subject.licenseId,
      kind,
      error: errorName(error),
    });
    return TRANSIENT;
  }
}

/**
 * A transfer that may have landed after a revoke canceled its row (owner answer Q-210): this send's call answered ok, or
 * maybe (transient), but its claim was gone. When the row reads canceled the money may be with the creator, so the
 * request gets a pending take-back for the sweep: inserted, or reopened when a reversal step found nothing yet and
 * canceled it. A pending, succeeded or failed take-back is left as it is; a claim lost to another sender changes nothing.
 * True when the transfer read canceled (a take-back is owed).
 */
async function owedLateTakeBack(claim: Claim): Promise<boolean> {
  const { requestId } = claim;
  if (!(await payoutCanceled(requestId))) return false;
  await db
    .insert(moneyMovement)
    .values({
      licenseRequestId: requestId,
      kind: "transfer_reversal",
      status: "pending",
      currency: claim.currency,
      amountCents: claim.amountCents,
    })
    .onConflictDoUpdate({
      target: [moneyMovement.licenseRequestId, moneyMovement.kind],
      set: {
        status: "pending",
        claimedAt: null,
        lastError: null,
        updatedAt: new Date(),
      },
      setWhere: eq(moneyMovement.status, "canceled"),
    });
  logEvent("warn", "money_movement.transfer_after_cancel", {
    requestId,
    attempt: claim.attempt,
  });
  return true;
}

/** The first of the request's transfers not taken back in full. */
const stillOut = (found: readonly FoundTransfer[]) =>
  found.find((sent) => sent.amountReversedCents < sent.amountCents);

/**
 * One refund or take-back on its row: claimed from `from` unless done or held by a live claim, `onClaimed` (an admin
 * Retry's audit), then run, a run that throws answering transient.
 */
async function returnStep(
  row: MovementRow,
  kind: ReturnKind,
  subject: Revoked,
  from: readonly MoneyMovementStatus[],
  actor: Actor,
  onClaimed?: () => Promise<void>,
): Promise<MoneyStepResult> {
  const settled = standing(row);
  if (settled) return settled;
  if (!from.includes(row.status)) return NOOP;
  const claim = await claimMovement(row.id, from);
  if (!claim) return IN_PROGRESS;
  await onClaimed?.();
  return guarded(subject, kind, () => runReturn(claim, kind, subject, actor));
}

/**
 * Stripe's side of a claimed refund or take-back: given back already (with its id), nothing to call on, nothing ever
 * sent to take back (a canceled payout), or the call.
 */
type Reconciled =
  | { returnedId: string }
  | { refused: string }
  | { nothingSent: true }
  | { call: () => Promise<{ ok: true; id: string } | MoneyCallFailure> };

/**
 * A claimed refund or take-back (03 §5.5): reconcile (a read that throws lets the claim go), at most one driver call
 * under the claim's key, then the fenced finish. Money found already given back finishes succeeded with Stripe's id
 * (owner answer Q-206); a take-back of a canceled payout that never landed finishes canceled, a noop (Q-210); a
 * transient answer lets the claim go for the sweep.
 */
async function runReturn(
  claim: Claim,
  kind: ReturnKind,
  subject: Revoked,
  actor: Actor,
): Promise<MoneyStepResult> {
  const step = STEP_OF[kind];
  const ending = returnEnding(subject.licenseId, claim.id, step);
  let next: Reconciled;
  try {
    next =
      kind === "buyer_refund"
        ? await refundState(claim, subject)
        : await reversalState(claim);
  } catch (error) {
    await releaseClaim(claim);
    logEvent("warn", `money_movement.${step}_lookup_failed`, {
      requestId: claim.requestId,
      error: errorName(error),
    });
    return TRANSIENT;
  }
  if ("returnedId" in next) {
    return returned(claim, ending, actor, next.returnedId, true);
  }
  if ("refused" in next) return refused(claim, ending, actor, next.refused);
  if ("nothingSent" in next) {
    // No audit, as the revoke's cancel of the payout writes none.
    const done = await finish(
      claim,
      { status: "canceled", lastError: null },
      actor,
      null,
    );
    return done ? NOOP : IN_PROGRESS;
  }
  const outcome = await next.call();
  if (outcome.ok) return returned(claim, ending, actor, outcome.id, false);
  if (outcome.kind === "transient") {
    // Maybe given back: the next claim reconciles before it calls again.
    await releaseClaim(claim);
    logEvent("warn", `money_movement.${step}_retry`, {
      requestId: claim.requestId,
      attempt: claim.attempt,
      stripeCode: outcome.code,
    });
    return TRANSIENT;
  }
  return refused(claim, ending, actor, outcome.code);
}

/** The refund as Stripe has it: refunded in full already, or the full refund to make. Throws when unreadable. */
async function refundState(
  claim: Claim,
  subject: Revoked,
): Promise<Reconciled> {
  const { paymentIntentId } = subject;
  if (!paymentIntentId) return { refused: "payment_intent_missing" };
  const charge = await getAuthorization(claim.currency, paymentIntentId);
  if (charge.amountRefundedCents >= claim.amountCents) {
    return charge.refundId
      ? { returnedId: charge.refundId }
      : { refused: "refund_id_missing" };
  }
  return {
    call: async () => {
      const outcome = await refund(
        claim.currency,
        claim.requestId,
        paymentIntentId,
        claim.attempt,
      );
      return outcome.ok ? { ok: true, id: outcome.refundId } : outcome;
    },
  };
}

/**
 * The take-back as Stripe has it: no transfer (nothing sent when the revoke canceled the payout, else not found),
 * taken back in full already, or the full reversal to make. Throws when unreadable.
 */
async function reversalState(claim: Claim): Promise<Reconciled> {
  const found = await findTransfers(claim.currency, claim.requestId);
  if (found.length === 0) {
    return (await payoutCanceled(claim.requestId))
      ? { nothingSent: true }
      : { refused: "transfer_not_found" };
  }
  const out = stillOut(found);
  if (!out) {
    const reversalId = found.find((sent) => sent.reversalId)?.reversalId;
    return reversalId
      ? { returnedId: reversalId }
      : { refused: "reversal_id_missing" };
  }
  return {
    call: async () => {
      const outcome = await reverseTransfer(
        claim.currency,
        claim.requestId,
        out.transferId,
        claim.attempt,
      );
      return outcome.ok ? { ok: true, id: outcome.reversalId } : outcome;
    },
  };
}

/** A return's success finish as a step result: a lost fence means another claim took the row over. */
async function returned(
  claim: Claim,
  ending: Ending,
  actor: Actor,
  stripeObjectId: string,
  reconciled: boolean,
): Promise<MoneyStepResult> {
  const done = await finishSucceeded(
    claim,
    ending,
    actor,
    stripeObjectId,
    reconciled,
  );
  return done ? SUCCEEDED : IN_PROGRESS;
}

/** A return's failure finish as a step result. */
async function refused(
  claim: Claim,
  ending: Ending,
  actor: Actor,
  code: string,
): Promise<MoneyStepResult> {
  const done = await finishFailed(claim, ending, actor, code);
  return done ? { outcome: "failed", code } : IN_PROGRESS;
}

/**
 * The cron's refunds and take-backs (03 §7.10): pending, unclaimed rows untouched for `olderThanMinutes` (a transient
 * answer, or after() lost to a crash), oldest first, at most `limit`, one refundRevokedLicense per license. Returns how
 * many rows it took and how many of those ended succeeded. A failed row waits for admin Retry.
 */
async function sweepReturns(
  olderThanMinutes: number,
  limit: number,
  source: TransferSource,
  stopAt: number | undefined,
): Promise<{ taken: number; succeeded: number }> {
  const due = await db
    .select({
      // The WHERE takes the return kinds only.
      kind: sql<ReturnKind>`${moneyMovement.kind}`,
      licenseId: license.id,
    })
    .from(moneyMovement)
    .innerJoin(
      license,
      eq(license.licenseRequestId, moneyMovement.licenseRequestId),
    )
    .where(
      and(
        inArray(moneyMovement.kind, RETURN_KINDS),
        eq(moneyMovement.status, "pending"),
        unclaimed(),
        lt(moneyMovement.updatedAt, minutesAgo(olderThanMinutes)),
      ),
    )
    .orderBy(asc(moneyMovement.updatedAt), asc(moneyMovement.id))
    .limit(limit);
  const kindsOf = new Map<string, ReturnKind[]>();
  for (const { licenseId, kind } of due) {
    kindsOf.set(licenseId, [...(kindsOf.get(licenseId) ?? []), kind]);
  }
  let succeeded = 0;
  for (const [licenseId, kinds] of kindsOf) {
    if (stopAt !== undefined && Date.now() >= stopAt) break;
    try {
      const money = await refundRevokedLicense(licenseId, { source });
      for (const kind of kinds) {
        if (money[STEP_OF[kind]].outcome === "succeeded") succeeded += 1;
      }
    } catch (error) {
      logEvent("warn", "money_movement.sweep_failed", {
        licenseId,
        error: errorName(error),
      });
    }
  }
  return { taken: due.length, succeeded };
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

/**
 * Claims movement `id` (07 D75): from one of `from`, only when no live claim holds it, attempt + 1. The fence is a Date
 * on this module's clock, never the database's now(): Postgres keeps microseconds, so a finish fenced on a millisecond
 * Date would never match it.
 */
async function claimMovement(
  id: string,
  from: readonly MoneyMovementStatus[],
): Promise<Claim | null> {
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
        eq(moneyMovement.id, id),
        inArray(moneyMovement.status, from),
        unclaimed(),
      ),
    )
    .returning({
      kind: moneyMovement.kind,
      requestId: moneyMovement.licenseRequestId,
      attempt: moneyMovement.attempt,
      status: moneyMovement.status,
      lastError: moneyMovement.lastError,
      amountCents: moneyMovement.amountCents,
      currency: moneyMovement.currency,
    });
  return claimed ? { id, claimedAt, ...claimed } : null;
}

/**
 * Lets the claim go after a call that may not have reached Stripe: fenced, so a newer claim (or a revoke's cancel) keeps
 * its own. False when the fence didn't hold.
 */
async function releaseClaim(claim: Claim): Promise<boolean> {
  const released = await db
    .update(moneyMovement)
    .set({ claimedAt: null })
    .where(fence(claim))
    .returning({ id: moneyMovement.id });
  return released.length > 0;
}

function fence(claim: Claim) {
  return and(
    eq(moneyMovement.id, claim.id),
    eq(moneyMovement.claimedAt, claim.claimedAt),
  );
}

/** Where a movement's endings are audited, and each ending's action and data (owner answer Q-145; 07 D86). */
type Ending = {
  entityType: "license_request" | "license";
  entityId: string;
  succeeded: (
    stripeObjectId: string,
    reconciled: boolean,
  ) => Pick<AuditEntry, "action" | "data">;
  failed: (
    code: string,
    extra: Record<string, unknown>,
  ) => Pick<AuditEntry, "action" | "data">;
};

/** A creator transfer's endings, on its request (owner answer Q-145). */
const transferEnding = (requestId: string): Ending => ({
  entityType: "license_request",
  entityId: requestId,
  succeeded: (transferId, reconciled) => ({
    action: "license_request.transfer_succeeded",
    data: { transferId, reconciled },
  }),
  failed: (code, extra) => ({
    action: "license_request.transfer_failed",
    data: { code, ...extra },
  }),
});

/** A refund's or a take-back's endings, on the revoked license, naming the movement (07 D86). */
const returnEnding = (
  licenseId: string,
  movementId: string,
  step: (typeof STEP_OF)[ReturnKind],
): Ending => ({
  entityType: "license",
  entityId: licenseId,
  succeeded: (stripeObjectId, reconciled) => ({
    action: `license.${step}_succeeded`,
    data: { movementId, stripeObjectId, reconciled },
  }),
  failed: (code) => ({
    action: `license.${step}_failed`,
    data: { movementId, code },
  }),
});

/** Done (or found done): the row records Stripe's object, with its success audit. False when the fence didn't hold. */
async function finishSucceeded(
  claim: Claim,
  ending: Ending,
  actor: Actor,
  stripeObjectId: string,
  reconciled: boolean,
): Promise<boolean> {
  const done = await finish(
    claim,
    {
      status: "succeeded",
      stripeObjectId,
      succeededAt: new Date(),
      lastError: null,
    },
    actor,
    audit(claim, ending, ending.succeeded(stripeObjectId, reconciled)),
  );
  if (!done) {
    logEvent("warn", "money_movement.finish_lost", {
      requestId: claim.requestId,
      kind: claim.kind,
    });
  }
  return done;
}

/**
 * Refused for good: the row fails with the code, for the creator's Banner and the admin. The audit is written once per
 * failure, not on every retry that fails the same way. False when the fence didn't hold.
 */
async function finishFailed(
  claim: Claim,
  ending: Ending,
  actor: Actor,
  code: string,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const repeated = claim.status === "failed" && claim.lastError === code;
  return finish(
    claim,
    { status: "failed", lastError: code },
    actor,
    repeated ? null : audit(claim, ending, ending.failed(code, extra)),
  );
}

/** The audit row of a movement's ending: `data` with the attempt and the amount, no account ids. */
function audit(
  claim: Claim,
  ending: Ending,
  { action, data }: Pick<AuditEntry, "action" | "data">,
): AuditEntry {
  return {
    action,
    entityType: ending.entityType,
    entityId: ending.entityId,
    data: {
      ...data,
      attempt: claim.attempt,
      amountCents: claim.amountCents,
      currency: claim.currency,
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
