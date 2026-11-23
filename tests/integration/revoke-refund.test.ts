import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/client";
import { emailLog, license, moneyMovement } from "../../src/db/schema";
import type { License, MoneyMovement } from "../../src/db/schema/types";
import type {
  MoneyMovementKind,
  RevokedReason,
} from "../../src/lib/domain/values";
import {
  creatorLicenseStatusLabel,
  revokedBuyerLine,
} from "../../src/lib/licensing/revoke-display";
import type { AdminActor } from "../../src/server/auth/actor";
import { getBuyerLicense } from "../../src/server/buyers/queries";
import { env } from "../../src/server/env";
import {
  LicenseNotFoundError,
  revokeLicense,
} from "../../src/server/licensing/issue";
import { listCreatorLicenses } from "../../src/server/licensing/licenses";
import {
  failedTransferTotalCents,
  MoneyMovementNotFoundError,
  PAYOUTS_NOT_ACTIVE,
  refundRevokedLicense,
  retryMoneyMovement,
  sendCreatorTransfer,
  sweepMoneyMovements,
  type TransferSource,
} from "../../src/server/licensing/money";
import {
  getRequestForCreator,
  listInbox,
} from "../../src/server/licensing/queries";
import { getPublicLicenseView } from "../../src/server/licensing/verify";
import { findTransfers, getAuthorization } from "../../src/server/payments";
import { createFakeDriver } from "../../src/server/payments/fake-driver";
import { findLicenseForBuyer } from "../../src/server/tokens/buyer-token";
import {
  dropQueuedAfter,
  flushAfter,
  queueAfter,
  runQueuedAfter,
} from "../helpers/after";
import {
  approvingCreatorWithVideo,
  PAID_SOCIAL_YEAR_WORLDWIDE,
} from "../helpers/approval-fixtures";
import { auditsOf } from "../helpers/connect-flow";
import { countsOf, cron } from "../helpers/cron";
import { resetDb } from "../helpers/db";
import {
  download,
  expectNotFound,
  type Issued,
  issue,
  issuedLicense,
  KINDS,
} from "../helpers/delivery";
import { newAdmin, requestRow } from "../helpers/factories";
import { AFTER_FAILED, captureLogEvents, recordStderr } from "../helpers/logs";
import { movementsOf, onlyLicense } from "../helpers/request-outcomes";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  finishRecordedTest,
  finishScriptedTest,
  installScriptedPayments,
  uninstallScriptedPayments,
} from "../helpers/scripted-suite";
import {
  approveCrashed,
  approveHeld,
  auditsFor,
  cronSweep,
  minutesAgo,
  PRICE,
  sourceOf,
  storedPayouts,
  touchedMinutesAgo,
  transferSubject,
  updateTransfer,
} from "../helpers/transfer-fixtures";

// Revoking a license with an automatic refund (P21b; 01 A.5, A.6, A.8, J9.6, J10.3; 02 §5.7, §5.8; 03 §5.3, §5.5,
// §7.10; 07 D24, D34, D75, D76, D86, D94, D95; owner answers OQ-13, OQ-18, Q-206, Q-207): revokeLicense commits the
// revoke fields, license.revoked and the money movements in one transaction, then refundRevokedLicense runs after the
// response: the refund step (the request's total), then the reversal step (the creator's transfer), whatever the
// refund's outcome, each claim → reconcile → one call keyed by the claim's attempt → fenced finish. Most cases run on
// the scripted double (Stripe's faults, its ledgers and the call log); the last describe runs on the fake driver itself
// for what it derives from rows. A case that sweeps or counts the cron starts from an empty database.

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

/** A describe on the scripted double: a fresh one for each test, the after() work watched for failures. */
function onTheDouble(): void {
  beforeEach(() => {
    scripted = installScriptedPayments();
    recordStderr(AFTER_FAILED);
  });
  afterEach(finishScriptedTest);
}

/** J4.7's total: what the buyer is refunded, service fee included (owner answer OQ-18). */
const TOTAL = PAID_SOCIAL_YEAR_WORLDWIDE.amountTotalCents;

const REFUNDED = "license.refund_succeeded";
const REVERSED = "license.reversal_succeeded";

/** revokeLicense, which must revoke now. */
async function revoke(
  admin: AdminActor,
  licenseId: string,
  reason: RevokedReason = "issued_in_error",
  note?: string,
): Promise<void> {
  expect(await revokeLicense(admin, licenseId, reason, note)).toEqual({
    ok: true,
    changed: true,
  });
}

/** The request's movements by kind. */
async function moneyOf(
  requestId: string,
): Promise<Partial<Record<MoneyMovementKind, MoneyMovement>>> {
  return Object.fromEntries(
    (await movementsOf(requestId)).map((row) => [row.kind, row]),
  );
}

/** The request's movement of `kind`: the test fails when there is none. */
async function movementOf(
  requestId: string,
  kind: MoneyMovementKind,
): Promise<MoneyMovement> {
  const row = (await moneyOf(requestId))[kind];
  if (!row) throw new Error(`no ${kind}`);
  return row;
}

/** A movement given back (or found given back): its Stripe id, claim cleared, no error. */
const returnedRow = (
  stripeObjectId: string,
  amountCents: number,
  attempt = 1,
) => ({
  status: "succeeded",
  stripeObjectId,
  amountCents,
  currency: "cad",
  attempt,
  claimedAt: null,
  lastError: null,
  succeededAt: expect.any(Date),
});

/** The license's audits, oldest first, except its issue; none names an account or carries an email (07 D47). */
const licenseAudits = (licenseId: string) =>
  auditsFor("license", licenseId, [
    "license.revoked",
    REFUNDED,
    REVERSED,
    "license.refund_failed",
    "license.reversal_failed",
  ]);

/** license.revoked as the admin wrote it: the reason and the code, never the note. */
const revokedAudit = (
  admin: AdminActor,
  l: License,
  reason: RevokedReason,
) => ({
  action: "license.revoked",
  data: { reason, code: l.code },
  actorType: "admin",
  actorUserId: admin.userId,
});

/** A success audit of the refund or the take-back, as the system's lazy run writes it. */
function returnedAudit(
  action: typeof REFUNDED | typeof REVERSED,
  movement: MoneyMovement,
  {
    attempt = 1,
    reconciled = false,
    source = "lazy",
  }: { attempt?: number; reconciled?: boolean; source?: TransferSource } = {},
) {
  const by = source === "cron" ? "cron" : "system";
  return {
    action,
    data: {
      movementId: movement.id,
      stripeObjectId: movement.stripeObjectId,
      attempt,
      amountCents: movement.amountCents,
      currency: "cad",
      reconciled,
      ...sourceOf(by, source),
    },
    actorType: by,
    actorUserId: null,
  };
}

