import { eq, ne } from "drizzle-orm";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { db } from "../../src/db/client";
import { licenseRequest, moneyMovement } from "../../src/db/schema";
import { LAZY } from "../../src/server/auth/actor";
import { env } from "../../src/server/env";
import { issueLicense } from "../../src/server/licensing/issue";
import { settleCreatorMoney } from "../../src/server/licensing/lazy";
import {
  failedTransferTotalCents,
  sendCreatorTransfer,
  sweepMoneyMovements,
} from "../../src/server/licensing/money";
import { findTransfers } from "../../src/server/payments";
import type { PaymentsDriver } from "../../src/server/payments/driver";
import { paymentsDriver } from "../../src/server/payments/registry";
import {
  dropQueuedAfter,
  flushAfter,
  queueAfter,
  runQueuedAfter,
} from "../helpers/after";
import { approvingCreator } from "../helpers/approval-fixtures";
import { countsOf, cron } from "../helpers/cron";
import { resetDb } from "../helpers/db";
import {
  insertLicense,
  insertLicenseRequest,
  insertMoneyMovement,
} from "../helpers/factories";
import {
  AFTER_FAILED,
  captureLogEvents,
  recordStderr,
  stopStderr,
} from "../helpers/logs";
import { deliverPiEvent } from "../helpers/pi-events";
import { movementsOf, onlyLicense } from "../helpers/request-outcomes";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  finishRecordedTest,
  finishScriptedTest,
  installScriptedPayments,
  uninstallScriptedPayments,
} from "../helpers/scripted-suite";
import {
  anotherRequest,
  approveCrashed,
  approveHeld,
  cronSweep,
  expectPaidOnce,
  frozen,
  minutesAgo,
  PRICE,
  paidAudit,
  refusedAudit,
  storedPayouts,
  touchedMinutesAgo,
  transferAudits,
  transferOf,
  transferSubject,
  updateTransfer,
} from "../helpers/transfer-fixtures";

// Paying the creator (P19b; 02 §5.7, §8.2 step 5, §8.4; 03 §5.5, §7.8, §7.10, T5, I29, I33; 07 D24, D47, D74–D77, D94,
// D95; 01 J4.7, J8.16; owner answers OQ-05, OQ-18, Q-145, Q-148, Q-151): T5 leaves one pending creator_transfer of the
// license price, sent after the response by sendCreatorTransfer (claim, reconcile with findTransfers, the transfer
// call, a fenced finish), healed by the sweeps (the cron's, the creator's from Settings and the payouts return) and by
// payment_intent.succeeded on an approved request. A transfer never changes the request's claim or its license, and its
// audits name no account and carry no email. Two drivers: the fake (the real registry's, its transfer calls spied on)
// for what the fake itself answers (`tr_fake_<id>`, its findTransfers, another currency's account), and the scripted
// double for Stripe's faults. Most cases approve with after() held (queue mode), then run, drop or replace the transfer
// it scheduled. Each case has its own creator; a case that counts a global sweep or the cron's run starts from an empty
// database. The other currency's case comes last: its driver stays memoized once looked up.

vi.mock("@/server/payments/registry", async (importOriginal) =>
  (await import("../helpers/scripted-suite")).scriptedRegistry(
    await importOriginal<typeof import("@/server/payments/registry")>(),
  ),
);

// after() runs at once, or holds its tasks once a test calls queueAfter().
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("../helpers/after")).runAfter,
}));

let scripted: ScriptedPayments;

/** A describe on the scripted double (P19): a fresh one for each test, the after() work watched for failures. */
function onTheDouble(): void {
  beforeEach(() => {
    scripted = installScriptedPayments();
    recordStderr(AFTER_FAILED);
  });
  afterEach(finishScriptedTest);
}

let transfers: MockInstance<PaymentsDriver["createTransfer"]>;
let lookups: MockInstance<PaymentsDriver["findTransfers"]>;

/** A describe on the fake driver: the real registry's CAD instance, its transfer calls spied on (never replaced). */
function onTheFake(): void {
  beforeEach(() => {
    uninstallScriptedPayments();
    const cad = paymentsDriver("cad");
    transfers = vi.spyOn(cad, "createTransfer");
    lookups = vi.spyOn(cad, "findTransfers");
    recordStderr(AFTER_FAILED);
  });
  afterEach(() => finishRecordedTest());
}

