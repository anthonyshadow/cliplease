import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCheckoutPay } from "../../src/app/dev/fake-checkout/[requestId]/actions";
import { db } from "../../src/db/client";
import { emailLog, licenseRequest } from "../../src/db/schema";
import type { NewCreatorProfile, Video } from "../../src/db/schema/types";
import {
  autoApproveRequest,
  retryAutoApprovals,
} from "../../src/server/licensing/auto-approve";
import { settleCreatorRequests } from "../../src/server/licensing/lazy";
import { listInbox } from "../../src/server/licensing/queries";
import { getBuyerRequest } from "../../src/server/licensing/request-status";
import {
  claimPaymentAction,
  reconcileStuckClaims,
} from "../../src/server/licensing/state-machine";
import { redirectTo } from "../helpers/actions";
import {
  dropQueuedAfter,
  flushAfter,
  queueAfter,
  runQueuedAfter,
} from "../helpers/after";
import {
  approvableVideo,
  approvingCreator,
  authorizedMinutesAgo,
  claimedMinutesAgo,
  overdue,
  PAID_SOCIAL_YEAR_WORLDWIDE,
  pendingCheckoutRequest,
  waitingRequest,
} from "../helpers/approval-fixtures";
import { auditsOf } from "../helpers/connect-flow";
import { insertLicense, requestRow } from "../helpers/factories";
import { AFTER_FAILED, recordStderr } from "../helpers/logs";
import {
  endingsOf,
  licensesOf,
  movementsOf,
  onlyLicense,
} from "../helpers/request-outcomes";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";
import { expectPaidOnce, minutesAgo } from "../helpers/transfer-fixtures";

// Auto-approve's retries (P19c; 03 §7.10; 07 D26, D34, D81; owner answers Q-154, Q-156; AD-13, AD-17, AD-19, AD-33):
// which requests retryAutoApprovals takes (2 minutes after authorization, no fallback, no claim, time left, oldest
// first, `limit`, `stopAt`, one request), the give-up read first for a request reached 10 minutes after authorization,
// the outcomes it doesn't count, the creator's lazy retry (the Inbox, the request page) and the buyer's (/r), an auto
// claim left stuck, a capture refused for good or finished late, and a Pay that abandons and schedules nothing. The
// payments driver is the scripted double. Each case has its own creator and counts with creatorId-scoped calls.

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

// Codes a test hands out first (a taken one, say); the real generator after that.
const codes = vi.hoisted(() => ({ next: [] as string[] }));
vi.mock("@/server/codes/license-code", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/server/codes/license-code")>();
  return {
    ...real,
    generateLicenseCode: () => codes.next.shift() ?? real.generateLicenseCode(),
  };
});

// Counted, never replaced; requests.ts gets the spy only if it loads first: keep fakeCheckoutPay the first src import.
vi.mock("@/server/licensing/auto-approve", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/server/licensing/auto-approve")>();
  return { ...real, autoApproveRequest: vi.fn(real.autoApproveRequest) };
});

let scripted: ScriptedPayments;
beforeEach(() => {
  scripted = installScriptedPayments();
  codes.next = [];
  vi.mocked(autoApproveRequest).mockClear();
  recordStderr(AFTER_FAILED);
});
afterEach(finishScriptedTest);

/** A creator who can approve (`overrides` go into the profile) and their published video. */
async function autoCreator(overrides: Partial<NewCreatorProfile> = {}) {
  const { creator } = await approvingCreator(overrides);
  return { creator, live: await approvableVideo(creator.id) };
}

/**
 * An auto_approve request waiting on `live` at J4.7's quote, authorized `minutes` ago on the database's clock. T2 is
 * applied directly, so nothing is scheduled: only the retry under test reaches it.
 */
async function autoRequest(live: Video, minutes: number) {
  const { row, token } = await waitingRequest(live, {
    autoApprove: true,
    ...PAID_SOCIAL_YEAR_WORLDWIDE,
  });
  await authorizedMinutesAgo(row.id, minutes);
  return { id: row.id, token };
}