/** A failure audit, as the system's lazy run writes it. */
const failedAudit = (
  action: "license.refund_failed" | "license.reversal_failed",
  movementId: string,
  code: string,
  amountCents: number,
  attempt = 1,
) => ({
  action,
  data: {
    movementId,
    code,
    attempt,
    amountCents,
    currency: "cad",
    source: "lazy",
  },
  actorType: "system",
  actorUserId: null,
});

/** Every email_log row: a revoke sends none (07 D34; license-revoked is [H5]). */
async function emailRows(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(emailLog);
  return row?.n ?? 0;
}

/** The license row now. */
async function licenseRow(id: string): Promise<License> {
  const [row] = await db.select().from(license).where(eq(license.id, id));
  if (!row) throw new Error("no license");
  return row;
}

/** The double's refunds and reversals as [key, currency], in order. */
const returnCalls = () =>
  scripted.log
    .filter(
      (call) => call.method === "refund" || call.method === "reverseTransfer",
    )
    .map(({ key, currency }) => [key, currency]);

describe("A.5: a revoke refunds the buyer and takes the transfer back (07 D86)", () => {
  onTheDouble();

  it("A.5 / A.8 ok/ok: one commit, then a full refund and a full take-back on the cad account, refund first", async () => {
    const { license: l, request, token } = await issuedLicense();
    const admin = await newAdmin();
    const emails = await emailRows();
    queueAfter();
    const calls = scripted.callsFromNow();

    await revoke(admin, l.id, "issued_in_error", "  ticket 7781  ");
    // Committed before any driver call (07 D24): the revoke fields, its audit and the pending movements.
    expect(calls()).toEqual([]);
    expect(await licenseRow(l.id)).toMatchObject({
      revokedAt: expect.any(Date),
      revokedReason: "issued_in_error",
      revokedNote: "ticket 7781",
      revokedByUserId: admin.userId,
      snapshot: l.snapshot,
    });
    expect(await licenseAudits(l.id)).toEqual([
      revokedAudit(admin, l, "issued_in_error"),
    ]);
    expect(await moneyOf(request.id)).toEqual({
      creator_transfer: expect.objectContaining({ status: "succeeded" }),
      buyer_refund: expect.objectContaining({
        status: "pending",
        currency: "cad",
        amountCents: TOTAL,
        attempt: 0,
      }),
      transfer_reversal: expect.objectContaining({
        status: "pending",
        currency: "cad",
        amountCents: PRICE,
        attempt: 0,
      }),
    });

    await runQueuedAfter();
    const refund = await movementOf(request.id, "buyer_refund");
    const reversal = await movementOf(request.id, "transfer_reversal");
    expect(refund).toMatchObject(returnedRow(`re_fake_${request.id}`, TOTAL));
    expect(reversal).toMatchObject(
      returnedRow(`trr_fake_${request.id}`, PRICE),
    );
    // Reconciled before each call; the refund step first, on the request's account (I33, 07 D95).
    expect(calls()).toEqual([
      "getAuthorization",
      "refund",
      "findTransfers",
      "reverseTransfer",
    ]);
    expect(returnCalls()).toEqual([
      [`refund:${request.id}:1`, "cad"],
      [`transfer-reversal:${request.id}:1`, "cad"],
    ]);
    expect(scripted.log.every((call) => call.currency === "cad")).toBe(true);
    expect(scripted.refunds).toEqual([
      expect.objectContaining({
        paymentIntentId: `pi_fake_${request.id}`,
        amountCents: TOTAL,
      }),
    ]);
    expect(await licenseAudits(l.id)).toEqual([
      revokedAudit(admin, l, "issued_in_error"),
      returnedAudit(REFUNDED, refund),
      returnedAudit(REVERSED, reversal),
    ]);

    // Nothing else moves (07 D34, D71): the request, the snapshot, no email.
    expect((await requestRow(request.id)).status).toBe("approved");
    expect((await licenseRow(l.id)).snapshot).toEqual(l.snapshot);
    expect(await emailRows()).toBe(emails);
    // J10.3 and J9.6: the record reads revoked and both downloads are gone.
    expect(await getPublicLicenseView(l.code)).toMatchObject({
      status: "revoked",
    });
    for (const kind of KINDS) expectNotFound(await download(token, kind));
  });

  it("A.8 refund ok + reversal permanent: the take-back fails once with its code, then admin Retry takes it back under attempt 2", async () => {
    await resetDb();
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    scripted.next("reverseTransfer", {
      kind: "permanent",
      code: "insufficient_funds",
    });

    await revoke(admin, l.id);
    await flushAfter();
    const refund = await movementOf(request.id, "buyer_refund");
    const failed = await movementOf(request.id, "transfer_reversal");
    expect(refund).toMatchObject(returnedRow(`re_fake_${request.id}`, TOTAL));
    expect(failed).toMatchObject({
      status: "failed",
      lastError: "insufficient_funds",
      attempt: 1,
      claimedAt: null,
      stripeObjectId: null,
    });
    expect(await licenseAudits(l.id)).toEqual([
      revokedAudit(admin, l, "issued_in_error"),
      returnedAudit(REFUNDED, refund),
      failedAudit(
        "license.reversal_failed",
        failed.id,
        "insufficient_funds",
        PRICE,
      ),
    ]);

    // A failed take-back waits for the admin (03 §7.10): the sweep leaves it.
    await touchedMinutesAgo(request.id, 11, "transfer_reversal");
    const calls = scripted.callsFromNow();
    expect(await cronSweep()).toBe(0);
    expect(calls()).toEqual([]);

    expect(await retryMoneyMovement(admin, failed.id)).toEqual({
      outcome: "succeeded",
    });
    expect(scripted.keys("reverseTransfer")).toEqual([
      `transfer-reversal:${request.id}:1`,
      `transfer-reversal:${request.id}:2`,
    ]);
    const reversal = await movementOf(request.id, "transfer_reversal");
    expect(reversal).toMatchObject(
      returnedRow(`trr_fake_${request.id}`, PRICE, 2),
    );
    expect(await auditsOf(failed.id, "money_movement.retried")).toEqual([
      {
        data: { movementId: failed.id, kind: "transfer_reversal" },
        actorType: "admin",
      },
    ]);
    expect((await licenseAudits(l.id)).at(-1)).toEqual(
      returnedAudit(REVERSED, reversal, { attempt: 2 }),
    );
  });

  it("A.8 refund transient: the claim let go, the take-back still runs, and a sweep refunds under the next key", async () => {
    await resetDb();
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    scripted.next("refund", "transient");
    const logged = captureLogEvents("money_movement.refund_retry");

    await revoke(admin, l.id);
    await flushAfter();
    expect(logged().events).toEqual([
      expect.objectContaining({
        requestId: request.id,
        attempt: 1,
        stripeCode: "StripeConnectionError",
      }),
    ]);
    expect(await movementOf(request.id, "buyer_refund")).toMatchObject({
      status: "pending",
      attempt: 1,
      claimedAt: null,
      stripeObjectId: null,
    });
    expect(await movementOf(request.id, "transfer_reversal")).toMatchObject(
      returnedRow(`trr_fake_${request.id}`, PRICE),
    );
    expect(returnCalls()).toEqual([
      [`refund:${request.id}:1`, "cad"],
      [`transfer-reversal:${request.id}:1`, "cad"],
    ]);

    // Tried just now: the cron's 10 minutes haven't passed.
    expect(await sweepMoneyMovements({ olderThanMinutes: 10, limit: 50 })).toBe(
      0,
    );
    expect(scripted.keys("refund")).toHaveLength(1);
    await touchedMinutesAgo(request.id, 1, "buyer_refund");
    expect(await sweepMoneyMovements({ olderThanMinutes: 0, limit: 50 })).toBe(
      1,
    );
    expect(scripted.keys("refund")).toEqual([
      `refund:${request.id}:1`,
      `refund:${request.id}:2`,
    ]);
    const refund = await movementOf(request.id, "buyer_refund");
    expect(refund).toMatchObject(
      returnedRow(`re_fake_${request.id}`, TOTAL, 2),
    );
    expect(scripted.keys("reverseTransfer")).toHaveLength(1);
    expect((await licenseAudits(l.id)).map(({ action }) => action)).toEqual([
      "license.revoked",
      REVERSED,
      REFUNDED,
    ]);
  });

  it("A.8 refund permanent (charge_disputed): failed and audited, the take-back still runs, the sweep leaves it, admin Retry refunds", async () => {
    await resetDb();
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    scripted.next("refund", { kind: "permanent", code: "charge_disputed" });

    await revoke(admin, l.id);
    await flushAfter();
    const failed = await movementOf(request.id, "buyer_refund");
    expect(failed).toMatchObject({
      status: "failed",
      lastError: "charge_disputed",
      attempt: 1,
      claimedAt: null,
    });
    const reversal = await movementOf(request.id, "transfer_reversal");
    expect(reversal).toMatchObject(
      returnedRow(`trr_fake_${request.id}`, PRICE),
    );
    expect(await licenseAudits(l.id)).toEqual([
      revokedAudit(admin, l, "issued_in_error"),
      failedAudit("license.refund_failed", failed.id, "charge_disputed", TOTAL),
      returnedAudit(REVERSED, reversal),
    ]);

    await touchedMinutesAgo(request.id, 11, "buyer_refund");
    expect(await sweepMoneyMovements({ olderThanMinutes: 0, limit: 50 })).toBe(
      0,
    );
    expect(scripted.keys("refund")).toEqual([`refund:${request.id}:1`]);

    expect(await retryMoneyMovement(admin, failed.id)).toEqual({
      outcome: "succeeded",
    });
    expect(scripted.keys("refund")).toEqual([
      `refund:${request.id}:1`,
      `refund:${request.id}:2`,
    ]);
    expect(await movementOf(request.id, "buyer_refund")).toMatchObject(
      returnedRow(`re_fake_${request.id}`, TOTAL, 2),
    );
  });

  it("A.8 a sweep for a pending refund leaves the license's failed take-back to admin Retry (03 §7.10)", async () => {
    await resetDb();
    const { license: l, request } = await issuedLicense();
    scripted.next("refund", "transient");
    scripted.next("reverseTransfer", {
      kind: "permanent",
      code: "insufficient_funds",
    });
    await revoke(await newAdmin(), l.id);
    await flushAfter();
    await touchedMinutesAgo(request.id, 11, "buyer_refund");

    expect(await cronSweep()).toBe(1);
    expect(scripted.keys("reverseTransfer")).toEqual([
      `transfer-reversal:${request.id}:1`,
    ]);
    expect(await movementOf(request.id, "transfer_reversal")).toMatchObject({
      status: "failed",
      attempt: 1,
      lastError: "insufficient_funds",
    });
    expect(await refundRevokedLicense(l.id)).toEqual({
      refund: { outcome: "noop" },
      reversal: { outcome: "noop" },
    });
  });

  it("A.8 a permanent refusal again on Retry fails with its code and writes no second failure audit", async () => {
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    const refusal = { kind: "permanent", code: "charge_disputed" } as const;
    scripted.next("refund", refusal, refusal);

    await revoke(admin, l.id);
    await flushAfter();
    const failed = await movementOf(request.id, "buyer_refund");
    expect(await retryMoneyMovement(admin, failed.id)).toEqual({
      outcome: "failed",
      code: "charge_disputed",
    });
    expect(await movementOf(request.id, "buyer_refund")).toMatchObject({
      status: "failed",
      attempt: 2,
      lastError: "charge_disputed",
    });
    expect(
      (await licenseAudits(l.id)).filter(
        ({ action }) => action === "license.refund_failed",
      ),
    ).toHaveLength(1);
  });

  it("A.8 an answer lost after Stripe refunded reconciles as refunded on the next run, never a second refund", async () => {
    await resetDb();
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    scripted.next("refund", "ambiguous");

    await revoke(admin, l.id);
    await flushAfter();
    expect(await movementOf(request.id, "buyer_refund")).toMatchObject({
      status: "pending",
      attempt: 1,
      claimedAt: null,
    });
    const made = `re_scripted_${request.id}_1`;
    expect(scripted.refunds).toEqual([
      expect.objectContaining({ refundId: made, amountCents: TOTAL }),
    ]);

    await touchedMinutesAgo(request.id, 11, "buyer_refund");
    expect(await cronSweep()).toBe(1);
    expect(scripted.keys("refund")).toEqual([`refund:${request.id}:1`]);
    const refund = await movementOf(request.id, "buyer_refund");
    expect(refund).toMatchObject(returnedRow(made, TOTAL, 2));
    expect(
      (await licenseAudits(l.id)).find(({ action }) => action === REFUNDED),
    ).toEqual(
      returnedAudit(REFUNDED, refund, {
        attempt: 2,
        reconciled: true,
        source: "cron",
      }),
    );
  });

  it("A.8 money already given back elsewhere (the Dashboard): no refund or reversal call, both finish with Stripe's ids (Q-206)", async () => {
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    const dashboardRefund = scripted.seedRefund({
      requestId: request.id,
      amountCents: TOTAL,
    });
    const dashboardReversal = scripted.seedReversal(`tr_fake_${request.id}`);

    await revoke(admin, l.id);
    await flushAfter();
    expect(scripted.callsOf("refund")).toEqual([]);
    expect(scripted.callsOf("reverseTransfer")).toEqual([]);
    const refund = await movementOf(request.id, "buyer_refund");
    const reversal = await movementOf(request.id, "transfer_reversal");
    expect(refund).toMatchObject(returnedRow(dashboardRefund.refundId, TOTAL));
    expect(reversal).toMatchObject(
      returnedRow(dashboardReversal.reversalId, PRICE),
    );
    expect(await licenseAudits(l.id)).toEqual([
      revokedAudit(admin, l, "issued_in_error"),
      returnedAudit(REFUNDED, refund, { reconciled: true }),
      returnedAudit(REVERSED, reversal, { reconciled: true }),
    ]);
  });

  it("A.8 a reconcile that throws lets the claim go and calls nothing; the next run gives the money back under the next key", async () => {
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    scripted.authorizations(new Error("stripe down"));
    scripted.transferLookups(new Error("stripe down"));
    const refundLookup = captureLogEvents(
      "money_movement.refund_lookup_failed",
    );

    await revoke(admin, l.id);
    await flushAfter();
    expect(refundLookup().events).toEqual([
      expect.objectContaining({ requestId: request.id, error: "Error" }),
    ]);
    expect(returnCalls()).toEqual([]);
    for (const kind of ["buyer_refund", "transfer_reversal"] as const) {
      expect(await movementOf(request.id, kind)).toMatchObject({
        status: "pending",
        attempt: 1,
        claimedAt: null,
      });
    }

    expect(await refundRevokedLicense(l.id)).toEqual({
      refund: { outcome: "succeeded" },
      reversal: { outcome: "succeeded" },
    });
    expect(returnCalls()).toEqual([
      [`refund:${request.id}:2`, "cad"],
      [`transfer-reversal:${request.id}:2`, "cad"],
    ]);
  });
});

