import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCheckoutPay } from "../../src/app/dev/fake-checkout/[requestId]/actions";
import { db } from "../../src/db/client";
import { emailLog, licenseRequest, user, video } from "../../src/db/schema";
import type {
  CreatorProfile,
  LicenseRequest,
  NewCreatorProfile,
  NewLicenseRequest,
} from "../../src/db/schema/types";
import { REQUEST_EMAIL_COPY } from "../../src/emails/request-copy";
import { formatEmailDateTime, formatMoney } from "../../src/lib/format";
import { DAY_MS, HOUR_MS } from "../../src/lib/time";
import { StartCheckoutSchema } from "../../src/lib/validation/checkout";
import { AUTO_APPROVE, WEBHOOK } from "../../src/server/auth/actor";
import { updateCreatorSettings } from "../../src/server/creators/profile";
import { approveLicenseRequest } from "../../src/server/licensing/approve";
import {
  autoApproveRequest,
  retryAutoApprovals,
} from "../../src/server/licensing/auto-approve";
import { getBuyerStatus, listInbox } from "../../src/server/licensing/queries";
import {
  createLicenseRequest,
  markAuthorized,
} from "../../src/server/licensing/requests";
import type { RequestContext } from "../../src/server/request-context";
import { redirectTo } from "../helpers/actions";
import { flushAfter, queueAfter, runQueuedAfter } from "../helpers/after";
import {
  approvableVideo,
  approvingCreator,
  authorizedMinutesAgo,
  PAID_SOCIAL_YEAR_WORLDWIDE,
  pendingCheckoutRequest,
  waitingRequest,
} from "../helpers/approval-fixtures";
import { DEMO_REQUEST } from "../helpers/checkout-fixtures";
import { auditsOf } from "../helpers/connect-flow";
import { countsOf, cron } from "../helpers/cron";
import { resetDb } from "../helpers/db";
import { requestRow } from "../helpers/factories";
import { AFTER_FAILED, captureLogEvents, recordStderr } from "../helpers/logs";
import { readLatestEmail } from "../helpers/read-latest-email";
import { endingsOf, onlyLicense } from "../helpers/request-outcomes";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";
import { expectPaidOnce, storedPayouts } from "../helpers/transfer-fixtures";

// Auto-approve (P19c; 02 §8.2, §8.4; 03 T4, §7.10; 07 D24, D25, D74, D81; 01 J7.6, J8.11; owner answers Q-152, Q-154,
// Q-155): once an auto_approve request is authorized, its approval runs after the response as the system actor through
// Approve's own path (capture, license, license-approved, the creator transfer). A guard that fails (payouts not
// active, the original not ready, a risk level other than normal), or a request still not approved 10 minutes after
// authorization, hands it to the creator: auto_approve_fallback_at, request-new with the fallback line and one audit,
// with the status left awaiting_approval. Settings change new requests only; the cron retries what didn't finish. The
// payments driver is the scripted double; each case has its own creator, and only the cron's case empties the database.

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

// requests.ts gets the spy only if it loads auto-approve.ts first: keep fakeCheckoutPay's import (via events.ts) first.
vi.mock("@/server/licensing/auto-approve", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/server/licensing/auto-approve")>();
  return { ...real, autoApproveRequest: vi.fn(real.autoApproveRequest) };
});

let scripted: ScriptedPayments;
beforeEach(() => {
  scripted = installScriptedPayments();
  vi.mocked(autoApproveRequest).mockClear();
  recordStderr(AFTER_FAILED);
});
afterEach(finishScriptedTest);

const CTX: RequestContext = {
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (test)",
};

/** An auto_approve request at the J4.7 quote: CA$1,575.00 + CA$157.50 = CA$1,732.50. */
const AUTO_REQUEST = {
  autoApprove: true,
  ...PAID_SOCIAL_YEAR_WORLDWIDE,
} satisfies Partial<NewLicenseRequest>;

/**
 * A creator who can approve (`creator` overrides the profile), their published video and one auto_approve request on
 * it, authorized just now. T2 is applied directly, so nothing is scheduled: the test runs the auto-approval itself.
 */