/** Request `id` handed to its creator, as a fallback leaves the row (its email and audit aside). */
async function fellBack(id: string): Promise<void> {
  await db
    .update(licenseRequest)
    .set({ autoApproveFallbackAt: sql`now()` })
    .where(eq(licenseRequest.id, id));
}

/** A mark in the double's log: the returned function gives the methods called since, in order. */
function callsFromNow(): () => string[] {
  const from = scripted.log.length;
  return () => scripted.log.slice(from).map(({ method }) => method);
}

/** What a guard or Approve asks Stripe: the payouts reading, the hold, the capture. */
const GUARD_CALLS: readonly string[] = [
  "fetchPayoutsStatus",
  "getAuthorization",
  "capture",
];

const fallbacksOf = (id: string) =>
  auditsOf(id, "license_request.auto_approve_fallback");

/** A retry's fallback 10 minutes after authorization, as audited (AD-16). */
const GAVE_UP = {
  data: { reason: "gave_up", source: "auto_approve" },
  actorType: "system",
};

/** The request's email templates, in order: request-new and request-received included (outcomeEmails drops them). */
async function emailTemplatesOf(requestId: string): Promise<string[]> {
  const rows = await db
    .select({ template: emailLog.template })
    .from(emailLog)
    .where(eq(emailLog.entityId, requestId))
    .orderBy(emailLog.template);
  return rows.map((r) => r.template);
}

/** The ending an automatic approval writes: T5 as the auto-approve system (03 T4). */
const AUTO_APPROVED = {
  data: {
    from: "awaiting_approval",
    to: "approved",
    event: "captured",
    source: "auto_approve",
  },
  actorType: "system",
};

describe("retryAutoApprovals' candidates (03 §7.10; AD-17)", () => {
  it("takes only waiting auto requests authorized 2 minutes ago or more, with no fallback, no claim and time left, oldest first", async () => {
    const { creator, live } = await autoCreator();
    const e1 = await autoRequest(live, 5);
    const e2 = await autoRequest(live, 3);
    const { row: manual } = await waitingRequest(
      live,
      PAID_SOCIAL_YEAR_WORLDWIDE,
    );
    await authorizedMinutesAgo(manual.id, 5);
    const fallen = await autoRequest(live, 5);
    await fellBack(fallen.id);
    const claimed = await autoRequest(live, 5);
    expect(
      await claimPaymentAction(claimed.id, "capture", {
        autoApproveOnly: true,
      }),
    ).not.toBeNull();
    const late = await autoRequest(live, 5);
    await overdue(late.id);
    const recent = await autoRequest(live, 1);
    const other = await autoCreator();
    const theirs = await autoRequest(other.live, 3);
    const others = [
      manual.id,
      fallen.id,
      claimed.id,
      late.id,
      recent.id,
      theirs.id,
    ];
    const before = await Promise.all(others.map((id) => requestRow(id)));

    expect(await retryAutoApprovals({ limit: 50, creatorId: creator.id })).toBe(
      2,
    );
    expect(scripted.keys("capture")).toEqual([
      `pi-capture:${e1.id}:1`,
      `pi-capture:${e2.id}:1`,
    ]);
    for (const { id } of [e1, e2]) {
      expect(await requestRow(id)).toMatchObject({
        status: "approved",
        autoApproveFallbackAt: null,
      });
      expect(await endingsOf(id)).toEqual([AUTO_APPROVED]);
    }
    expect(await Promise.all(others.map((id) => requestRow(id)))).toEqual(
      before,
    );
    // A retry's approval pays the creator as the auto-approve system, not the lazy one.
    await flushAfter();
    for (const { id } of [e1, e2]) {
      await expectPaidOnce(id, { by: "system", source: "auto_approve" });
    }
  });

  it("takes no more than `limit`: the oldest authorization", async () => {
    const { creator, live } = await autoCreator();
    const older = await autoRequest(live, 4);
    const newer = await autoRequest(live, 3);
    const untouched = await requestRow(newer.id);
    expect(await retryAutoApprovals({ limit: 1, creatorId: creator.id })).toBe(
      1,
    );
    expect((await requestRow(older.id)).status).toBe("approved");
    expect(await requestRow(newer.id)).toEqual(untouched);
    expect(scripted.keys("capture")).toEqual([`pi-capture:${older.id}:1`]);
  });

  it("starts no request at or after stopAt", async () => {
    const { creator, live } = await autoCreator();
    const { id } = await autoRequest(live, 3);
    const untouched = await requestRow(id);
    const calls = callsFromNow();
    expect(
      await retryAutoApprovals({
        limit: 50,
        creatorId: creator.id,
        stopAt: Date.now() - 1,
      }),
    ).toBe(0);
    expect(await requestRow(id)).toEqual(untouched);
    expect(calls()).toEqual([]);
  });

  it("with requestId, takes only that request, however old the others (/r's retry)", async () => {
    const { live } = await autoCreator();
    const older = await autoRequest(live, 5);
    const target = await autoRequest(live, 3);
    const untouched = await requestRow(older.id);
    expect(await retryAutoApprovals({ requestId: target.id, limit: 1 })).toBe(
      1,
    );
    expect((await requestRow(target.id)).status).toBe("approved");
    expect(await requestRow(older.id)).toEqual(untouched);
    expect(scripted.keys("capture")).toEqual([`pi-capture:${target.id}:1`]);
  });
});