describe("A.5: a transfer not sent yet is canceled, never reversed (07 D86; owner answers Q-207, Q-210)", () => {
  onTheDouble();

  // attempt 0: no call was ever made, so no take-back; above 0 (a transient answer left it pending, or a permanent one
  // failed it): money may be out, so the revoke writes the take-back, which finds nothing landed and ends canceled.
  for (const { status, attempt } of [
    { status: "pending", attempt: 0 },
    { status: "pending", attempt: 1 },
    { status: "failed", attempt: 1 },
  ] as const) {
    const owed = attempt > 0;
    it(`A.5 a ${status} transfer at attempt ${attempt} is canceled with ${owed ? "a take-back that finds nothing landed and ends canceled, no call" : "no take-back row"}; no sweep or send pays it after`, async () => {
      await resetDb();
      const s = await transferSubject();
      await approveCrashed(s);
      if (attempt > 0) {
        await updateTransfer(s.id, {
          status,
          lastError: status === "failed" ? "test_permanent" : null,
          attempt,
        });
      }
      if (status === "failed") {
        expect(await failedTransferTotalCents(s.creator.id)).toBe(PRICE);
      }
      const l = await onlyLicense(s.id);
      const admin = await newAdmin();

      await revoke(admin, l.id);
      const takeBack = {
        status: "pending",
        currency: "cad",
        amountCents: PRICE,
        attempt: 0,
      };
      expect(await moneyOf(s.id)).toEqual({
        creator_transfer: expect.objectContaining({
          status: "canceled",
          claimedAt: null,
        }),
        buyer_refund: expect.objectContaining({ status: "pending" }),
        ...(owed
          ? { transfer_reversal: expect.objectContaining(takeBack) }
          : {}),
      });
      // The creator's Banner no longer counts it (P19b's "Finish your payout setup to receive …").
      expect(await failedTransferTotalCents(s.creator.id)).toBe(0);

      const calls = scripted.callsFromNow();
      await runQueuedAfter();
      expect(await moneyOf(s.id)).toEqual({
        creator_transfer: expect.objectContaining({ status: "canceled" }),
        buyer_refund: expect.objectContaining(
          returnedRow(`re_fake_${s.id}`, TOTAL),
        ),
        ...(owed
          ? {
              transfer_reversal: expect.objectContaining({
                status: "canceled",
                attempt: 1,
                claimedAt: null,
                lastError: null,
                stripeObjectId: null,
              }),
            }
          : {}),
      });
      // The take-back reconciled (or had no row) and found nothing out: no call, and no audit of it.
      expect(calls()).toEqual([
        "getAuthorization",
        "refund",
        ...(owed ? ["findTransfers"] : []),
      ]);
      expect((await licenseAudits(l.id)).map(({ action }) => action)).toEqual([
        "license.revoked",
        REFUNDED,
      ]);

      // Payouts on and the row old enough for every sweep: nothing pays it.
      await storedPayouts(s.creator.id, "active");
      await touchedMinutesAgo(s.id, 11);
      expect(await cronSweep()).toBe(0);
      expect(
        await sweepMoneyMovements({ creatorId: s.creator.id, limit: 50 }),
      ).toBe(0);
      expect(await sendCreatorTransfer(s.id)).toBe("skipped");
      expect(scripted.callsOf("createTransfer")).toEqual([]);
      for (const kind of ["creator_transfer", "transfer_reversal"] as const) {
        const row = (await moneyOf(s.id))[kind];
        if (row) {
          expect(await retryMoneyMovement(admin, row.id)).toEqual({
            outcome: "noop",
          });
        }
      }
    });
  }

  it("A.5 a transfer in flight (a live claim) refuses the revoke and writes nothing (Q-207)", async () => {
    const s = await transferSubject();
    await approveCrashed(s);
    const l = await onlyLicense(s.id);
    const admin = await newAdmin();
    await updateTransfer(s.id, { attempt: 1, claimedAt: new Date() });
    const before = await movementsOf(s.id);
    const calls = scripted.callsFromNow();

    expect(await revokeLicense(admin, l.id, "rights_claim")).toEqual({
      ok: false,
      reason: "transfer_in_progress",
    });
    expect(await licenseRow(l.id)).toMatchObject({
      revokedAt: null,
      revokedReason: null,
      revokedNote: null,
      revokedByUserId: null,
    });
    expect(await licenseAudits(l.id)).toEqual([]);
    expect(await movementsOf(s.id)).toEqual(before);
    expect(calls()).toEqual([]);
  });

  it("A.5 a sender gone quiet past the lease: the revoke cancels its row, and a transfer that lands late is taken back", async () => {
    const s = await transferSubject();
    await approveCrashed(s);
    const l = await onlyLicense(s.id);
    const admin = await newAdmin();
    const held = scripted.hold("createTransfer");
    const sending = sendCreatorTransfer(s.id);
    await held.reached;

    // In flight: refused.
    expect(await revokeLicense(admin, l.id, "issued_in_error")).toEqual({
      ok: false,
      reason: "transfer_in_progress",
    });
    // The holder goes quiet past the 2-minute lease: the revoke cancels the row, clears the claim, and writes the
    // take-back, since a call was made (Q-210).
    await updateTransfer(s.id, { claimedAt: minutesAgo(3) });
    await revoke(admin, l.id);
    expect(await moneyOf(s.id)).toMatchObject({
      creator_transfer: { status: "canceled", claimedAt: null, attempt: 1 },
      transfer_reversal: { status: "pending", amountCents: PRICE },
    });

    // Its transfer lands, but its fenced finish can't overwrite the cancel; the take-back already waits.
    const lost = captureLogEvents("money_movement.finish_lost");
    held.release();
    expect(await sending).toBe("skipped");
    expect(lost().events).toHaveLength(1);
    expect(await movementOf(s.id, "creator_transfer")).toMatchObject({
      status: "canceled",
      stripeObjectId: null,
    });
    expect(await movementOf(s.id, "transfer_reversal")).toMatchObject({
      status: "pending",
      attempt: 0,
    });

    // The take-back reconciles, finds the money out and takes it back.
    await runQueuedAfter();
    expect(await movementOf(s.id, "transfer_reversal")).toMatchObject(
      returnedRow(`trr_fake_${s.id}`, PRICE),
    );
    expect(scripted.ledger).toEqual([
      expect.objectContaining({
        transferId: `tr_fake_${s.id}`,
        amountReversedCents: PRICE,
        reversalId: `trr_fake_${s.id}`,
      }),
    ]);
  });

  for (const answer of ["ok", "ambiguous"] as const) {
    it(`A.5 a stale sender's transfer that lands (${answer === "ok" ? "answered ok" : "its answer lost"}) after the revoke's take-back found nothing: the take-back reopens and a sweep reverses it (Q-210)`, async () => {
      await resetDb();
      const s = await transferSubject();
      await approveCrashed(s);
      const l = await onlyLicense(s.id);
      const admin = await newAdmin();
      if (answer === "ambiguous") scripted.next("createTransfer", "ambiguous");
      const held = scripted.hold("createTransfer");
      const sending = sendCreatorTransfer(s.id);
      await held.reached;
      await updateTransfer(s.id, { claimedAt: minutesAgo(3) });
      await revoke(admin, l.id);

      // The revoke's after-run goes first: nothing has landed yet, so the take-back ends canceled.
      await runQueuedAfter();
      expect(await movementOf(s.id, "transfer_reversal")).toMatchObject({
        status: "canceled",
        attempt: 1,
        claimedAt: null,
      });
      expect(scripted.callsOf("reverseTransfer")).toEqual([]);

      // Then the held transfer lands: its finish (or its release) finds the row canceled, and the take-back reopens.
      const late = captureLogEvents("money_movement.transfer_after_cancel");
      held.release();
      expect(await sending).toBe(answer === "ok" ? "skipped" : "retry");
      expect(late().events).toEqual([
        expect.objectContaining({ requestId: s.id, attempt: 1 }),
      ]);
      expect(await moneyOf(s.id)).toMatchObject({
        creator_transfer: { status: "canceled", stripeObjectId: null },
        transfer_reversal: {
          status: "pending",
          attempt: 1,
          claimedAt: null,
          lastError: null,
        },
      });
      const [landed] = scripted.ledger;
      expect(landed).toMatchObject({ requestId: s.id, amountReversedCents: 0 });

      // The cron takes it back under the next attempt's key.
      await touchedMinutesAgo(s.id, 11, "transfer_reversal");
      expect(await cronSweep()).toBe(1);
      expect(scripted.keys("reverseTransfer")).toEqual([
        `transfer-reversal:${s.id}:2`,
      ]);
      expect(await movementOf(s.id, "transfer_reversal")).toMatchObject(
        returnedRow(`trr_fake_${s.id}`, PRICE, 2),
      );
      expect(landed?.amountReversedCents).toBe(PRICE);
      // Nothing else moves: the creator transfer stays canceled, and no sweep pays it.
      expect(scripted.callsOf("createTransfer")).toHaveLength(1);
    });
  }
});