/** A mark in the double's log: the returned function gives the methods called since, in order. */
function callsFromNow(): () => string[] {
  const from = scripted.log.length;
  return () => scripted.log.slice(from).map(({ method }) => method);
}

/** The creator sweep Settings and the payouts return run (03 §7.8). */
const creatorSweep = (creatorId: string) =>
  sweepMoneyMovements({ creatorId, limit: 50 });

const PENDING = {
  kind: "creator_transfer",
  status: "pending",
  attempt: 0,
  claimedAt: null,
  stripeObjectId: null,
  lastError: null,
} as const;

describe("Approve pays the creator, on the fake driver (07 D74, D75; 01 J4.7)", () => {
  onTheFake();

  it("sends the license price from the request's charge to the creator's account once, then records and audits it", async () => {
    const s = await transferSubject();
    const unchanged = await approveHeld(s);
    expect(await transferOf(s.id)).toMatchObject({
      ...PENDING,
      currency: "cad",
      amountCents: PRICE,
    });
    expect(transfers).not.toHaveBeenCalled();

    await runQueuedAfter();
    // Approve's transfer runs as the system on the creator's behalf (07 D47).
    await expectPaidOnce(s.id, { by: "system" });
    expect(transfers).toHaveBeenCalledExactlyOnceWith({
      requestId: s.id,
      chargeId: `ch_fake_${s.id}`,
      destinationAccountId: s.account,
      amountCents: PRICE,
      idempotencyKey: `transfer:${s.id}:1`,
    });
    // Reconciled first (03 I29): the lookup came before the transfer.
    expect(lookups).toHaveBeenCalledExactlyOnceWith(s.id);
    expect(lookups.mock.invocationCallOrder[0]).toBeLessThan(
      transfers.mock.invocationCallOrder[0] ?? 0,
    );
    await unchanged();
  });

  it("finds a transfer already sent and records it instead of sending again (PAY-09)", async () => {
    const s = await transferSubject();
    const unchanged = await approveHeld(s);
    await runQueuedAfter();
    const sent = `tr_fake_${s.id}`;
    // As P19b's manual check leaves it: failed, its transfer id kept.
    await updateTransfer(s.id, {
      status: "failed",
      lastError: "manual_check",
      updatedAt: minutesAgo(3),
    });

    expect(await sendCreatorTransfer(s.id)).toBe("succeeded");
    expect(await transferOf(s.id)).toMatchObject({
      status: "succeeded",
      stripeObjectId: sent,
      attempt: 2,
      claimedAt: null,
      lastError: null,
    });
    expect(transfers).toHaveBeenCalledOnce();
    expect(await transferAudits(s.id)).toEqual([
      paidAudit(sent, 1),
      paidAudit(sent, 2, { reconciled: true }),
    ]);
    expect(await findTransfers("cad", s.id)).toEqual([
      {
        transferId: sent,
        amountCents: PRICE,
        amountReversedCents: 0,
        destinationAccountId: s.account,
      },
    ]);
    // A transfer exists exactly when its row recorded one (PAY-08).
    await updateTransfer(s.id, { status: "failed", stripeObjectId: null });
    expect(await findTransfers("cad", s.id)).toEqual([]);
    await unchanged();
  });

  it("pays the license price, never the total, at the fee's floor too (OQ-18: 1000 + 200 = 1200)", async () => {
    const s = await transferSubject({
      quote: { licensePriceCents: 1000, platformFeeCents: 200 },
    });
    expect(s.row.amountTotalCents).toBe(1200);
    const unchanged = await approveHeld(s);
    await runQueuedAfter();

    // The row and its audit say 1000, as the one transfer call did.
    await expectPaidOnce(s.id, { by: "system", amountCents: 1000 });
    expect(transfers.mock.calls.map(([input]) => input.amountCents)).toEqual([
      1000,
    ]);
    await unchanged();
  });
});