async function autoRequest(creator: Partial<NewCreatorProfile> = {}) {
  const approver = await approvingCreator(creator);
  const live = await approvableVideo(approver.creator.id);
  const { row, token } = await waitingRequest(live, AUTO_REQUEST);
  return { ...approver, live, row, token };
}

/** The fake checkout's Pay: T2 through the completed event, then Stripe's success URL. */
async function pay(id: string, token: string): Promise<void> {
  await expect(fakeCheckoutPay(id)).rejects.toMatchObject(
    redirectTo(`/r/${id}?t=${token}&session_id=cs_fake_${id}`),
  );
}

/** The request's deadline: the test fails if it was never authorized. */
function deadlineOf(row: Pick<LicenseRequest, "expiresAt">): Date {
  if (!row.expiresAt) throw new Error("not authorized");
  return row.expiresAt;
}

/** The creator's sign-in address, where request-new goes (approvingCreator doesn't return it). */
async function addressOf(creator: Pick<CreatorProfile, "userId">) {
  const [owner] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, creator.userId));
  if (!owner) throw new Error("no user");
  return owner.email;
}

/** The request's email_log keys (`<template>/<id>`), sorted: request-new counted here, since outcomeEmails skips it. */
async function emailKeysOf(requestId: string): Promise<string[]> {
  const rows = await db
    .select({ key: emailLog.idempotencyKey })
    .from(emailLog)
    .where(eq(emailLog.entityId, requestId));
  return rows.map(({ key }) => key).sort();
}

/** The keys a fallback leaves: its request-new beside the authorization's request-received. */
const fellBackEmails = (id: string) => [
  `request-new/${id}`,
  `request-received/${id}`,
];

/** The request's fallback audits (07 D81). */
const fallbacksOf = (requestId: string) =>
  auditsOf(requestId, "license_request.auto_approve_fallback");

/** A fallback audit as written: its reason, by the auto-approve system actor (07 D47). */
const fellBack = (reason: string) => ({
  data: { reason, source: "auto_approve" },
  actorType: "system",
});

/** The capture calls' keys, in order. */
const captureKeys = () => scripted.keys("capture");

/** The payments methods this test called, in order. */
const methods = () => scripted.log.map(({ method }) => method);

/** The getAuthorization calls on the request's PaymentIntent. */
const authorizationsOf = (requestId: string) =>
  scripted
    .callsOf("getAuthorization")
    .filter(({ args }) => args[0] === `pi_fake_${requestId}`);

describe("on authorization (07 D81; 03 T2, T4; owner answer Q-152)", () => {
  it("Pay authorizes it and schedules one run after the response, which approves it as the system: captured once, licensed, the buyer emailed and the creator paid once", async () => {
    const { creator } = await approvingCreator();
    const live = await approvableVideo(creator.id);
    const { row, token } = await pendingCheckoutRequest(live, AUTO_REQUEST);
    queueAfter();
    const since = Date.now();
    await pay(row.id, token);

    // Committed, nothing run yet: /r reads Processing…, and only request-received is queued (no request-new).
    expect(await getBuyerStatus(row.id, token)).toMatchObject({
      status: "awaiting_approval",
      displayStatus: "processing",
      autoApproving: true,
    });
    expect(await emailKeysOf(row.id)).toEqual([`request-received/${row.id}`]);
    expect(vi.mocked(autoApproveRequest)).not.toHaveBeenCalled();
    // A second delivery of the event schedules nothing and asks Stripe nothing.
    const asked = scripted.log.length;
    const reads = scripted.callsOf("getAuthorization").length;
    expect(await markAuthorized(row.id, WEBHOOK)).toMatchObject({
      changed: false,
    });
    expect(scripted.log).toHaveLength(asked);

    await runQueuedAfter();
    expect(vi.mocked(autoApproveRequest)).toHaveBeenCalledExactlyOnceWith(
      row.id,
    );
    // The guard's one read: one run, whatever the spy sees.
    expect(scripted.callsOf("getAuthorization")).toHaveLength(reads + 1);
    expect(captureKeys()).toEqual([`pi-capture:${row.id}:1`]);
    const after = await requestRow(row.id);
    expect(after).toMatchObject({
      status: "approved",
      paymentAction: "capture",
      stripeAttempt: 1,
      autoApproveFallbackAt: null,
    });
    await onlyLicense(row.id);
    await expectPaidOnce(row.id, {
      by: "system",
      source: "auto_approve",
      scripted,
    });
    expect(await endingsOf(row.id)).toEqual([
      {
        data: {
          from: "awaiting_approval",
          to: "approved",
          event: "captured",
          source: "auto_approve",
        },
        actorType: "system",
      },
    ]);
    expect(await emailKeysOf(row.id)).toEqual([
      `license-approved/${row.id}`,
      `request-received/${row.id}`,
    ]);
    const [history] = await listInbox(creator.id, "history");
    expect(history).toMatchObject({
      id: row.id,
      status: "approved",
      autoApproved: true,
    });

    const received = await readLatestEmail({
      to: row.buyerEmail,
      template: "request-received",
      since,
    });
    expect(received.text).toContain(
      REQUEST_EMAIL_COPY.receivedAutoBody(
        creator.handle,
        formatMoney(173250, "cad"),
        formatEmailDateTime(deadlineOf(after), "America/Toronto"),
      ),
    );
  });
});