describe("A.5: Payment reversed makes no refund, and its take-back is written at the revoke (07 D86; owner answer Q-210)", () => {
  onTheDouble();

  it("A.5 payment_reversed with a transfer still out: no refund, the take-back written in the revoke's commit and reversed", async () => {
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    queueAfter();

    await revoke(admin, l.id, "payment_reversed");
    expect(await moneyOf(request.id)).toEqual({
      creator_transfer: expect.objectContaining({ status: "succeeded" }),
      transfer_reversal: expect.objectContaining({
        status: "pending",
        currency: "cad",
        amountCents: PRICE,
        attempt: 0,
      }),
    });
    await runQueuedAfter();
    expect(scripted.callsOf("refund")).toEqual([]);
    const money = await moneyOf(request.id);
    expect(money.buyer_refund).toBeUndefined();
    expect(money.transfer_reversal).toMatchObject(
      returnedRow(`trr_fake_${request.id}`, PRICE),
    );
    expect((await licenseAudits(l.id)).map(({ action }) => action)).toEqual([
      "license.revoked",
      REVERSED,
    ]);
  });

  it("A.5 payment_reversed with the transfer already taken back: the take-back finishes with Stripe's reversal id, no call (Q-206)", async () => {
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    const elsewhere = scripted.seedReversal(`tr_fake_${request.id}`);
    const calls = scripted.callsFromNow();

    await revoke(admin, l.id, "payment_reversed");
    await flushAfter();
    expect(calls()).toEqual(["findTransfers"]);
    const money = await moneyOf(request.id);
    expect(money.buyer_refund).toBeUndefined();
    const reversal = await movementOf(request.id, "transfer_reversal");
    expect(reversal).toMatchObject(returnedRow(elsewhere.reversalId, PRICE));
    expect(await licenseAudits(l.id)).toEqual([
      revokedAudit(admin, l, "payment_reversed"),
      returnedAudit(REVERSED, reversal, { reconciled: true }),
    ]);
  });

  it("A.5 payment_reversed whose take-back can't read Stripe after the response: the row stays pending and a later sweep takes it back (Q-210)", async () => {
    await resetDb();
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    scripted.transferLookups(new Error("stripe down"));
    const lookup = captureLogEvents("money_movement.reversal_lookup_failed");

    await revoke(admin, l.id, "payment_reversed");
    await flushAfter();
    expect(lookup().events).toEqual([
      expect.objectContaining({ requestId: request.id, error: "Error" }),
    ]);
    expect(await movementOf(request.id, "transfer_reversal")).toMatchObject({
      status: "pending",
      attempt: 1,
      claimedAt: null,
      stripeObjectId: null,
    });
    expect(scripted.callsOf("reverseTransfer")).toEqual([]);

    await touchedMinutesAgo(request.id, 11, "transfer_reversal");
    expect(await cronSweep()).toBe(1);
    expect(scripted.keys("reverseTransfer")).toEqual([
      `transfer-reversal:${request.id}:2`,
    ]);
    expect(await movementOf(request.id, "transfer_reversal")).toMatchObject(
      returnedRow(`trr_fake_${request.id}`, PRICE, 2),
    );
    expect(scripted.callsOf("refund")).toEqual([]);
  });

  it("A.5 a lost after-response run: the sweep alone takes back Payment reversed's transfer and settles a payout canceled after a call (Q-210)", async () => {
    await resetDb();
    const admin = await newAdmin();
    const reversed = await issuedLicense();
    const s = await transferSubject();
    await approveCrashed(s);
    // A call was made for this one before the revoke (its answer lost): the money may be out.
    await updateTransfer(s.id, { attempt: 1 });
    const canceled = await onlyLicense(s.id);

    await revoke(admin, reversed.license.id, "payment_reversed");
    await revoke(admin, canceled.id, "rights_claim");
    // The revokes' after() runs are lost, as a crash after the commits would lose them.
    expect(dropQueuedAfter()).toBe(2);
    expect(Object.keys(await moneyOf(reversed.request.id)).sort()).toEqual([
      "creator_transfer",
      "transfer_reversal",
    ]);
    expect(Object.keys(await moneyOf(s.id)).sort()).toEqual([
      "buyer_refund",
      "creator_transfer",
      "transfer_reversal",
    ]);

    await touchedMinutesAgo(reversed.request.id, 11, "transfer_reversal");
    await touchedMinutesAgo(s.id, 11, "buyer_refund");
    await touchedMinutesAgo(s.id, 11, "transfer_reversal");
    // Payment reversed's take-back and the other's refund went through; its take-back found nothing to take.
    expect(await cronSweep()).toBe(2);
    expect(
      await movementOf(reversed.request.id, "transfer_reversal"),
    ).toMatchObject(returnedRow(`trr_fake_${reversed.request.id}`, PRICE));
    expect(await movementOf(s.id, "buyer_refund")).toMatchObject(
      returnedRow(`re_fake_${s.id}`, TOTAL),
    );
    expect(await movementOf(s.id, "transfer_reversal")).toMatchObject({
      status: "canceled",
      attempt: 1,
      claimedAt: null,
    });
    expect(scripted.keys("reverseTransfer")).toEqual([
      `transfer-reversal:${reversed.request.id}:1`,
    ]);
    expect(scripted.keys("refund")).toEqual([`refund:${s.id}:1`]);
  });
});