describe("payment_intent.succeeded and the creator's pay (06 §7; 07 D25, D75)", () => {
  onTheDouble();

  it("a T5 by the webhook pays the creator as Stripe's actor, and a second delivery pays nothing more", async () => {
    const s = await transferSubject();
    // Captured out of band (07 D25): Stripe's event is the T5.
    scripted.seedPi(`pi_fake_${s.id}`, "succeeded");
    queueAfter();
    expect(await deliverPiEvent("payment_intent.succeeded", s.id)).toBe(
      "processed",
    );
    const unchanged = await frozen(s.id);
    await onlyLicense(s.id);
    expect(await transferOf(s.id)).toMatchObject(PENDING);

    await runQueuedAfter();
    await expectPaidOnce(s.id, { by: "stripe", scripted });

    expect(await deliverPiEvent("payment_intent.succeeded", s.id)).toBe(
      "processed",
    );
    await runQueuedAfter();
    await expectPaidOnce(s.id, { by: "stripe", scripted });
    await onlyLicense(s.id);
    await unchanged();
  });

  it("succeeded on an approved request sends the transfer a crash left pending", async () => {
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    expect(await transferOf(s.id)).toMatchObject(PENDING);

    expect(await deliverPiEvent("payment_intent.succeeded", s.id)).toBe(
      "processed",
    );
    await runQueuedAfter();
    await expectPaidOnce(s.id, { by: "stripe", scripted });
    await unchanged();
  });
});

describe("a transfer a crash left pending (02 §8.4; 03 §7.10; 07 D75)", () => {
  onTheDouble();

  it("waits 10 minutes for the sweep, is then sent once, and the cron counts the next one", async () => {
    await resetDb();
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    expect(await transferOf(s.id)).toMatchObject(PENDING);

    expect(await sweepMoneyMovements({ olderThanMinutes: 10, limit: 50 })).toBe(
      0,
    );
    expect(scripted.callsOf("createTransfer")).toEqual([]);
    await touchedMinutesAgo(s.id, 11);
    expect(await sweepMoneyMovements({ olderThanMinutes: 10, limit: 50 })).toBe(
      1,
    );
    await expectPaidOnce(s.id, { by: "system", scripted });
    await unchanged();

    const next = await anotherRequest(s);
    const nextUnchanged = await approveCrashed(next);
    await touchedMinutesAgo(next.id, 11);
    expect(await countsOf(await cron())).toMatchObject({
      reconciled: 0,
      expired: 0,
      moneyMovements: 1,
    });
    await expectPaidOnce(next.id, { by: "cron" });
    await nextUnchanged();
    // The bearer reaches no log line (02 §5.11): a boolean, so a failure doesn't print it either.
    await flushAfter();
    expect(stopStderr().written.includes(env.CRON_SECRET)).toBe(false);
  });
});