describe("the guards: a request that can't approve itself goes to the creator (07 D81; 03 T4)", () => {
  it("payouts not active: falls back with no Stripe call, and request-new has the fallback and payouts lines in the creator's zone (07 D74, D84)", async () => {
    const { creator, row, token } = await autoRequest({
      payoutsStatus: "restricted",
      payoutsStatusSyncedAt: new Date(),
      timeZone: "Asia/Kolkata",
    });
    const since = Date.now();
    expect(await autoApproveRequest(row.id)).toBe("fallback");
    // The stored reading is fresh: Stripe is asked nothing.
    expect(scripted.log).toEqual([]);
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
      autoApproveFallbackAt: expect.any(Date),
    });
    expect(await fallbacksOf(row.id)).toEqual([fellBack("payouts_not_active")]);
    expect(await emailKeysOf(row.id)).toEqual(fellBackEmails(row.id));

    await flushAfter();
    const sent = await readLatestEmail({
      to: await addressOf(creator),
      template: "request-new",
      since,
    });
    const deadline = formatEmailDateTime(deadlineOf(row), "Asia/Kolkata");
    expect(sent.text).toContain(
      REQUEST_EMAIL_COPY.autoApproveFellBack(deadline),
    );
    expect(sent.text).toContain(REQUEST_EMAIL_COPY.setUpPayouts(deadline));
    expect(sent.text).not.toContain(
      formatEmailDateTime(deadlineOf(row), "America/Toronto"),
    );
    expect(sent.subject).not.toMatch(/http|t=/);
    expect(sent.subject).not.toContain(token);
  });

  it("a risk level other than normal with payouts active: request-new has the fallback line and no payouts line (07 D74)", async () => {
    const { creator, row } = await autoRequest();
    scripted.authorizations({ riskLevel: "elevated" });
    const since = Date.now();
    expect(await autoApproveRequest(row.id)).toBe("fallback");
    await flushAfter();
    const sent = await readLatestEmail({
      to: await addressOf(creator),
      template: "request-new",
      since,
    });
    const deadline = formatEmailDateTime(deadlineOf(row), creator.timeZone);
    expect(sent.text).toContain(
      REQUEST_EMAIL_COPY.autoApproveFellBack(deadline),
    );
    expect(sent.text).not.toContain(REQUEST_EMAIL_COPY.setUpPayouts(deadline));
  });

  it.each(["elevated", "highest", "not_assessed", "unknown", null] as const)(
    "risk level %s: falls back as risk_not_normal, with no capture",
    async (riskLevel) => {
      const { row } = await autoRequest();
      scripted.authorizations({ riskLevel });
      expect(await autoApproveRequest(row.id)).toBe("fallback");
      expect(await fallbacksOf(row.id)).toEqual([fellBack("risk_not_normal")]);
      expect(captureKeys()).toEqual([]);
      expect(await requestRow(row.id)).toMatchObject({
        status: "awaiting_approval",
        paymentAction: null,
        stripeAttempt: 0,
      });
    },
  );

  it("risk level normal: approved", async () => {
    const { row } = await autoRequest();
    scripted.authorizations({ riskLevel: "normal" });
    expect(await autoApproveRequest(row.id)).toBe("approved");
    expect(captureKeys()).toEqual([`pi-capture:${row.id}:1`]);
    expect(await fallbacksOf(row.id)).toEqual([]);
  });

  it("the original isn't ready: falls back as original_missing before Stripe is read (07 D33)", async () => {
    const { live, row } = await autoRequest();
    await db
      .update(video)
      .set({ status: "unpublished", originalStatus: "failed" })
      .where(eq(video.id, live.id));
    expect(await autoApproveRequest(row.id)).toBe("fallback");
    expect(await fallbacksOf(row.id)).toEqual([fellBack("original_missing")]);
    expect(scripted.log).toEqual([]);
    expect(await emailKeysOf(row.id)).toEqual(fellBackEmails(row.id));
  });
});