describe("A.5: idempotency (07 D86)", () => {
  onTheDouble();

  it("A.5 a second revoke changes nothing: the first reason, one audit, one set of movements, no new call", async () => {
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    await revoke(admin, l.id, "issued_in_error");
    await flushAfter();
    const money = await movementsOf(request.id);
    const calls = scripted.callsFromNow();

    expect(
      await revokeLicense(await newAdmin(), l.id, "rights_claim", "again"),
    ).toEqual({ ok: true, changed: false });
    await flushAfter();
    expect(calls()).toEqual([]);
    expect(await licenseRow(l.id)).toMatchObject({
      revokedReason: "issued_in_error",
      revokedNote: null,
      revokedByUserId: admin.userId,
    });
    expect(await movementsOf(request.id)).toEqual(money);
    expect(
      (await licenseAudits(l.id)).filter(
        ({ action }) => action === "license.revoked",
      ),
    ).toHaveLength(1);
  });

  it("A.5 two revokes at once: one wins, one set of movements, one audit, one refund and one take-back", async () => {
    const { license: l, request } = await issuedLicense();
    const [first, second] = [await newAdmin(), await newAdmin()];

    const results = await Promise.all([
      revokeLicense(first, l.id, "rights_claim"),
      revokeLicense(second, l.id, "licensee_breach"),
    ]);
    await flushAfter();
    expect(results).toEqual(
      expect.arrayContaining([
        { ok: true, changed: true },
        { ok: true, changed: false },
      ]),
    );
    // The winner's reason, as the admin who won wrote it.
    const [firstWon] = results.map((r) => r.ok && r.changed);
    expect(await licenseRow(l.id)).toMatchObject(
      firstWon
        ? { revokedReason: "rights_claim", revokedByUserId: first.userId }
        : { revokedReason: "licensee_breach", revokedByUserId: second.userId },
    );
    expect(await movementsOf(request.id)).toHaveLength(3);
    expect(scripted.keys("refund")).toEqual([`refund:${request.id}:1`]);
    expect(scripted.keys("reverseTransfer")).toEqual([
      `transfer-reversal:${request.id}:1`,
    ]);
    expect(
      (await licenseAudits(l.id)).filter(
        ({ action }) => action === "license.revoked",
      ),
    ).toHaveLength(1);
  });

  it("A.5 two refundRevokedLicense runs at once make one refund and one take-back", async () => {
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    queueAfter();
    await revoke(admin, l.id);
    expect(dropQueuedAfter()).toBe(1);

    const runs = await Promise.all([
      refundRevokedLicense(l.id),
      refundRevokedLicense(l.id),
    ]);
    // One run gave each back; the other found it taken (in progress) or done (noop).
    expect(
      runs.filter(({ refund }) => refund.outcome === "succeeded"),
    ).toHaveLength(1);
    expect(
      runs.filter(({ reversal }) => reversal.outcome === "succeeded"),
    ).toHaveLength(1);
    expect(scripted.keys("refund")).toEqual([`refund:${request.id}:1`]);
    expect(scripted.keys("reverseTransfer")).toEqual([
      `transfer-reversal:${request.id}:1`,
    ]);
    expect(await refundRevokedLicense(l.id)).toEqual({
      refund: { outcome: "noop" },
      reversal: { outcome: "noop" },
    });
  });

  it("A.5 a license that isn't revoked gets nothing", async () => {
    const { license: l } = await issuedLicense();
    const calls = scripted.callsFromNow();
    expect(await refundRevokedLicense(l.id)).toEqual({
      refund: { outcome: "noop" },
      reversal: { outcome: "noop" },
    });
    expect(await refundRevokedLicense(randomUUID())).toEqual({
      refund: { outcome: "noop" },
      reversal: { outcome: "noop" },
    });
    expect(calls()).toEqual([]);
  });
});