describe("the give-up read first (owner answer Q-154; CC-01)", () => {
  it("falls back a request first reached 10 minutes or more after authorization with gave_up: no guard, no Stripe call", async () => {
    // A stale payouts reading: a guard would have asked Stripe for a new one.
    const { creator, live } = await autoCreator({
      payoutsStatusSyncedAt: minutesAgo(11),
    });
    const { id } = await autoRequest(live, 11);
    const calls = callsFromNow();
    expect(await retryAutoApprovals({ limit: 50, creatorId: creator.id })).toBe(
      1,
    );
    expect(await requestRow(id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
      autoApproveFallbackAt: expect.any(Date),
    });
    expect(await fallbacksOf(id)).toEqual([GAVE_UP]);
    expect(await emailTemplatesOf(id)).toEqual([
      "request-new",
      "request-received",
    ]);
    await flushAfter();
    expect(calls()).toEqual([]);
    // Handed to the creator once: no longer a candidate.
    expect(await retryAutoApprovals({ limit: 50, creatorId: creator.id })).toBe(
      0,
    );
  });

  it("attempts one reached at 9 minutes: the guards, then Approve as the system", async () => {
    const { creator, live } = await autoCreator({
      payoutsStatusSyncedAt: minutesAgo(11),
    });
    const { id } = await autoRequest(live, 9);
    const calls = callsFromNow();
    expect(await retryAutoApprovals({ limit: 50, creatorId: creator.id })).toBe(
      1,
    );
    expect(await requestRow(id)).toMatchObject({
      status: "approved",
      autoApproveFallbackAt: null,
    });
    expect(await endingsOf(id)).toEqual([AUTO_APPROVED]);
    expect(await fallbacksOf(id)).toEqual([]);
    await flushAfter();
    expect(calls().filter((method) => GUARD_CALLS.includes(method))).toEqual([
      "fetchPayoutsStatus",
      "getAuthorization",
      "capture",
    ]);
    await expectPaidOnce(id, {
      by: "system",
      source: "auto_approve",
      scripted,
    });
  });
});