describe("Stripe's answers to a transfer (07 D75, D76; 03 §5.5)", () => {
  onTheDouble();

  it("an answer lost after Stripe made the transfer: retry, and the next send finds it instead of paying again", async () => {
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    scripted.next("createTransfer", "ambiguous");

    expect(await sendCreatorTransfer(s.id)).toBe("retry");
    expect(await transferOf(s.id)).toMatchObject({
      ...PENDING,
      attempt: 1,
    });
    const made = `tr_scripted_${s.id}_1`;
    expect(scripted.ledger).toEqual([
      expect.objectContaining({
        transferId: made,
        key: `transfer:${s.id}:1`,
        amountCents: PRICE,
      }),
    ]);

    expect(await sendCreatorTransfer(s.id)).toBe("succeeded");
    await expectPaidOnce(s.id, {
      by: "system",
      attempt: 2,
      transferId: made,
      reconciled: true,
    });
    expect(scripted.callsOf("createTransfer")).toHaveLength(1);
    await unchanged();
  });

  it("a claim younger than the 2-minute lease is left to its holder; an older one is taken over, reconciled first", async () => {
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    // A holder claimed attempt 1 and its transfer reached Stripe.
    const reached = scripted.seedTransfer({
      requestId: s.id,
      amountCents: PRICE,
      destinationAccountId: s.account,
    });
    await updateTransfer(s.id, { attempt: 1, claimedAt: new Date() });

    const calls = callsFromNow();
    expect(await sendCreatorTransfer(s.id)).toBe("skipped");
    expect(calls()).toEqual([]);
    expect(await transferOf(s.id)).toMatchObject({
      status: "pending",
      attempt: 1,
    });

    // The holder went quiet past the lease.
    await updateTransfer(s.id, { claimedAt: minutesAgo(3) });
    expect(await sendCreatorTransfer(s.id)).toBe("succeeded");
    expect(calls()).toEqual(["findTransfers"]);
    await expectPaidOnce(s.id, {
      by: "system",
      attempt: 2,
      transferId: reached.transferId,
      reconciled: true,
    });
    await unchanged();
  });

  it("a transient failure: retry, the claim let go; the sweeps wait, then the cron sends it under the next key", async () => {
    await resetDb();
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    scripted.next("createTransfer", "transient");

    const logged = captureLogEvents("money_movement.transfer_retry");
    expect(await sendCreatorTransfer(s.id)).toBe("retry");
    expect(logged().events).toEqual([
      expect.objectContaining({
        level: "warn",
        requestId: s.id,
        attempt: 1,
        stripeCode: "StripeConnectionError",
      }),
    ]);
    expect(await transferOf(s.id)).toMatchObject({ ...PENDING, attempt: 1 });

    // Tried just now: the creator's sweep doesn't call Stripe again yet (CC-04).
    const calls = callsFromNow();
    expect(await creatorSweep(s.creator.id)).toBe(0);
    expect(calls()).toEqual([]);

    await touchedMinutesAgo(s.id, 11);
    expect(await cronSweep()).toBe(1);
    expect(scripted.keys("createTransfer")).toEqual([
      `transfer:${s.id}:1`,
      `transfer:${s.id}:2`,
    ]);
    await expectPaidOnce(s.id, { by: "cron", attempt: 2 });
    await unchanged();
  });

  it("a lookup that fails: retry with the claim let go and nothing sent", async () => {
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    scripted.transferLookups(new Error("stripe down"));

    const logged = captureLogEvents("money_movement.transfer_lookup_failed");
    expect(await sendCreatorTransfer(s.id)).toBe("retry");
    expect(logged().events).toEqual([
      expect.objectContaining({ requestId: s.id, error: "Error" }),
    ]);
    expect(scripted.callsOf("createTransfer")).toEqual([]);
    expect(await transferOf(s.id)).toMatchObject({ ...PENDING, attempt: 1 });

    expect(await sendCreatorTransfer(s.id)).toBe("succeeded");
    await expectPaidOnce(s.id, { by: "system", attempt: 2, scripted });
    await unchanged();
  });

  it("a permanent refusal fails the row once; the cron leaves it, the same refusal again audits nothing new, and the creator's sweep heals it", async () => {
    await resetDb();
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    const refusal = { kind: "permanent", code: "test_permanent" } as const;
    scripted.next("createTransfer", refusal);

    expect(await sendCreatorTransfer(s.id)).toBe("failed");
    expect(await transferOf(s.id)).toMatchObject({
      status: "failed",
      lastError: "test_permanent",
      attempt: 1,
      claimedAt: null,
      stripeObjectId: null,
    });
    const failed = refusedAudit("test_permanent", 1);
    expect(await transferAudits(s.id)).toEqual([failed]);
    expect(await failedTransferTotalCents(s.creator.id)).toBe(PRICE);

    // Not a code the creator can fix (none until P24): the cron leaves it to Settings and the admin (Q-148).
    await touchedMinutesAgo(s.id, 11);
    const calls = callsFromNow();
    expect(await cronSweep()).toBe(0);
    expect(calls()).toEqual([]);
    expect(await transferOf(s.id)).toMatchObject({
      status: "failed",
      attempt: 1,
    });

    // Settings retries it after the cool-down; refused the same way, it writes no second audit (MC-12).
    await touchedMinutesAgo(s.id, 3);
    scripted.next("createTransfer", refusal);
    expect(await creatorSweep(s.creator.id)).toBe(0);
    expect(await transferOf(s.id)).toMatchObject({
      status: "failed",
      lastError: "test_permanent",
      attempt: 2,
    });
    expect(await transferAudits(s.id)).toEqual([failed]);

    await touchedMinutesAgo(s.id, 3);
    expect(await creatorSweep(s.creator.id)).toBe(1);
    const sent = `tr_fake_${s.id}`;
    expect(await transferOf(s.id)).toMatchObject({
      status: "succeeded",
      stripeObjectId: sent,
      attempt: 3,
      lastError: null,
    });
    expect(scripted.keys("createTransfer")).toEqual([
      `transfer:${s.id}:1`,
      `transfer:${s.id}:2`,
      `transfer:${s.id}:3`,
    ]);
    expect(await failedTransferTotalCents(s.creator.id)).toBe(0);
    expect(await transferAudits(s.id)).toEqual([failed, paidAudit(sent, 3)]);
    await unchanged();
  });

  it("a transfer that doesn't match the row: failed transfer_mismatch, nothing sent, never paid out (Q-151)", async () => {
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    scripted.seedTransfer({
      requestId: s.id,
      amountCents: 1000,
      destinationAccountId: s.account,
    });

    expect(await sendCreatorTransfer(s.id)).toBe("failed");
    expect(await transferOf(s.id)).toMatchObject({
      status: "failed",
      lastError: "transfer_mismatch",
      attempt: 1,
      claimedAt: null,
      stripeObjectId: null,
    });
    expect(scripted.callsOf("createTransfer")).toEqual([]);
    expect(await transferAudits(s.id)).toEqual([
      refusedAudit("transfer_mismatch", 1, { extra: { count: 1 } }),
    ]);
    expect(await failedTransferTotalCents(s.creator.id)).toBe(PRICE);
    await unchanged();
  });
});