describe("A.8: admin Retry (07 D75, D86; 02 §6.1 adminRetryMoneyMovement)", () => {
  onTheDouble();

  it("A.8 Retry of a failed creator transfer sends it under the next key; with payouts off it fails with payouts_not_active", async () => {
    const s = await transferSubject();
    await approveHeld(s);
    scripted.next("createTransfer", {
      kind: "permanent",
      code: "test_permanent",
    });
    await runQueuedAfter();
    const failed = await movementOf(s.id, "creator_transfer");
    expect(failed).toMatchObject({ status: "failed", attempt: 1 });
    const admin = await newAdmin();

    await storedPayouts(s.creator.id, "restricted");
    expect(await retryMoneyMovement(admin, failed.id)).toEqual({
      outcome: "failed",
      code: PAYOUTS_NOT_ACTIVE,
    });
    expect(scripted.keys("createTransfer")).toEqual([`transfer:${s.id}:1`]);

    await storedPayouts(s.creator.id, "active");
    expect(await retryMoneyMovement(admin, failed.id)).toEqual({
      outcome: "succeeded",
    });
    expect(scripted.keys("createTransfer")).toEqual([
      `transfer:${s.id}:1`,
      `transfer:${s.id}:2`,
    ]);
    expect(await movementOf(s.id, "creator_transfer")).toMatchObject({
      status: "succeeded",
      attempt: 2,
      stripeObjectId: `tr_fake_${s.id}`,
    });
    expect(await auditsOf(failed.id, "money_movement.retried")).toEqual([
      {
        data: { movementId: failed.id, kind: "creator_transfer" },
        actorType: "admin",
      },
      {
        data: { movementId: failed.id, kind: "creator_transfer" },
        actorType: "admin",
      },
    ]);
  });

  it("A.8 Retry of a transfer another claim took over and already finished answers in progress, never payouts_not_active", async () => {
    const s = await transferSubject();
    await approveHeld(s);
    const refusal = { kind: "permanent", code: "test_permanent" } as const;
    scripted.next("createTransfer", refusal, refusal);
    await runQueuedAfter();
    const failed = await movementOf(s.id, "creator_transfer");
    expect(failed).toMatchObject({ status: "failed", attempt: 1 });
    const admin = await newAdmin();
    // As the Retry's send reaches Stripe, another sender takes the row over (the lease ran out) and fails it first.
    scripted.onCall(
      "createTransfer",
      () =>
        updateTransfer(s.id, {
          attempt: 3,
          claimedAt: null,
          lastError: "test_permanent",
        }),
      { phase: "before", times: 1 },
    );

    expect(await retryMoneyMovement(admin, failed.id)).toEqual({
      outcome: "in_progress",
    });
    expect(scripted.keys("createTransfer")).toEqual([
      `transfer:${s.id}:1`,
      `transfer:${s.id}:2`,
    ]);
    expect(await movementOf(s.id, "creator_transfer")).toMatchObject({
      status: "failed",
      attempt: 3,
      claimedAt: null,
    });
  });

  it("A.8 Retry is a no-op on a succeeded movement, in progress under a live claim, and refuses an unknown id", async () => {
    const { license: l, request } = await issuedLicense();
    const admin = await newAdmin();
    await revoke(admin, l.id);
    await flushAfter();
    const refund = await movementOf(request.id, "buyer_refund");
    const calls = scripted.callsFromNow();

    expect(await retryMoneyMovement(admin, refund.id)).toEqual({
      outcome: "noop",
    });
    await db
      .update(moneyMovement)
      .set({
        status: "failed",
        lastError: "manual_test",
        succeededAt: null,
        stripeObjectId: null,
        claimedAt: new Date(),
      })
      .where(eq(moneyMovement.id, refund.id));
    expect(await retryMoneyMovement(admin, refund.id)).toEqual({
      outcome: "in_progress",
    });
    expect(calls()).toEqual([]);
    expect(await auditsOf(refund.id, "money_movement.retried")).toEqual([]);
    await expect(retryMoneyMovement(admin, randomUUID())).rejects.toThrow(
      MoneyMovementNotFoundError,
    );
    await expect(retryMoneyMovement(admin, "not-an-id")).rejects.toThrow(
      MoneyMovementNotFoundError,
    );
    // A failed refund whose money Stripe already gave back: Retry reconciles and finishes with its id, no call.
    await db
      .update(moneyMovement)
      .set({ claimedAt: null })
      .where(eq(moneyMovement.id, refund.id));
    expect(await retryMoneyMovement(admin, refund.id)).toEqual({
      outcome: "succeeded",
    });
    expect(calls()).toEqual(["getAuthorization"]);
    expect(await movementOf(request.id, "buyer_refund")).toMatchObject(
      returnedRow(`re_fake_${request.id}`, TOTAL, 2),
    );
  });
});