describe("what a retry doesn't count", () => {
  it("counts neither a transient capture ('retry') nor a hold Stripe already released ('skipped', AA-12)", async () => {
    const { creator, live } = await autoCreator();
    const transient = await autoRequest(live, 4);
    const released = await autoRequest(live, 3);
    scripted.next("capture", "transient");
    await scripted.movePi(`pi_fake_${released.id}`, "canceled");
    expect(await retryAutoApprovals({ limit: 50, creatorId: creator.id })).toBe(
      0,
    );
    // The transient capture: its claim released with the hold still on, nothing decided; a later retry tries again.
    expect(scripted.keys("capture")).toEqual([`pi-capture:${transient.id}:1`]);
    expect(await requestRow(transient.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 1,
      autoApproveFallbackAt: null,
    });
    // The released hold: its ending from Stripe's word, as the auto-approve system.
    expect(await requestRow(released.id)).toMatchObject({
      status: "expired",
      statusReason: "hold_released",
      autoApproveFallbackAt: null,
    });
    expect(await endingsOf(released.id)).toEqual([
      {
        data: {
          from: "awaiting_approval",
          to: "expired",
          event: "expired",
          source: "auto_approve",
        },
        actorType: "system",
      },
    ]);
    for (const { id } of [transient, released]) {
      expect(await fallbacksOf(id)).toEqual([]);
      expect(await emailTemplatesOf(id)).toEqual(["request-received"]);
    }
  });
});

describe("the creator's lazy retry (owner answer Q-156; AD-19)", () => {
  it("the Inbox retries its creator's auto requests after the response, and nobody else's", async () => {
    const x = await autoCreator();
    const y = await autoCreator();
    const mine = await autoRequest(x.live, 3);
    const theirs = await autoRequest(y.live, 3);
    const untouched = await requestRow(theirs.id);
    queueAfter();
    await settleCreatorRequests({ creatorId: x.creator.id });
    expect((await requestRow(mine.id)).status).toBe("awaiting_approval");
    await runQueuedAfter();
    expect((await requestRow(mine.id)).status).toBe("approved");
    expect(await requestRow(theirs.id)).toEqual(untouched);
    expect(scripted.keys("capture")).toEqual([`pi-capture:${mine.id}:1`]);
    await expectPaidOnce(mine.id, {
      by: "system",
      source: "auto_approve",
      scripted,
    });
  });

  it("the request page retries only its request, and only the creator's own", async () => {
    const x = await autoCreator();
    const y = await autoCreator();
    const page = await autoRequest(x.live, 3);
    const sibling = await autoRequest(x.live, 3);
    const theirs = await autoRequest(y.live, 3);
    const rest = [sibling.id, theirs.id];
    const untouched = await Promise.all(rest.map((id) => requestRow(id)));
    queueAfter();
    // Another creator's request id does nothing: the retry is scoped to the creator.
    await settleCreatorRequests({
      creatorId: x.creator.id,
      requestId: theirs.id,
    });
    await settleCreatorRequests({
      creatorId: x.creator.id,
      requestId: page.id,
    });
    await runQueuedAfter();
    expect((await requestRow(page.id)).status).toBe("approved");
    expect(await Promise.all(rest.map((id) => requestRow(id)))).toEqual(
      untouched,
    );
    expect(scripted.keys("capture")).toEqual([`pi-capture:${page.id}:1`]);
  });
});