describe("what a transfer waits for (07 D75, D77; owner answer OQ-05)", () => {
  onTheDouble();

  it("payouts not active: skipped with nothing claimed or asked, kept out of the cron's batch, then sent once they are", async () => {
    await resetDb();
    const s = await transferSubject();
    const unchanged = await approveHeld(s);
    await storedPayouts(s.creator.id, "restricted");

    const calls = callsFromNow();
    await runQueuedAfter();
    expect(await sendCreatorTransfer(s.id)).toBe("skipped");
    expect(await transferOf(s.id)).toMatchObject(PENDING);
    await touchedMinutesAgo(s.id, 11);
    expect(await cronSweep()).toBe(0);
    expect(calls()).toEqual([]);

    await storedPayouts(s.creator.id, "active");
    expect(await cronSweep()).toBe(1);
    expect(calls()).toEqual(["findTransfers", "createTransfer"]);
    await expectPaidOnce(s.id, { by: "cron", scripted });
    await unchanged();
  });

  it("no charge stored: read from the PaymentIntent, retried with nothing claimed until Stripe names it (PAY-12)", async () => {
    const s = await transferSubject();
    await db
      .update(licenseRequest)
      .set({ stripeChargeId: null })
      .where(eq(licenseRequest.id, s.id));
    const unchanged = await approveHeld(s);

    // The read throws, in the after() transfer and in a direct send: retry, logged by name, never effects.after_failed.
    scripted.authorizations(new Error("stripe down"), new Error("stripe down"));
    const logged = captureLogEvents("money_movement.charge_read_failed");
    await runQueuedAfter();
    expect(await sendCreatorTransfer(s.id)).toBe("retry");
    expect(logged().events).toEqual([
      expect.objectContaining({ requestId: s.id, error: "Error" }),
      expect.objectContaining({ requestId: s.id, error: "Error" }),
    ]);
    expect(await transferOf(s.id)).toMatchObject(PENDING);

    // Stripe hasn't named the charge yet.
    scripted.authorizations({ chargeId: null });
    expect(await sendCreatorTransfer(s.id)).toBe("retry");
    expect(await transferOf(s.id)).toMatchObject(PENDING);
    expect(scripted.callsOf("findTransfers")).toEqual([]);
    expect(scripted.callsOf("createTransfer")).toEqual([]);

    scripted.authorizations({ chargeId: `ch_fake_${s.id}` });
    expect(await sendCreatorTransfer(s.id)).toBe("succeeded");
    expect(scripted.callsOf("createTransfer")).toEqual([
      expect.objectContaining({
        chargeId: `ch_fake_${s.id}`,
        key: `transfer:${s.id}:1`,
      }),
    ]);
    expect(scripted.callsOf("getAuthorization")).toHaveLength(4);
    await unchanged();
  });

  it("a payouts read that fails: retry with nothing claimed, logged by the error's name only", async () => {
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    // The stored reading is stale, so the gate reads again, and Stripe can't be read.
    await storedPayouts(s.creator.id, "active", 11);
    scripted.script({ fetchPayoutsStatus: new Error("sk_test_not_for_logs") });

    const logged = captureLogEvents("money_movement.payouts_read_failed");
    expect(await sendCreatorTransfer(s.id)).toBe("retry");
    const { events, written } = logged();
    expect(events).toEqual([
      expect.objectContaining({
        level: "warn",
        requestId: s.id,
        error: "Error",
      }),
    ]);
    expect(written).not.toContain("sk_test_not_for_logs");
    expect(written).not.toContain(s.account);
    expect(await transferOf(s.id)).toMatchObject(PENDING);
    expect(scripted.callsOf("findTransfers")).toEqual([]);
    expect(scripted.callsOf("createTransfer")).toEqual([]);

    scripted.script({ fetchPayoutsStatus: undefined });
    expect(await sendCreatorTransfer(s.id)).toBe("succeeded");
    expect(scripted.keys("createTransfer")).toEqual([`transfer:${s.id}:1`]);
    await unchanged();
  });
});

