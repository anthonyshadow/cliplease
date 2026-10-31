import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendCreatorTransfer } from "../../src/server/licensing/money";
import { resetDb } from "../helpers/db";
import { AFTER_FAILED, recordStderr } from "../helpers/logs";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";
import {
  approveCrashed,
  cronSweep,
  paidAudit,
  refusedAudit,
  storedPayouts,
  type TransferSubject,
  touchedMinutesAgo,
  transferAudits,
  transferOf,
  transferSubject,
} from "../helpers/transfer-fixtures";

// The cron's retry of a failed transfer the creator can fix (P19b; 02 §8.4; 03 §7.10; 07 D75; owner answer Q-148):
// CREATOR_FIXABLE_TRANSFER_CODES is empty until P24's spike lists the codes, so this file mocks it with one test code.
// The cron sweep sends a failed transfer again only for such a code, once the cool-down has passed, and only while the
// creator's payouts are on or due a fresh reading; any other failure waits for Settings or the admin. The sweeps are
// global: each case starts from an empty database. The payments driver is the scripted double.

vi.mock("@/server/payments/driver", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/payments/driver")>()),
  CREATOR_FIXABLE_TRANSFER_CODES: ["test_fixable"],
}));

vi.mock("@/server/payments/registry", async (importOriginal) =>
  (await import("../helpers/scripted-suite")).scriptedRegistry(
    await importOriginal<typeof import("@/server/payments/registry")>(),
  ),
);

// after() holds its tasks once a test calls queueAfter(): Approve's transfer is dropped, as a crash would lose it.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("../helpers/after")).runAfter,
}));

let scripted: ScriptedPayments;

beforeEach(() => {
  scripted = installScriptedPayments();
  recordStderr(AFTER_FAILED);
});
afterEach(finishScriptedTest);

/**
 * A request approved with its transfer refused for good with `code` on attempt 1, then left 11 minutes: past the cool-
 * down and the cron's 10. Returns the check that the request's claim and license stay as Approve left them.
 */
async function refusedWith(s: TransferSubject, code: string) {
  const unchanged = await approveCrashed(s);
  scripted.next("createTransfer", { kind: "permanent", code });
  expect(await sendCreatorTransfer(s.id)).toBe("failed");
  expect(await transferOf(s.id)).toMatchObject({
    status: "failed",
    lastError: code,
    attempt: 1,
    claimedAt: null,
  });
  await touchedMinutesAgo(s.id, 11);
  return unchanged;
}

describe("the cron retries a failed transfer the creator can fix (Q-148; CC-03)", () => {
  it("a creator-fixable code with payouts on: sent again under the next key, and paid", async () => {
    await resetDb();
    const s = await transferSubject();
    const unchanged = await refusedWith(s, "test_fixable");

    expect(await cronSweep()).toBe(1);
    expect(scripted.keys("createTransfer")).toEqual([
      `transfer:${s.id}:1`,
      `transfer:${s.id}:2`,
    ]);
    const sent = `tr_fake_${s.id}`;
    expect(await transferOf(s.id)).toMatchObject({
      status: "succeeded",
      stripeObjectId: sent,
      attempt: 2,
      lastError: null,
    });
    expect(await transferAudits(s.id)).toEqual([
      refusedAudit("test_fixable", 1),
      paidAudit(sent, 2, { by: "cron" }),
    ]);
    await unchanged();
  });

  it("any other code: left for Settings and the admin, with no call to Stripe", async () => {
    await resetDb();
    const s = await transferSubject();
    const unchanged = await refusedWith(s, "test_permanent");
    const calls = scripted.log.length;

    expect(await cronSweep()).toBe(0);
    expect(scripted.log.slice(calls)).toEqual([]);
    expect(await transferOf(s.id)).toMatchObject({
      status: "failed",
      lastError: "test_permanent",
      attempt: 1,
    });
    await unchanged();
  });

  it("a creator-fixable code while payouts are known to be off: left alone, with no call to Stripe", async () => {
    await resetDb();
    const s = await transferSubject();
    const unchanged = await refusedWith(s, "test_fixable");
    await storedPayouts(s.creator.id, "restricted");
    const calls = scripted.log.length;

    expect(await cronSweep()).toBe(0);
    expect(scripted.log.slice(calls)).toEqual([]);
    expect(await transferOf(s.id)).toMatchObject({
      status: "failed",
      lastError: "test_fixable",
      attempt: 1,
    });
    await unchanged();
  });
});