describe("the buyer's lazy retry on /r (owner answer Q-156; AD-19)", () => {
  it("falls back a request reached 10 minutes after authorization: one request-new, then /r shows it waiting", async () => {
    const { live } = await autoCreator({
      payoutsStatusSyncedAt: minutesAgo(11),
    });
    const { id, token } = await autoRequest(live, 11);
    queueAfter();
    expect(await getBuyerRequest(id, token)).toMatchObject({
      status: "awaiting_approval",
      displayStatus: "processing",
      autoApproving: true,
    });
    const calls = callsFromNow();
    await runQueuedAfter();
    expect(calls()).toEqual([]);
    expect(await fallbacksOf(id)).toEqual([GAVE_UP]);
    expect(await emailTemplatesOf(id)).toEqual([
      "request-new",
      "request-received",
    ]);
    expect(await getBuyerRequest(id, token)).toMatchObject({
      status: "awaiting_approval",
      displayStatus: "awaiting_approval",
      autoApproving: false,
    });
    // A fallen-back request schedules nothing more.
    expect(dropQueuedAfter()).toBe(0);
  });

  it("approves one reached 3 minutes after authorization", async () => {
    const { live } = await autoCreator();
    const { id, token } = await autoRequest(live, 3);
    queueAfter();
    expect(await getBuyerRequest(id, token)).toMatchObject({
      displayStatus: "processing",
      autoApproving: true,
    });
    await runQueuedAfter();
    expect(await getBuyerRequest(id, token)).toMatchObject({
      status: "approved",
      displayStatus: "approved",
      autoApproving: false,
    });
    expect(dropQueuedAfter()).toBe(0);
    expect(scripted.keys("capture")).toEqual([`pi-capture:${id}:1`]);
    await expectPaidOnce(id, {
      by: "system",
      source: "auto_approve",
      scripted,
    });
  });

  it("leaves one authorized a minute ago to the run after T2: the 2-minute floor", async () => {
    const { live } = await autoCreator();
    const { id, token } = await autoRequest(live, 1);
    const untouched = await requestRow(id);
    queueAfter();
    expect(await getBuyerRequest(id, token)).toMatchObject({
      displayStatus: "processing",
      autoApproving: true,
    });
    const calls = callsFromNow();
    await runQueuedAfter();
    expect(await requestRow(id)).toEqual(untouched);
    expect(calls()).toEqual([]);
  });
});

