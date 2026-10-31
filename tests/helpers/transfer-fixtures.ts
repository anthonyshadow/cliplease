// Creator transfers for [int] tests (P19b; 07 D74–D77): a creator who can approve and a waiting request at the J4.7
// quote, approved with its after() work held (queue mode) or lost to a crash, so a test meets the pending transfer T5
// left before anything sends it; the transfer row; the cron's sweep and the clocks the sweeps read (updated_at on the
// database's clock, a claim on its own JS clock, the payouts reading's age); the check that no transfer step touches
// the request's claim or its license; the transfer audits as written; and the check that the creator was paid once.
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { expect } from "vitest";
import { db } from "../../src/db/client";
import { auditEvent, creatorProfile, moneyMovement } from "../../src/db/schema";
import type {
  CreatorProfile,
  LicenseRequest,
  MoneyMovement,
  NewCreatorProfile,
  NewLicenseRequest,
  Video,
} from "../../src/db/schema/types";
import type {
  AuditActorType,
  Currency,
  PayoutsStatus,
} from "../../src/lib/domain/values";
import { MINUTE_MS } from "../../src/lib/time";
import { type Actor, CRON } from "../../src/server/auth/actor";
import { approveLicenseRequest } from "../../src/server/licensing/approve";
import { sweepMoneyMovements } from "../../src/server/licensing/money";
import { dropQueuedAfter, queueAfter } from "./after";
import {
  approvableVideo,
  approvingCreator,
  PAID_SOCIAL_YEAR_WORLDWIDE,
  waitingRequest,
} from "./approval-fixtures";
import { requestRow } from "./factories";
import { licensesOf, movementsOf } from "./request-outcomes";
import type { ScriptedPayments } from "./scripted-payments";

/** J4.7's license price: what the creator is paid, never the total (07 D74). */
export const PRICE = PAID_SOCIAL_YEAR_WORLDWIDE.licensePriceCents;

/** A creator, their published video and one waiting request on it; `account` is the creator's connected account. */
export type TransferSubject = {
  creator: CreatorProfile;
  actor: Actor;
  account: string;
  live: Video;
  row: LicenseRequest;
  id: string;
};

/** A waiting request on `live` at `quote`. */
async function requestOn(live: Video, quote: Partial<NewLicenseRequest>) {
  const { row } = await waitingRequest(live, quote);
  return { row, id: row.id };
}

/**
 * A creator who can approve (`creator` overrides the profile), their published video and a waiting request on it at
 * `quote`: J4.7's by default (157500 / 15750 / 173250).
 */
export async function transferSubject({
  creator: overrides = {},
  quote = PAID_SOCIAL_YEAR_WORLDWIDE,
}: {
  creator?: Partial<NewCreatorProfile>;
  quote?: Partial<NewLicenseRequest>;
} = {}): Promise<TransferSubject> {
  const { creator, actor } = await approvingCreator(overrides);
  if (!creator.stripeAccountId) throw new Error("no connected account");
  const live = await approvableVideo(creator.id);
  return {
    creator,
    actor,
    account: creator.stripeAccountId,
    live,
    ...(await requestOn(live, quote)),
  };
}

/** Another waiting request of `s`'s creator on the same video, at J4.7's quote. */
export async function anotherRequest(
  s: TransferSubject,
): Promise<TransferSubject> {
  return { ...s, ...(await requestOn(s.live, PAID_SOCIAL_YEAR_WORLDWIDE)) };
}

/** What a transfer never reads or writes (07 D75): the request's status and claim, and its licenses. */
async function claimAndLicenses(requestId: string) {
  const { status, paymentAction, paymentActionAt, stripeAttempt } =
    await requestRow(requestId);
  return {
    status,
    paymentAction,
    paymentActionAt,
    stripeAttempt,
    licenses: await licensesOf(requestId),
  };
}

/** The request's claim and licenses now: the returned check fails unless they are still the same. */
export async function frozen(requestId: string): Promise<() => Promise<void>> {
  const before = await claimAndLicenses(requestId);
  return async () => {
    expect(await claimAndLicenses(requestId)).toEqual(before);
  };
}

/**
 * Approves `s`'s request with after() held (queueAfter): T5 committed, its transfer pending, and nothing has sent it.
 * The caller runs the held work (runQueuedAfter) or loses it as a crash would (approveCrashed). Returns frozen's check,
 * taken once T5 committed.
 */
export async function approveHeld(
  s: TransferSubject,
): Promise<() => Promise<void>> {
  queueAfter();
  const result = await approveLicenseRequest(s.id, s.actor);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return frozen(s.id);
}

/** approveHeld, then its held work lost as a crash after T5's commit would lose it (dropQueuedAfter): still pending. */
export async function approveCrashed(
  s: TransferSubject,
): Promise<() => Promise<void>> {
  const unchanged = await approveHeld(s);
  dropQueuedAfter();
  return unchanged;
}

/** The request's money movements: exactly one, its creator_transfer. */
export async function transferOf(requestId: string): Promise<MoneyMovement> {
  const movements = await movementsOf(requestId);
  expect(movements).toEqual([
    expect.objectContaining({ kind: "creator_transfer" }),
  ]);
  const [movement] = movements;
  if (!movement) throw new Error("no creator transfer");
  return movement;
}

/** Sets columns of the request's creator transfer, as a test's SQL would. */
export async function updateTransfer(
  requestId: string,
  set: PgUpdateSetSource<typeof moneyMovement>,
): Promise<void> {
  const moved = await db
    .update(moneyMovement)
    .set(set)
    .where(
      and(
        eq(moneyMovement.licenseRequestId, requestId),
        eq(moneyMovement.kind, "creator_transfer"),
      ),
    )
    .returning({ id: moneyMovement.id });
  if (moved.length !== 1)
    throw new Error("updateTransfer: no creator transfer");
}