describe("one payment only (07 D75; 03 §5.5)", () => {
  onTheDouble();

  it("a second send while the first is at Stripe is skipped: one transfer, one key, one audit", async () => {
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    const held = scripted.hold("createTransfer");

    const first = sendCreatorTransfer(s.id);
    const call = await held.reached;
    // Claimed and committed before the call (07 D24).
    expect(call.committed).toMatchObject({
      requestStatus: "approved",
      movementStatus: "pending",
      attempt: 1,
      claimedAt: expect.any(Date),
    });
    const calls = callsFromNow();
    expect(await sendCreatorTransfer(s.id)).toBe("skipped");
    expect(calls()).toEqual([]);

    held.release();
    expect(await first).toBe("succeeded");
    expect(scripted.ledger).toHaveLength(1);
    await expectPaidOnce(s.id, { by: "system", scripted });
    await unchanged();
  });
});

describe("the sweeps (02 §8.4; 03 §7.8, §7.10)", () => {
  onTheDouble();

  it("the cron passes over creators whose payouts are known to be off, so their older rows never hold its batch", async () => {
    await resetDb();
    const off = await transferSubject({
      creator: { payoutsStatus: "restricted" },
    });
    for (const minutes of [30, 20]) {
      await insertMoneyMovement(await insertLicenseRequest(off.live), {
        updatedAt: minutesAgo(minutes),
      });
    }
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    await touchedMinutesAgo(s.id, 11);

    const calls = callsFromNow();
    expect(await cronSweep(2)).toBe(1);
    expect(calls()).toEqual(["findTransfers", "createTransfer"]);
    await expectPaidOnce(s.id, { by: "cron", scripted });
    await unchanged();
  });

  it("rows the cron can't pay now go behind the others, so its next run reaches a row it can pay", async () => {
    await resetDb();
    // A creator whose stored reading is stale and whose account Stripe can't read: their rows come back retry.
    const unreadable = await transferSubject();
    await storedPayouts(unreadable.creator.id, "active", 11);
    const stuck = [
      await insertMoneyMovement(await insertLicenseRequest(unreadable.live), {
        updatedAt: minutesAgo(30),
      }),
      await insertMoneyMovement(await insertLicenseRequest(unreadable.live), {
        updatedAt: minutesAgo(20),
      }),
    ];
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    await touchedMinutesAgo(s.id, 11);
    scripted.script({ fetchPayoutsStatus: new Error("unreadable") });

    const quiet = captureLogEvents("money_movement.payouts_read_failed");
    expect(await cronSweep(2)).toBe(0);
    expect(quiet().events).toHaveLength(2);
    expect(scripted.callsOf("createTransfer")).toEqual([]);
    for (const row of stuck) {
      const [moved] = await db
        .select({ updatedAt: moneyMovement.updatedAt })
        .from(moneyMovement)
        .where(eq(moneyMovement.id, row.id));
      expect(moved?.updatedAt.getTime()).toBeGreaterThan(
        row.updatedAt.getTime(),
      );
    }

    const quieter = captureLogEvents("money_movement.payouts_read_failed");
    expect(await cronSweep(2)).toBe(1);
    quieter();
    expect(scripted.keys("createTransfer")).toEqual([`transfer:${s.id}:1`]);
    scripted.script({ fetchPayoutsStatus: undefined });
    await unchanged();
  });

  it("a row whose send must be retried doesn't stop the sweep: the next one is sent", async () => {
    const first = await transferSubject();
    const second = await anotherRequest(first);
    const firstUnchanged = await approveCrashed(first);
    const secondUnchanged = await approveCrashed(second);
    await touchedMinutesAgo(first.id, 5);
    await touchedMinutesAgo(second.id, 4);
    scripted.next("createTransfer", "transient");

    expect(await creatorSweep(first.creator.id)).toBe(1);
    expect(scripted.keys("createTransfer")).toEqual([
      `transfer:${first.id}:1`,
      `transfer:${second.id}:1`,
    ]);
    expect(await transferOf(first.id)).toMatchObject({
      ...PENDING,
      attempt: 1,
    });
    await expectPaidOnce(second.id, { by: "system" });
    await firstUnchanged();
    await secondUnchanged();
  });
});