describe("auto claims and captures that don't finish (07 D26, D34; AD-33)", () => {
  it("a stuck auto claim is the stuck-claim reconcile's: no retry while it holds, then a capture under a new key", async () => {
    const { creator, live } = await autoCreator();
    const { id } = await autoRequest(live, 3);
    expect(
      await claimPaymentAction(id, "capture", { autoApproveOnly: true }),
    ).not.toBeNull();
    await claimedMinutesAgo(id, 3);
    const calls = callsFromNow();
    expect(await retryAutoApprovals({ limit: 50, creatorId: creator.id })).toBe(
      0,
    );
    expect(calls()).toEqual([]);
    expect(
      await reconcileStuckClaims({ requestId: id, olderThanMinutes: 2 }),
    ).toBe(1);
    expect(await requestRow(id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 1,
    });
    expect(await retryAutoApprovals({ limit: 50, creatorId: creator.id })).toBe(
      1,
    );
    expect(scripted.keys("capture")).toEqual([`pi-capture:${id}:2`]);
    expect(await requestRow(id)).toMatchObject({
      status: "approved",
      stripeAttempt: 2,
    });
    await flushAfter();
    await expectPaidOnce(id, {
      by: "system",
      source: "auto_approve",
      scripted,
    });
  });

  it("a capture Stripe refuses for good ends capture_failed under T7: skipped, no fallback, nobody emailed", async () => {
    const { creator, live } = await autoCreator();
    const { id } = await autoRequest(live, 3);
    scripted.next("capture", { kind: "permanent", code: "card_declined" });
    expect(await autoApproveRequest(id)).toBe("skipped");
    expect(await requestRow(id)).toMatchObject({
      status: "capture_failed",
      statusReason: "capture_error:card_declined",
      autoApproveFallbackAt: null,
    });
    expect(scripted.keys("capture")).toEqual([`pi-capture:${id}:1`]);
    // T7's cancel under the capture claim taken again (07 D30): its own key.
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${id}:capture_failed:2`, "abandoned"],
    ]);
    expect(scripted.piStatus(`pi_fake_${id}`)).toBe("canceled");
    expect(await endingsOf(id)).toEqual([
      {
        data: {
          from: "awaiting_approval",
          to: "capture_failed",
          event: "capture_failed",
          source: "auto_approve",
        },
        actorType: "system",
      },
    ]);
    expect(await fallbacksOf(id)).toEqual([]);
    // capture_failed emails nobody in CORE (07 D34): only the authorization's request-received.
    await flushAfter();
    expect(await emailTemplatesOf(id)).toEqual(["request-received"]);
    expect(await licensesOf(id)).toEqual([]);
    expect(await movementsOf(id)).toEqual([]);
    expect(await retryAutoApprovals({ limit: 50, creatorId: creator.id })).toBe(
      0,
    );
  });

  it("a capture whose license can't be written keeps its claim; the stuck-claim reconcile finishes it as lazy, still Auto-approved", async () => {
    const { creator, live } = await autoCreator();
    const taken = (await insertLicense((await waitingRequest(live)).row)).code;
    const { id } = await autoRequest(live, 3);
    codes.next = [taken, taken, taken, taken, taken];
    expect(await autoApproveRequest(id)).toBe("skipped");
    expect(await requestRow(id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
      stripeAttempt: 1,
      autoApproveFallbackAt: null,
    });
    expect(await licensesOf(id)).toEqual([]);
    expect(await auditsOf(id, "license_request.issue_failed")).toEqual([
      { data: { error: "Error", source: "auto_approve" }, actorType: "system" },
    ]);
    expect(await fallbacksOf(id)).toEqual([]);

    // The holder died: once stuck, the reconcile issues the license from Stripe's succeeded.
    await claimedMinutesAgo(id, 3);
    codes.next = [];
    expect(
      await reconcileStuckClaims({ requestId: id, olderThanMinutes: 2 }),
    ).toBe(1);
    expect((await requestRow(id)).status).toBe("approved");
    await onlyLicense(id);
    expect(scripted.keys("capture")).toEqual([`pi-capture:${id}:1`]);
    expect(await endingsOf(id)).toEqual([
      {
        data: {
          from: "awaiting_approval",
          to: "approved",
          event: "captured",
          source: "lazy",
        },
        actorType: "system",
      },
    ]);
    await flushAfter();
    await expectPaidOnce(id, { by: "system", source: "lazy", scripted });
    expect(await listInbox(creator.id, "history")).toEqual([
      expect.objectContaining({ id, autoApproved: true }),
    ]);
  });
});

describe("Pay's schedule (AD-13; T3-08)", () => {
  it("an auto request abandoned at authorization schedules no automatic approval and emails nobody", async () => {
    const { live } = await autoCreator();
    const { row, token } = await pendingCheckoutRequest(live, {
      autoApprove: true,
      ...PAID_SOCIAL_YEAR_WORLDWIDE,
    });
    scripted.script({ getAuthorization: { amountCents: 1 } });
    queueAfter();
    await expect(fakeCheckoutPay(row.id)).rejects.toMatchObject(
      redirectTo(`/r/${row.id}?t=${token}&session_id=cs_fake_${row.id}`),
    );
    expect(await requestRow(row.id)).toMatchObject({
      status: "abandoned",
      statusReason: "amount_mismatch",
    });
    const calls = callsFromNow();
    await runQueuedAfter();
    expect(autoApproveRequest).not.toHaveBeenCalled();
    // Without the spy: no guard read, no capture, no fallback after the response.
    expect(calls()).toEqual([]);
    expect(await fallbacksOf(row.id)).toEqual([]);
    expect(await emailTemplatesOf(row.id)).toEqual([]);
  });

  it("while Pay on a matching hold schedules it once, after the response: the spy sees requests.ts's call", async () => {
    const { live } = await autoCreator();
    const { row, token } = await pendingCheckoutRequest(live, {
      autoApprove: true,
      ...PAID_SOCIAL_YEAR_WORLDWIDE,
    });
    queueAfter();
    await expect(fakeCheckoutPay(row.id)).rejects.toMatchObject(
      redirectTo(`/r/${row.id}?t=${token}&session_id=cs_fake_${row.id}`),
    );
    expect(autoApproveRequest).not.toHaveBeenCalled();
    await runQueuedAfter();
    expect(autoApproveRequest).toHaveBeenCalledExactlyOnceWith(row.id);
    expect((await requestRow(row.id)).status).toBe("approved");
  });
});