/** The cron's sweep, as the route's STEPS entry `moneyMovements` runs it (02 §8.4): `limit` is its batch. */
export const cronSweep = (limit = 50) =>
  sweepMoneyMovements({ olderThanMinutes: 10, limit, actor: CRON });

/** The request's transfer last touched `minutes` ago on the database's clock, as the sweeps' updated_at filters read it. */
export const touchedMinutesAgo = (requestId: string, minutes: number) =>
  updateTransfer(requestId, {
    updatedAt: sql`now() - make_interval(mins => ${minutes}::int)`,
  });

/** `minutes` ago on the app's clock (a claim's, a payouts reading's). */
export const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * MINUTE_MS);

/** Stores the creator's payouts `status`, read `age` minutes ago: 0 is fresh, over 10 is due a new reading. */
export async function storedPayouts(
  creatorId: string,
  status: PayoutsStatus,
  age = 0,
): Promise<void> {
  await db
    .update(creatorProfile)
    .set({ payoutsStatus: status, payoutsStatusSyncedAt: minutesAgo(age) })
    .where(eq(creatorProfile.id, creatorId));
}

const SUCCEEDED = "license_request.transfer_succeeded";
const FAILED = "license_request.transfer_failed";

/** The request's transfer audits, oldest first; none names an account or carries an email (07 D47). */
export async function transferAudits(requestId: string) {
  const rows = await db
    .select({
      action: auditEvent.action,
      data: auditEvent.data,
      actorType: auditEvent.actorType,
    })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.entityType, "license_request"),
        eq(auditEvent.entityId, requestId),
        inArray(auditEvent.action, [SUCCEEDED, FAILED]),
      ),
    )
    .orderBy(asc(auditEvent.createdAt));
  expect(JSON.stringify(rows)).not.toMatch(/acct_|@/);
  return rows;
}

type AuditedAs = {
  /** Who sent it (07 D47): the lazy system (Approve, Settings, a direct send) names its source; Stripe and the cron don't. */
  by?: Extract<AuditActorType, "system" | "stripe" | "cron">;
  amountCents?: number;
  currency?: Currency;
};

const sourceOf = (by: AuditedAs["by"]) =>
  by === "system" ? { source: "lazy" } : {};

type PaidAs = AuditedAs & { reconciled?: boolean };

/** A transfer_succeeded audit's data without its source (owner answer Q-145). */
const paidData = (
  transferId: string,
  attempt: number,
  { amountCents = PRICE, currency = "cad", reconciled = false }: PaidAs,
) => ({ transferId, attempt, amountCents, currency, reconciled });

/** A transfer_succeeded audit as sendCreatorTransfer writes it (owner answer Q-145). */
export function paidAudit(
  transferId: string,
  attempt: number,
  { by = "system", ...paid }: PaidAs = {},
) {
  return {
    action: SUCCEEDED,
    data: { ...paidData(transferId, attempt, paid), ...sourceOf(by) },
    actorType: by,
  };
}

/**
 * The creator paid once for the request (07 D74–D76): its one creator_transfer succeeded on `attempt` (1) under
 * `transferId` (the fake's `tr_fake_<request id>`) for `amountCents` in `currency`, and its transfer audits are that
 * one transfer_succeeded, sent by `by` (anyone when omitted: whichever T5 scheduled it). With `scripted`, the double's
 * only createTransfer call was under that attempt's key, and its ledger holds that one transfer for the request.
 * Returns the movement.
 */
export async function expectPaidOnce(
  requestId: string,
  {
    by,
    amountCents = PRICE,
    currency = "cad",
    reconciled = false,
    attempt = 1,
    transferId = `tr_fake_${requestId}`,
    scripted,
  }: PaidAs & {
    attempt?: number;
    transferId?: string;
    scripted?: ScriptedPayments;
  } = {},
): Promise<MoneyMovement> {
  const movement = await transferOf(requestId);
  expect(movement).toMatchObject({
    status: "succeeded",
    stripeObjectId: transferId,
    attempt,
    amountCents,
    currency,
    succeededAt: expect.any(Date),
    claimedAt: null,
    lastError: null,
  });
  const paid = { amountCents, currency, reconciled };
  expect(await transferAudits(requestId)).toEqual([
    by
      ? paidAudit(transferId, attempt, { by, ...paid })
      : {
          action: SUCCEEDED,
          data: expect.objectContaining(paidData(transferId, attempt, paid)),
          actorType: expect.any(String),
        },
  ]);
  if (scripted) {
    const key = `transfer:${requestId}:${attempt}`;
    expect(scripted.keys("createTransfer")).toEqual([key]);
    expect(
      scripted.ledger.filter((sent) => sent.requestId === requestId),
    ).toEqual([
      expect.objectContaining({ key, transferId, amountCents, currency }),
    ]);
  }
  return movement;
}

/** A transfer_failed audit as sendCreatorTransfer writes it; `extra` is a mismatch's `count` (owner answer Q-151). */
export function refusedAudit(
  code: string,
  attempt: number,
  {
    by = "system",
    amountCents = PRICE,
    currency = "cad",
    extra = {},
  }: AuditedAs & { extra?: Record<string, unknown> } = {},
) {
  return {
    action: FAILED,
    data: { code, attempt, amountCents, currency, ...extra, ...sourceOf(by) },
    actorType: by,
  };
}