describe("retries, and giving up 10 minutes after authorization (03 §7.10; owner answer Q-154)", () => {
  it("a transient capture is a retry with the claim let go; a retry 3 minutes after authorization approves it under a new key (07 D25, D30)", async () => {
    const { creator, row } = await autoRequest();
    scripted.next("capture", "transient");
    expect(await autoApproveRequest(row.id)).toBe("retry");
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 1,
      autoApproveFallbackAt: null,
    });
    expect(await fallbacksOf(row.id)).toEqual([]);

    await authorizedMinutesAgo(row.id, 3);
    expect(await retryAutoApprovals({ limit: 50, creatorId: creator.id })).toBe(
      1,
    );
    expect((await requestRow(row.id)).status).toBe("approved");
    expect(captureKeys()).toEqual([
      `pi-capture:${row.id}:1`,
      `pi-capture:${row.id}:2`,
    ]);
  });

  it("a payouts read that fails is a retry with nothing claimed, logged by the error's name", async () => {
    const { creator, row } = await autoRequest();
    await storedPayouts(creator.id, "active", 11);
    scripted.script({ fetchPayoutsStatus: new Error("x") });
    const logged = captureLogEvents("license_request.auto_approve_failed");
    expect(await autoApproveRequest(row.id)).toBe("retry");
    expect(logged().events).toEqual([
      expect.objectContaining({ requestId: row.id, error: "Error" }),
    ]);
    expect(methods()).toEqual(["fetchPayoutsStatus"]);
    expect(await requestRow(row.id)).toMatchObject({
      paymentAction: null,
      stripeAttempt: 0,
      autoApproveFallbackAt: null,
    });
    expect(await fallbacksOf(row.id)).toEqual([]);
    // Stripe answers again: the next run approves it.
    scripted.script({ fetchPayoutsStatus: undefined });
    expect(await autoApproveRequest(row.id)).toBe("approved");
  });

  it("a hold that can't be read is a retry with nothing claimed", async () => {
    const { row } = await autoRequest();
    scripted.authorizations(new Error("x"));
    expect(await autoApproveRequest(row.id)).toBe("retry");
    expect(captureKeys()).toEqual([]);
    expect(await requestRow(row.id)).toMatchObject({
      paymentAction: null,
      stripeAttempt: 0,
      autoApproveFallbackAt: null,
    });
    expect(await autoApproveRequest(row.id)).toBe("approved");
  });

  it("a transient capture 11 minutes after authorization falls back as gave_up with the hold still on; the creator approves it under a new key", async () => {
    const { creator, actor, row } = await autoRequest();
    await authorizedMinutesAgo(row.id, 11);
    scripted.next("capture", "transient");
    expect(await autoApproveRequest(row.id)).toBe("fallback");
    expect(await fallbacksOf(row.id)).toEqual([fellBack("gave_up")]);
    expect(captureKeys()).toEqual([`pi-capture:${row.id}:1`]);
    expect(scripted.piStatus(`pi_fake_${row.id}`)).toBe("requires_capture");
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
    });
    expect(await emailKeysOf(row.id)).toEqual(fellBackEmails(row.id));

    // Manual from now on: no retry takes it, and the creator's Approve does.
    expect(await retryAutoApprovals({ limit: 50, creatorId: creator.id })).toBe(
      0,
    );
    expect((await approveLicenseRequest(row.id, actor)).ok).toBe(true);
    expect(captureKeys()).toEqual([
      `pi-capture:${row.id}:1`,
      `pi-capture:${row.id}:2`,
    ]);
  });

  it("a payouts read that fails 11 minutes after authorization falls back as gave_up, with no capture", async () => {
    const { creator, row } = await autoRequest();
    await authorizedMinutesAgo(row.id, 11);
    await storedPayouts(creator.id, "active", 11);
    scripted.script({ fetchPayoutsStatus: new Error("x") });
    // The run after T2 still tries once, whatever the request's age.
    expect(await autoApproveRequest(row.id)).toBe("fallback");
    expect(await fallbacksOf(row.id)).toEqual([fellBack("gave_up")]);
    expect(methods()).toEqual(["fetchPayoutsStatus"]);
  });

  it("a hold that can't be read 11 minutes after authorization falls back as gave_up, with no capture", async () => {
    const { row } = await autoRequest();
    await authorizedMinutesAgo(row.id, 11);
    scripted.authorizations(new Error("x"));
    expect(await autoApproveRequest(row.id)).toBe("fallback");
    expect(await fallbacksOf(row.id)).toEqual([fellBack("gave_up")]);
    expect(methods()).toEqual(["getAuthorization"]);
  });

  it("a transient capture 9 minutes after authorization is still a retry", async () => {
    const { row } = await autoRequest();
    await authorizedMinutesAgo(row.id, 9);
    scripted.next("capture", "transient");
    expect(await autoApproveRequest(row.id)).toBe("retry");
    expect(await fallbacksOf(row.id)).toEqual([]);
    expect(await requestRow(row.id)).toMatchObject({
      paymentAction: null,
      autoApproveFallbackAt: null,
    });
    expect(await autoApproveRequest(row.id)).toBe("approved");
  });

  it("gives up on the database's clock as the attempt ends: loaded at 9 minutes, failing at 11, it falls back as gave_up", async () => {
    const { creator, row } = await autoRequest();
    await authorizedMinutesAgo(row.id, 9);
    await storedPayouts(creator.id, "active", 11);
    const read = vi
      .spyOn(scripted.driverFor("cad"), "fetchPayoutsStatus")
      .mockImplementationOnce(async () => {
        await authorizedMinutesAgo(row.id, 11);
        throw new Error("x");
      });
    expect(await autoApproveRequest(row.id)).toBe("fallback");
    expect(read).toHaveBeenCalledTimes(1);
    expect(await fallbacksOf(row.id)).toEqual([fellBack("gave_up")]);
    expect(authorizationsOf(row.id)).toEqual([]);
    expect(captureKeys()).toEqual([]);
    expect(await emailKeysOf(row.id)).toEqual(fellBackEmails(row.id));
  });
});