describe("settleCreatorMoney: Settings and the payouts return (07 D75; 03 §7.8)", () => {
  onTheDouble();

  it("back from payout setup with payouts on: awaits the creator's sweep, so a failed transfer is paid when it returns", async () => {
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);
    scripted.next("createTransfer", {
      kind: "permanent",
      code: "test_permanent",
    });
    expect(await sendCreatorTransfer(s.id)).toBe("failed");
    await touchedMinutesAgo(s.id, 3);

    await settleCreatorMoney({
      creatorId: s.creator.id,
      payoutsStatus: "active",
      wait: true,
    });
    expect(await transferOf(s.id)).toMatchObject({
      status: "succeeded",
      attempt: 2,
    });
    expect(await failedTransferTotalCents(s.creator.id)).toBe(0);
    // Nothing was left for after the response.
    expect(dropQueuedAfter()).toBe(0);
    await unchanged();
  });

  it("on a plain load: the sweep runs after the response and sends the pending transfer", async () => {
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);

    await settleCreatorMoney({
      creatorId: s.creator.id,
      payoutsStatus: "active",
      wait: false,
    });
    expect(scripted.callsOf("createTransfer")).toEqual([]);
    expect(await transferOf(s.id)).toMatchObject(PENDING);

    await runQueuedAfter();
    await expectPaidOnce(s.id, { by: "system", scripted });
    await unchanged();
  });

  it("payouts not active: nothing sent or scheduled, back from setup or not", async () => {
    const s = await transferSubject();
    const unchanged = await approveCrashed(s);

    const calls = callsFromNow();
    for (const wait of [true, false]) {
      await settleCreatorMoney({
        creatorId: s.creator.id,
        payoutsStatus: "restricted",
        wait,
      });
    }
    expect(dropQueuedAfter()).toBe(0);
    expect(calls()).toEqual([]);
    expect(await transferOf(s.id)).toMatchObject(PENDING);
    await unchanged();
  });
});