describe("A.5: the cron and the batch (02 §8.4; 03 §7.10)", () => {
  onTheDouble();

  it("A.8 the cron counts a refund it gave back in moneyMovements", async () => {
    await resetDb();
    const { license: l, request } = await issuedLicense();
    scripted.next("refund", "transient");
    await revoke(await newAdmin(), l.id);
    await flushAfter();
    await touchedMinutesAgo(request.id, 11, "buyer_refund");

    expect(await countsOf(await cron())).toMatchObject({
      moneyMovements: 1,
    });
    expect(await movementOf(request.id, "buyer_refund")).toMatchObject(
      returnedRow(`re_fake_${request.id}`, TOTAL, 2),
    );
  });

  it("A.8 refunds go first and share the batch: the count never passes the limit", async () => {
    await resetDb();
    const admin = await newAdmin();
    const owner = await approvingCreatorWithVideo();
    const a = await issue(owner);
    const b = await issue(owner);
    scripted.next("refund", "transient", "transient");
    await revoke(admin, a.license.id);
    await revoke(admin, b.license.id);
    await flushAfter();
    await touchedMinutesAgo(a.request.id, 12, "buyer_refund");
    await touchedMinutesAgo(b.request.id, 11, "buyer_refund");

    expect(await sweepMoneyMovements({ olderThanMinutes: 10, limit: 1 })).toBe(
      1,
    );
    expect(scripted.keys("refund").slice(2)).toEqual([
      `refund:${a.request.id}:2`,
    ]);
    expect(await sweepMoneyMovements({ olderThanMinutes: 10, limit: 1 })).toBe(
      1,
    );
    expect(scripted.keys("refund").slice(3)).toEqual([
      `refund:${b.request.id}:2`,
    ]);
    expect(scripted.callsOf("createTransfer")).toHaveLength(2);
  });
});