describe("Approve as the auto-approve system actor (02 §8.2; 03 T4; 07 D81)", () => {
  it("tells nothing about a manual request, one that fell back or an unknown id, and claims nothing", async () => {
    const { creator } = await approvingCreator();
    const live = await approvableVideo(creator.id);
    const { row: manual } = await waitingRequest(
      live,
      PAID_SOCIAL_YEAR_WORLDWIDE,
    );
    const { row: handedOver } = await waitingRequest(live, AUTO_REQUEST);
    scripted.authorizations({ riskLevel: "elevated" });
    expect(await autoApproveRequest(handedOver.id)).toBe("fallback");
    for (const id of [manual.id, handedOver.id, randomUUID()]) {
      expect(await approveLicenseRequest(id, AUTO_APPROVE)).toEqual({
        ok: false,
        reason: "not_actionable",
        status: null,
      });
    }
    for (const id of [manual.id, handedOver.id]) {
      expect(await requestRow(id)).toMatchObject({
        status: "awaiting_approval",
        paymentAction: null,
        stripeAttempt: 0,
      });
    }
    expect(captureKeys()).toEqual([]);
  });

  it("a fallback committed after its read still wins: the capture claim refuses it", async () => {
    // No payouts reading yet, so Approve reads one; the fallback commits during that read.
    const { row } = await autoRequest({ payoutsStatusSyncedAt: null });
    const driver = scripted.driverFor("cad");
    const real = driver.fetchPayoutsStatus.bind(driver);
    vi.spyOn(driver, "fetchPayoutsStatus").mockImplementationOnce(
      async (...args) => {
        await db
          .update(licenseRequest)
          .set({ autoApproveFallbackAt: new Date() })
          .where(eq(licenseRequest.id, row.id));
        return real(...args);
      },
    );
    expect(await approveLicenseRequest(row.id, AUTO_APPROVE)).toEqual({
      ok: false,
      reason: "not_actionable",
      status: "awaiting_approval",
    });
    expect(captureKeys()).toEqual([]);
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
      autoApproveFallbackAt: expect.any(Date),
    });
  });
});