describe("issueLicense leaves the creator's transfer (03 T5; 07 D75)", () => {
  onTheDouble();

  it("on its existing-license path too: one pending transfer of the license price in the request's currency, however often", async () => {
    const s = await transferSubject();
    const existing = await insertLicense(s.row);
    const issue = () =>
      db.transaction((tx) =>
        issueLicense(tx, s.id, new Date(), { actor: LAZY }),
      );

    expect(await issue()).toEqual({
      licenseId: existing.id,
      code: existing.code,
    });
    const pending = await transferOf(s.id);
    expect(pending).toMatchObject({
      ...PENDING,
      currency: s.row.currency,
      amountCents: s.row.licensePriceCents,
    });
    expect(await issue()).toEqual({
      licenseId: existing.id,
      code: existing.code,
    });
    expect(await movementsOf(s.id)).toEqual([pending]);
    // Nothing asked of Stripe: the caller sends it after its commit.
    expect(scripted.log).toEqual([]);
  });
});

describe("failedTransferTotalCents (07 D75; 01 J8.16)", () => {
  onTheDouble();

  it("sums the creator's failed transfers only: not another creator's, not pending, succeeded or canceled ones, not a refund", async () => {
    const s = await transferSubject();
    const failed = {
      status: "failed",
      lastError: "test_permanent",
      attempt: 1,
    } as const;
    await insertMoneyMovement(s.row, failed);
    await insertMoneyMovement(s.row, {
      ...failed,
      kind: "buyer_refund",
      amountCents: s.row.amountTotalCents,
    });
    const floor = await insertLicenseRequest(s.live, {
      licensePriceCents: 1000,
      platformFeeCents: 200,
    });
    await insertMoneyMovement(floor, failed);
    await insertMoneyMovement(await insertLicenseRequest(s.live));
    const paid = await insertLicenseRequest(s.live);
    await insertMoneyMovement(paid, {
      status: "succeeded",
      stripeObjectId: `tr_fake_${paid.id}`,
      succeededAt: new Date(),
      attempt: 1,
    });
    await insertMoneyMovement(await insertLicenseRequest(s.live), {
      status: "canceled",
    });
    const other = await transferSubject();
    await insertMoneyMovement(other.row, failed);
    const { creator: none } = await approvingCreator();

    expect(await failedTransferTotalCents(s.creator.id)).toBe(PRICE + 1000);
    expect(await failedTransferTotalCents(other.creator.id)).toBe(PRICE);
    expect(await failedTransferTotalCents(none.id)).toBe(0);
  });
});

// The last case that looks up a driver: the USD one stays memoized once looked up (as in start-checkout.test.ts).
describe("another currency's account, on the fake driver (07 D94, D95; 03 I33)", () => {
  onTheFake();

  it("pays a USD request on the USD account only, under its own key", async () => {
    const before = env.ENABLED_CURRENCIES;
    env.ENABLED_CURRENCIES = ["cad", "usd"];
    try {
      const usd = paymentsDriver("usd");
      const usdTransfers = vi.spyOn(usd, "createTransfer");
      const usdLookups = vi.spyOn(usd, "findTransfers");
      const s = await transferSubject({ creator: { payoutCurrency: "usd" } });
      expect(s.row.currency).toBe("usd");
      const unchanged = await approveHeld(s);
      await runQueuedAfter();

      await expectPaidOnce(s.id, { by: "system", currency: "usd" });
      expect(usdTransfers).toHaveBeenCalledExactlyOnceWith({
        requestId: s.id,
        chargeId: `ch_fake_${s.id}`,
        destinationAccountId: s.account,
        amountCents: PRICE,
        idempotencyKey: `transfer:${s.id}:1`,
      });
      expect(usdLookups).toHaveBeenCalledExactlyOnceWith(s.id);
      expect(transfers).not.toHaveBeenCalled();
      expect(lookups).not.toHaveBeenCalled();
      // Each account knows only its own requests, as Stripe's do (PAY-07).
      await expect(findTransfers("cad", s.id)).rejects.toThrow(
        "a usd request on the cad account",
      );
      await unchanged();
    } finally {
      env.ENABLED_CURRENCIES = before;
    }
    // After every case above: no movement in another currency than its request's (03 I33).
    expect(
      await db
        .select({ id: moneyMovement.id })
        .from(moneyMovement)
        .innerJoin(
          licenseRequest,
          eq(licenseRequest.id, moneyMovement.licenseRequestId),
        )
        .where(ne(moneyMovement.currency, licenseRequest.currency)),
    ).toEqual([]);
  });
});