describe("J9.6, J9.8: what the buyer and the creator read after a revoke (03 §7.6, §7.8; owner answer Q-209)", () => {
  onTheDouble();

  /** The buyer's reads of the license: the buyer link's and the signed-in session's. */
  async function buyerReads(i: Issued) {
    return [
      await findLicenseForBuyer(i.token),
      await getBuyerLicense({ email: i.request.buyerEmail }, i.license.id),
    ];
  }

  /** The creator's reads: the license row of /dashboard/licenses, and the request as the Inbox and its page read it. */
  async function creatorReads(i: Issued) {
    const { creatorId, id } = i.request;
    const licenses = await listCreatorLicenses(creatorId);
    return {
      license: licenses.find((row) => row.id === i.license.id),
      history: (await listInbox(creatorId, "history")).find(
        (row) => row.id === id,
      ),
      page: await getRequestForCreator(creatorId, id),
    };
  }

  it("J9.6 / J9.8: a refund pending reads no refund; once given back, the buyer reads refunded and the creator «Revoked · refunded» and Taken back", async () => {
    const i = await issuedLicense();
    const admin = await newAdmin();
    for (const read of await buyerReads(i)) {
      expect(read?.refunded).toBe(false);
    }
    queueAfter();
    await revoke(admin, i.license.id);

    for (const read of await buyerReads(i)) {
      expect(read?.refunded).toBe(false);
    }
    let creator = await creatorReads(i);
    expect(creator.license).toMatchObject({
      status: "revoked",
      refunded: false,
      payout: { transferStatus: "succeeded", takenBack: false },
    });

    await runQueuedAfter();
    const [link, session] = await buyerReads(i);
    for (const read of [link, session]) {
      expect(read?.refunded).toBe(true);
    }
    expect(
      revokedBuyerLine({
        revokedAt: link?.license.revokedAt ?? new Date(),
        refunded: link?.refunded ?? false,
        totalCents: link?.request.amountTotalCents ?? 0,
        currency: link?.request.currency ?? "cad",
      }),
    ).toMatch(/^Revoked on .+ UTC\. You were refunded CA\$1,732\.50\.$/);
    // The buyer's read carries whether it was refunded alone: never a Stripe id or the movement's row.
    expect(JSON.stringify(link)).not.toMatch(/re_fake_|trr_fake_|tr_fake_/);

    creator = await creatorReads(i);
    expect(creator.license).toMatchObject({
      status: "revoked",
      refunded: true,
      payout: { transferStatus: "succeeded", takenBack: true },
    });
    for (const request of [creator.history, creator.page]) {
      expect(request).toMatchObject({
        transferStatus: "succeeded",
        takenBack: true,
      });
    }
    expect(
      creatorLicenseStatusLabel({
        status: "revoked",
        refunded: creator.license?.refunded ?? false,
      }).label,
    ).toBe("Revoked · refunded");
    expect(JSON.stringify(creator)).not.toMatch(/re_fake_|trr_fake_|tr_fake_/);
  });

  it("J9.6: Payment reversed has no refund to read; the creator's pill stays Revoked", async () => {
    const i = await issuedLicense();
    const admin = await newAdmin();
    await revoke(admin, i.license.id, "payment_reversed");
    await flushAfter();
    for (const read of await buyerReads(i)) {
      expect(read?.refunded).toBe(false);
    }
    const { license } = await creatorReads(i);
    expect(license).toMatchObject({
      status: "revoked",
      refunded: false,
      payout: { takenBack: true },
    });
  });
});

describe("A.5: who may revoke or retry (07 D86)", () => {
  onTheDouble();

  it("A.5 a creator actor is refused by revokeLicense and retryMoneyMovement, and nothing is written", async () => {
    const owner = await approvingCreatorWithVideo();
    const { license: l, request } = await issue(owner);
    const transfer = await movementOf(request.id, "creator_transfer");
    const calls = scripted.callsFromNow();

    await expect(
      revokeLicense(owner.actor, l.id, "rights_claim"),
    ).rejects.toThrow("an admin actor is required");
    await expect(retryMoneyMovement(owner.actor, transfer.id)).rejects.toThrow(
      "an admin actor is required",
    );
    expect((await licenseRow(l.id)).revokedAt).toBeNull();
    expect(await licenseAudits(l.id)).toEqual([]);
    expect(await auditsOf(transfer.id, "money_movement.retried")).toEqual([]);
    expect(calls()).toEqual([]);
  });

  it("A.5 an unknown license id throws LicenseNotFoundError", async () => {
    const admin = await newAdmin();
    await expect(
      revokeLicense(admin, randomUUID(), "rights_claim"),
    ).rejects.toThrow(LicenseNotFoundError);
    await expect(
      revokeLicense(admin, "not-an-id", "rights_claim"),
    ).rejects.toThrow(LicenseNotFoundError);
  });
});

describe("the fake driver's refund and take-back, derived from rows (07 D35, D76, D95; Q-206)", () => {
  beforeEach(() => {
    uninstallScriptedPayments();
    recordStderr(AFTER_FAILED);
  });
  afterEach(() => finishRecordedTest());

  it("A.5 refunds re_fake_ and reverses trr_fake_, then reports both back from the rows; another account refuses them", async () => {
    const { license: l, request } = await issuedLicense();
    const pi = `pi_fake_${request.id}`;
    expect(await getAuthorization("cad", pi)).toMatchObject({
      amountRefundedCents: 0,
      refundId: null,
    });
    expect(await findTransfers("cad", request.id)).toEqual([
      expect.objectContaining({ amountReversedCents: 0, reversalId: null }),
    ]);

    await revoke(await newAdmin(), l.id);
    await flushAfter();
    expect(await movementOf(request.id, "buyer_refund")).toMatchObject(
      returnedRow(`re_fake_${request.id}`, TOTAL),
    );
    expect(await movementOf(request.id, "transfer_reversal")).toMatchObject(
      returnedRow(`trr_fake_${request.id}`, PRICE),
    );
    expect(await getAuthorization("cad", pi)).toMatchObject({
      status: "succeeded",
      amountRefundedCents: TOTAL,
      refundId: `re_fake_${request.id}`,
    });
    expect(await findTransfers("cad", request.id)).toEqual([
      expect.objectContaining({
        transferId: `tr_fake_${request.id}`,
        amountCents: PRICE,
        amountReversedCents: PRICE,
        reversalId: `trr_fake_${request.id}`,
      }),
    ]);

    // Like Stripe, the USD account knows nothing of a CAD request (07 D95).
    const usd = createFakeDriver({ currency: "usd", appUrl: env.APP_URL });
    await expect(
      usd.refund({
        requestId: request.id,
        paymentIntentId: pi,
        idempotencyKey: `refund:${request.id}:9`,
      }),
    ).rejects.toThrow("a cad request on the usd account");
    await expect(
      usd.reverseTransfer({
        requestId: request.id,
        transferId: `tr_fake_${request.id}`,
        idempotencyKey: `transfer-reversal:${request.id}:9`,
      }),
    ).rejects.toThrow("a cad request on the usd account");
  });
});