describe("two runs at once (07 D24; 03 §5.1)", () => {
  it("approve: the second finds the claim and skips; one capture, one license, the creator paid once", async () => {
    const { row } = await autoRequest();
    const held = scripted.hold("capture");
    const first = autoApproveRequest(row.id);
    await held.reached;
    expect(await autoApproveRequest(row.id)).toBe("skipped");
    held.release();
    expect(await first).toBe("approved");
    expect(captureKeys()).toEqual([`pi-capture:${row.id}:1`]);
    await onlyLicense(row.id);
    await flushAfter();
    await expectPaidOnce(row.id, {
      by: "system",
      source: "auto_approve",
      scripted,
    });
    expect(await fallbacksOf(row.id)).toEqual([]);
    expect(await emailKeysOf(row.id)).toEqual([
      `license-approved/${row.id}`,
      `request-received/${row.id}`,
    ]);
  });

  it("fall back: one wins, the other skips; one request-new and one audit", async () => {
    const { row } = await autoRequest({
      payoutsStatus: "restricted",
      payoutsStatusSyncedAt: new Date(),
    });
    const outcomes = await Promise.all([
      autoApproveRequest(row.id),
      autoApproveRequest(row.id),
    ]);
    expect(outcomes.sort()).toEqual(["fallback", "skipped"]);
    expect(await emailKeysOf(row.id)).toEqual(fellBackEmails(row.id));
    expect(await fallbacksOf(row.id)).toEqual([fellBack("payouts_not_active")]);
  });
});

describe("approval windows (07 D81, §2.3; 01 J8.11)", () => {
  it.each([24, 120] as const)(
    "a %i h window: the deadline is exactly that long after authorization",
    async (hours) => {
      const { creator } = await approvingCreator();
      const live = await approvableVideo(creator.id);
      const { row, token } = await pendingCheckoutRequest(live, {
        approvalWindowHours: hours,
      });
      await pay(row.id, token);
      const after = await requestRow(row.id);
      const authorizedAt = after.authorizedAt?.getTime() ?? Number.NaN;
      expect(deadlineOf(after).getTime() - authorizedAt).toBe(hours * HOUR_MS);
    },
  );

  it("a hold that ends sooner cuts a 120 h window to 6 h before capture_before", async () => {
    const { creator } = await approvingCreator();
    const live = await approvableVideo(creator.id);
    const { row, token } = await pendingCheckoutRequest(live, {
      approvalWindowHours: 120,
    });
    // Stripe's usual hold, 4 days 18 hours.
    const captureBefore = new Date(Date.now() + 4 * DAY_MS + 18 * HOUR_MS);
    scripted.script({ getAuthorization: { captureBefore } });
    await pay(row.id, token);
    scripted.script({ getAuthorization: undefined });
    const after = await requestRow(row.id);
    expect(deadlineOf(after).getTime()).toBe(
      captureBefore.getTime() - 6 * HOUR_MS,
    );
    expect(after.captureBefore).toEqual(captureBefore);
  });

  it("saving Settings changes no waiting request; the next request snapshots the new window and auto-approve (01 J8.11; 07 D77)", async () => {
    const { creator, actor } = await approvingCreator();
    const live = await approvableVideo(creator.id);
    const { row } = await waitingRequest(live, PAID_SOCIAL_YEAR_WORLDWIDE);
    // Old enough for a retry to take it, if it were an auto request.
    await authorizedMinutesAgo(row.id, 3);
    const before = await requestRow(row.id);
    expect(before).toMatchObject({
      approvalWindowHours: 72,
      autoApprove: false,
    });

    await updateCreatorSettings(actor, {
      approvalWindowHours: 24,
      autoApprove: true,
    });
    expect(await requestRow(row.id)).toEqual(before);
    expect(await retryAutoApprovals({ limit: 50, creatorId: creator.id })).toBe(
      0,
    );
    expect(await requestRow(row.id)).toEqual(before);

    const submissionId = randomUUID();
    expect(
      await createLicenseRequest(
        StartCheckoutSchema.parse({
          ...DEMO_REQUEST,
          videoId: live.id,
          submissionId,
        }),
        CTX,
      ),
    ).toMatchObject({ ok: true });
    const [next] = await db
      .select()
      .from(licenseRequest)
      .where(eq(licenseRequest.checkoutSubmissionId, submissionId));
    expect(next).toMatchObject({ approvalWindowHours: 24, autoApprove: true });
  });

  it("a request that fell back stays manual once payouts are active again", async () => {
    const { creator, row } = await autoRequest({
      payoutsStatus: "restricted",
      payoutsStatusSyncedAt: new Date(),
    });
    expect(await autoApproveRequest(row.id)).toBe("fallback");
    await storedPayouts(creator.id, "active");
    await authorizedMinutesAgo(row.id, 3);
    expect(await retryAutoApprovals({ limit: 50, creatorId: creator.id })).toBe(
      0,
    );
    expect(await autoApproveRequest(row.id)).toBe("skipped");
    expect(captureKeys()).toEqual([]);
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      autoApprove: true,
      autoApproveFallbackAt: expect.any(Date),
      paymentAction: null,
    });
  });
});

describe("the cron (02 §8.4; 07 D57, D81)", () => {
  it("retries as the system: approves one 3 minutes old, gives up on one 11 minutes old, leaves one 1 minute old to its run; a second run finds nothing", async () => {
    await resetDb();
    const { creator } = await approvingCreator();
    const live = await approvableVideo(creator.id);
    const authorizedAgo = async (minutes: number) => {
      const { row } = await waitingRequest(live, AUTO_REQUEST);
      await authorizedMinutesAgo(row.id, minutes);
      return row.id;
    };
    const retried = await authorizedAgo(3);
    const givenUp = await authorizedAgo(11);
    const fresh = await authorizedAgo(1);
    const untouched = await requestRow(fresh);

    const counts = await countsOf(await cron());
    expect(Object.keys(counts).sort()).toEqual([
      "autoApprovals",
      "emailsSent",
      "expired",
      "moneyMovements",
      "reconciled",
    ]);
    expect(counts).toMatchObject({
      autoApprovals: 2,
      expired: 0,
      reconciled: 0,
    });
    await flushAfter();

    // Approved as the auto-approve system actor (03 T4), not as the cron.
    expect((await requestRow(retried)).status).toBe("approved");
    expect(await endingsOf(retried)).toEqual([
      {
        data: {
          from: "awaiting_approval",
          to: "approved",
          event: "captured",
          source: "auto_approve",
        },
        actorType: "system",
      },
    ]);
    await expectPaidOnce(retried, {
      by: "system",
      source: "auto_approve",
      scripted,
    });
    // Past 10 minutes: handed to the creator with no guard and no Stripe call.
    expect(await fallbacksOf(givenUp)).toEqual([fellBack("gave_up")]);
    expect(authorizationsOf(givenUp)).toEqual([]);
    expect(captureKeys()).toEqual([`pi-capture:${retried}:1`]);
    // Inside the T2 run's 2-minute head start.
    expect(await requestRow(fresh)).toEqual(untouched);

    expect(await countsOf(await cron())).toMatchObject({ autoApprovals: 0 });
  });
});
