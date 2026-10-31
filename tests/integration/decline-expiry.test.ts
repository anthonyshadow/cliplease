import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forceOverdue } from "../../scripts/dev-expire-request";
import { declineRequest } from "../../src/app/(dashboard)/dashboard/actions";
import { db } from "../../src/db/client";
import {
  auditEvent,
  emailLog,
  licenseRequest,
  moneyMovement,
  stripeEvent,
  video,
} from "../../src/db/schema";
import type { NewCreatorProfile, Video } from "../../src/db/schema/types";
import type { LicenseRequestStatus } from "../../src/lib/domain/values";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { LICENSE_CODE_PATTERN } from "../../src/lib/licensing/snapshot";
import type { LicenseRequestEvent } from "../../src/lib/licensing/transitions";
import { GENERIC_ERROR_MESSAGE } from "../../src/lib/result";
import { HOUR_MS } from "../../src/lib/time";
import { LAZY } from "../../src/server/auth/actor";
import { env } from "../../src/server/env";
import { approveLicenseRequest } from "../../src/server/licensing/approve";
import { settleCreatorRequests } from "../../src/server/licensing/lazy";
import {
  getRequestForCreator,
  listInbox,
} from "../../src/server/licensing/queries";
import { getBuyerRequest } from "../../src/server/licensing/request-status";
import {
  declineLicenseRequest,
  expireDueRequests,
  expireLicenseRequest,
} from "../../src/server/licensing/requests";
import {
  claimPaymentAction,
  type RequestAction,
} from "../../src/server/licensing/state-machine";
import { onWebhookEvent } from "../../src/server/payments/events";
import {
  findRequestForBuyer,
  generateBuyerToken,
  hashBuyerToken,
} from "../../src/server/tokens/buyer-token";
import { flushAfter } from "../helpers/after";
import {
  approvableVideo,
  approvingCreator,
  claimedMinutesAgo,
  overdue,
  pendingCheckoutRequest,
  waitingRequest,
} from "../helpers/approval-fixtures";
import { bareCreator, mockNextHeaders, signedInCreator } from "../helpers/auth";
import { auditsOf } from "../helpers/connect-flow";
import { requestRow } from "../helpers/factories";
import { AFTER_FAILED, recordStderr, stopStderr } from "../helpers/logs";
import { BARE_DOLLAR } from "../helpers/money";
import { deliverPiEvent, piEvent } from "../helpers/pi-events";
import { readLatestEmail } from "../helpers/read-latest-email";
import {
  endingsOf,
  licensesOf,
  outcomeEmails,
  stripeEventsOf,
} from "../helpers/request-outcomes";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  expectInvariant,
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";

// Decline, expiry and Stripe's canceled event (P19; 02 §6.1, §8.1, §8.2, §8.4; 03 T6, T8–T10, T13, §7.10; 07 D24–D28,
// D30, D57, D77; 01 J8.4–J8.8, J8.15; owner answers OQ-31, Q-142 a, Q-143 a): the creator's one-tap Decline and its
// request-declined email, the expiry a decline past the deadline becomes, Approve racing both, expireLicenseRequest and
// expireDueRequests, the webhook's canceled branches, the lazy layers (/r awaits its own expiry; the creator pages
// settle theirs), the creator reads' displayStatus, the dev clock's forceOverdue and the declineRequest action. The
// payments driver is the scripted double: each request's PaymentIntent is seeded held and moves only by the double's own
// capture and cancel or an explicit move, so "not charged" is stored only once Stripe released the hold (07 D25).

vi.mock("@/server/payments/registry", async (importOriginal) =>
  (await import("../helpers/scripted-suite")).scriptedRegistry(
    await importOriginal<typeof import("@/server/payments/registry")>(),
  ),
);

// after() runs at once: the outcome emails go out and the scheduled expiries run, and each test waits for them.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("../helpers/after")).runAfter,
}));

// The declineRequest action: its session from mocked headers, its refresh() counted.
vi.mock("next/headers", () => import("../helpers/next-headers"));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

let scripted: ScriptedPayments;

beforeEach(() => {
  scripted = installScriptedPayments();
  mockNextHeaders(null);
  vi.mocked(refresh).mockClear();
  recordStderr(AFTER_FAILED);
});
afterEach(finishScriptedTest);

/** A waiting request on `live`, its PaymentIntent tracked as a hold that still waits (never derived from the row). */
async function waitingOn(live: Video) {
  const { row, token } = await waitingRequest(live);
  const pi = `pi_fake_${row.id}`;
  scripted.seedPi(pi);
  return { id: row.id, row, token, pi };
}

/** A creator who can approve (unless `creatorOverrides` say otherwise), their published video and a request on it. */
async function subject(creatorOverrides: Partial<NewCreatorProfile> = {}) {
  const { creator, actor } = await approvingCreator(creatorOverrides);
  const live = await approvableVideo(creator.id);
  return { creator, actor, live, ...(await waitingOn(live)) };
}

/** Claims request `id` for `action` as a holder would, before any Stripe call (03 §5.1). */
async function claim(id: string, action: RequestAction) {
  const claimed = await claimPaymentAction(id, action);
  if (!claimed) throw new Error(`no ${action} claim on ${id}`);
  return claimed;
}

const APPROVED = {
  ok: true,
  licenseCode: expect.stringMatching(LICENSE_CODE_PATTERN),
};
/** A claim another action holds: the request as it is (J8.8), Processing… on the pages (07 D26). */
const BUSY = {
  ok: false,
  reason: "not_actionable",
  status: "awaiting_approval",
} as const;
const DECLINED_SUBJECT = "Not approved: you weren't charged";

/** One outcome email, sent on the first attempt. */
const sentOnce = (template: string) => ({
  template,
  status: "sent",
  attempts: 1,
});

/** Every audit row of a request, by action and data. */
const auditsFor = (entityId: string) =>
  db
    .select({ action: auditEvent.action, data: auditEvent.data })
    .from(auditEvent)
    .where(eq(auditEvent.entityId, entityId));

/** An ending's transition audit (07 D47): the lazy system's keeps its source in data. */
function ending(
  to: LicenseRequestStatus,
  event: LicenseRequestEvent,
  by: "creator" | "stripe" | "lazy",
) {
  const data = { from: "awaiting_approval", to, event };
  return by === "lazy"
    ? { data: { ...data, source: "lazy" }, actorType: "system" }
    : { data, actorType: by };
}

/** The late canceled event an ended request records (03 T13). */
const ignoredCanceled = (from: LicenseRequestStatus) => ({
  data: { from, event: from, stripeEvent: "payment_intent.canceled" },
  actorType: "stripe",
});

const processedCanceled = {
  type: "payment_intent.canceled",
  processedAt: expect.any(Date),
  lastError: null,
};

/** The key in a buyer email's /r link (`${APP_URL}/r/<id>?t=<key>`), or undefined. */
function statusLinkKey(text: string, requestId: string): string | undefined {
  const origin = env.APP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${origin}/r/${requestId}\\?t=([A-Za-z0-9_-]{43})`).exec(
    text,
  )?.[1];
}

describe("Decline (02 §8.2; 03 T8; 07 D24, D25, D28; 01 J8.4; owner answer OQ-31)", () => {
  it("cancels the hold under the decline claim's key, then stores declined and emails the buyer /r's Not approved body", async () => {
    const s = await subject();
    const since = Date.now();
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual({ ok: true });

    expect(await requestRow(s.id)).toMatchObject({
      status: "declined",
      statusReason: "creator",
      declinedAt: expect.any(Date),
      paymentAction: "decline",
      stripeAttempt: 1,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:decline:1`, "requested_by_customer"],
    ]);
    // Claimed and committed before Stripe was called (07 D24).
    expect(scripted.callsOf("cancel")[0]?.committed).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "decline",
      paymentActionAt: expect.any(Date),
      stripeAttempt: 1,
    });
    expect(scripted.callsOf("capture")).toEqual([]);
    expect(scripted.callsOf("getAuthorization")).toEqual([]);
    expect(await endingsOf(s.id)).toEqual([
      ending("declined", "declined", "creator"),
    ]);

    await flushAfter();
    const declinedRows = await db
      .select()
      .from(emailLog)
      .where(
        and(
          eq(emailLog.entityId, s.id),
          eq(emailLog.template, "request-declined"),
        ),
      );
    expect(declinedRows).toEqual([
      expect.objectContaining({
        idempotencyKey: `request-declined/${s.id}`,
        entityType: "license_request",
        subject: DECLINED_SUBJECT,
        status: "sent",
        attempts: 1,
      }),
    ]);
    const sent = await readLatestEmail({
      to: s.row.buyerEmail,
      template: "request-declined",
      since,
    });
    expect(sent.subject).toBe(DECLINED_SUBJECT);
    expect(sent.text).toContain(
      REQUEST_STATUS_COPY.declinedBody(s.creator.handle),
    );
    const key = statusLinkKey(sent.text, s.id);
    expect(key).toBe(s.token);
    expect(hashBuyerToken(key ?? "")).toBe(s.row.buyerTokenHash);
    expect(await findRequestForBuyer(s.id, key ?? "")).toMatchObject({
      id: s.id,
      status: "declined",
    });
    expect(sent.text).not.toMatch(BARE_DOLLAR);
    expect(sent.text).not.toContain("hold of");

    // Tapped again: decided, and Stripe isn't asked twice.
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual({
      ok: false,
      reason: "not_actionable",
      status: "declined",
    });
    expect(scripted.callsOf("cancel")).toHaveLength(1);

    // Stripe's canceled events after it are recorded on the ended request and send nothing more.
    for (let delivery = 0; delivery < 2; delivery += 1) {
      expect(await deliverPiEvent("payment_intent.canceled", s.id)).toBe(
        "processed",
      );
    }
    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([sentOnce("request-declined")]);
    expect(await auditsOf(s.id, "license_request.ignored_event")).toEqual([
      ignoredCanceled("declined"),
      ignoredCanceled("declined"),
    ]);
    expect(await stripeEventsOf(s.id)).toEqual([
      processedCanceled,
      processedCanceled,
    ]);
    expect(scripted.callsOf("getAuthorization")).toEqual([]);
    await expectInvariant(s.id);
  });

  it("tells another creator, or an unknown id, nothing and changes nothing", async () => {
    const s = await subject();
    const other = await bareCreator();
    const before = await auditsFor(s.id);
    for (const [id, actor] of [
      [s.id, other.actor],
      [randomUUID(), s.actor],
    ] as const) {
      expect(await declineLicenseRequest(id, actor)).toEqual({
        ok: false,
        reason: "not_actionable",
        status: null,
      });
    }
    expect(await requestRow(s.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
    });
    expect(await auditsFor(s.id)).toEqual(before);
    expect(scripted.log).toEqual([]);
  });

  it("takes no reason but the creator's from a creator: video_disabled is refused (07 D28)", async () => {
    const s = await subject();
    expect(
      await declineLicenseRequest(s.id, s.actor, "video_disabled"),
    ).toEqual({ ok: false, reason: "not_actionable", status: null });
    expect(await requestRow(s.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
    });
    expect(scripted.log).toEqual([]);
  });

  it("is refused while Approve's fresh capture claim holds the request: no cancel, the claim untouched", async () => {
    const s = await subject();
    const held = await claim(s.id, "capture");
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual(BUSY);
    expect(await requestRow(s.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
      paymentActionAt: held.paymentActionAt,
      stripeAttempt: 1,
    });
    expect(scripted.log).toEqual([]);
  });

  it("says video_disabled when Stripe's word finishes the decline of a video disabled meanwhile, in /r and the email (07 D28)", async () => {
    const s = await subject();
    const since = Date.now();
    // An admin's Disable, by hand (P21 builds it).
    await db
      .update(video)
      .set({
        status: "disabled",
        disabledAt: new Date(),
        disabledReason: "rights_claim",
      })
      .where(eq(video.id, s.live.id));
    // Stripe canceled the hold, but the answer was lost: the reconcile reads canceled and writes the reason.
    scripted.next("cancel", "ambiguous");
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual({ ok: true });
    expect(scripted.callsOf("cancel")[0]?.answered).toBe("threw");
    expect(scripted.callsOf("getAuthorization")).toHaveLength(1);
    expect(await requestRow(s.id)).toMatchObject({
      status: "declined",
      statusReason: "video_disabled",
      declinedAt: expect.any(Date),
      stripeAttempt: 1,
    });
    expect(await endingsOf(s.id)).toEqual([
      ending("declined", "declined", "creator"),
    ]);
    expect(await getBuyerRequest(s.id, s.token)).toMatchObject({
      status: "declined",
      displayStatus: "declined",
      statusReason: "video_disabled",
    });

    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([sentOnce("request-declined")]);
    const sent = await readLatestEmail({
      to: s.row.buyerEmail,
      template: "request-declined",
      since,
    });
    expect(sent.subject).toBe(DECLINED_SUBJECT);
    expect(sent.text).toContain(REQUEST_STATUS_COPY.videoDisabledBody);
    expect(sent.text).not.toContain("didn't approve");
    await expectInvariant(s.id);
  });

  it("says retry when the cancel fails with the hold still on, then declines under attempt 2 with one email (07 D25, D30)", async () => {
    const s = await subject();
    scripted.next("cancel", "transient");
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual({
      ok: false,
      reason: "retry",
      status: "awaiting_approval",
    });
    expect(await requestRow(s.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      paymentActionAt: null,
      stripeAttempt: 1,
    });
    expect(scripted.piStatus(s.pi)).toBe("requires_capture");

    expect(await declineLicenseRequest(s.id, s.actor)).toEqual({ ok: true });
    expect(scripted.keys("cancel")).toEqual([
      `pi-cancel:${s.id}:decline:1`,
      `pi-cancel:${s.id}:decline:2`,
    ]);
    expect(scripted.callsOf("cancel")[1]?.committed).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "decline",
      stripeAttempt: 2,
    });
    expect(await requestRow(s.id)).toMatchObject({
      status: "declined",
      statusReason: "creator",
      stripeAttempt: 2,
    });
    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([sentOnce("request-declined")]);
    await expectInvariant(s.id);
  });

  it("reconciles a capture claim stuck for 3 minutes first, then declines under the next attempt (07 D26)", async () => {
    const s = await subject();
    await claim(s.id, "capture");
    await claimedMinutesAgo(s.id, 3);
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual({ ok: true });
    // Stripe says the hold still waits: the stuck claim is released, and the decline claims attempt 2.
    expect(scripted.callsOf("getAuthorization")).toHaveLength(1);
    expect(scripted.callsOf("capture")).toEqual([]);
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:decline:2`, "requested_by_customer"],
    ]);
    expect(await requestRow(s.id)).toMatchObject({
      status: "declined",
      statusReason: "creator",
      stripeAttempt: 2,
    });
    await expectInvariant(s.id);
  });

  it("J8.5: a declined request's hold is canceled with nothing captured, and no transfer exists", async () => {
    const s = await subject();
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual({ ok: true });
    await flushAfter();
    expect(scripted.callsOf("capture")).toEqual([]);
    expect(scripted.piStatus(s.pi)).toBe("canceled");
    expect(scripted.piHistory).toEqual([
      {
        paymentIntentId: s.pi,
        from: "requires_capture",
        to: "canceled",
        by: "cancel",
      },
    ]);
    expect(
      await db
        .select()
        .from(moneyMovement)
        .where(eq(moneyMovement.licenseRequestId, s.id)),
    ).toEqual([]);
    expect(await licensesOf(s.id)).toEqual([]);
    await expectInvariant(s.id);
  });
});

describe("Decline past the deadline: the request expires instead (03 T8, T9; 07 D25; 01 J8.6; owner answer Q-143 a)", () => {
  it("cancels with the expiry's key and reason and answers expired: no request-declined", async () => {
    const s = await subject();
    await overdue(s.id);
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual({
      ok: false,
      reason: "not_actionable",
      status: "expired",
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:1`, "abandoned"],
    ]);
    expect(scripted.callsOf("cancel")[0]?.committed).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "expire",
      stripeAttempt: 1,
    });
    expect(await requestRow(s.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
      expiredAt: expect.any(Date),
      stripeAttempt: 1,
    });
    expect(await endingsOf(s.id)).toEqual([
      ending("expired", "expired", "lazy"),
    ]);
    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([]);
    await expectInvariant(s.id);
  });

  it("leaves the request waiting and unclaimed when the expiry's cancel fails with the hold still on", async () => {
    const s = await subject();
    await overdue(s.id);
    scripted.next("cancel", "transient");
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual(BUSY);
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:1`, "abandoned"],
    ]);
    expect(await requestRow(s.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      paymentActionAt: null,
      stripeAttempt: 1,
    });
    expect(scripted.piStatus(s.pi)).toBe("requires_capture");
    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([]);
  });

  it("expires, never declines, an overdue request whose capture claim is stuck while Stripe still holds the card", async () => {
    const s = await subject();
    await claim(s.id, "capture");
    await claimedMinutesAgo(s.id, 3);
    await overdue(s.id);
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual({
      ok: false,
      reason: "not_actionable",
      status: "expired",
    });
    // The stuck claim is released from Stripe's word first; the expiry then claims attempt 2.
    expect(scripted.callsOf("getAuthorization")).toHaveLength(1);
    expect(scripted.callsOf("capture")).toEqual([]);
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:2`, "abandoned"],
    ]);
    expect(await requestRow(s.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
      stripeAttempt: 2,
    });
    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([]);
    await expectInvariant(s.id);
  });

  it("expires a request declined at its very deadline (expires_at = now() on the database's clock)", async () => {
    const s = await subject();
    await overdue(s.id, 0);
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual({
      ok: false,
      reason: "not_actionable",
      status: "expired",
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:1`, "abandoned"],
    ]);
    expect(await requestRow(s.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
    });
    await expectInvariant(s.id);
  });
});

describe("J8.8: one action wins when Approve races Decline or the expiry (07 D24, D25)", () => {
  it("J8.8: Decline while Approve's capture is in flight is refused with no cancel, and the approval stands", async () => {
    const s = await subject();
    const held = scripted.hold("capture");
    const approving = approveLicenseRequest(s.id, s.actor);
    await held.reached;
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual(BUSY);
    expect(scripted.callsOf("cancel")).toEqual([]);
    held.release();
    expect(await approving).toEqual(APPROVED);
    expect(await requestRow(s.id)).toMatchObject({
      status: "approved",
      stripeAttempt: 1,
    });
    expect(await licensesOf(s.id)).toHaveLength(1);
    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([sentOnce("license-approved")]);
    await expectInvariant(s.id);
  });

  it("J8.8: Approve while Decline's cancel is in flight is refused with no capture, and the decline stands", async () => {
    const s = await subject();
    const held = scripted.hold("cancel");
    const declining = declineLicenseRequest(s.id, s.actor);
    await held.reached;
    expect(await approveLicenseRequest(s.id, s.actor)).toEqual(BUSY);
    expect(scripted.callsOf("capture")).toEqual([]);
    held.release();
    expect(await declining).toEqual({ ok: true });
    expect(await requestRow(s.id)).toMatchObject({
      status: "declined",
      statusReason: "creator",
      stripeAttempt: 1,
    });
    expect(await licensesOf(s.id)).toEqual([]);
    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([sentOnce("request-declined")]);
    await expectInvariant(s.id);
  });

  it("J8.8: Approve and Decline at once make one Stripe call, and the request ends as that call says", async () => {
    const s = await subject();
    const [approved, declined] = await Promise.all([
      approveLicenseRequest(s.id, s.actor),
      declineLicenseRequest(s.id, s.actor),
    ]);
    await flushAfter();
    const captures = scripted.callsOf("capture").length;
    const cancels = scripted.callsOf("cancel").length;
    expect(captures + cancels).toBe(1);
    expect(await licensesOf(s.id)).toHaveLength(captures);
    const want =
      captures === 1
        ? {
            status: "approved",
            approved: APPROVED,
            declined: {
              ok: false,
              reason: "not_actionable",
              status: expect.stringMatching(/^(awaiting_approval|approved)$/),
            },
            emails: [sentOnce("license-approved")],
          }
        : {
            status: "declined",
            approved: {
              ok: false,
              reason: "not_actionable",
              status: expect.stringMatching(/^(awaiting_approval|declined)$/),
            },
            declined: { ok: true },
            emails: [sentOnce("request-declined")],
          };
    expect((await requestRow(s.id)).status).toBe(want.status);
    expect(approved).toEqual(want.approved);
    expect(declined).toEqual(want.declined);
    expect(await outcomeEmails(s.id)).toEqual(want.emails);
    await expectInvariant(s.id);
  });

  it("J8.8: Approve and the expiry at once before the deadline: Approve captures, the expiry claims nothing", async () => {
    const s = await subject();
    const [approved, expired] = await Promise.all([
      approveLicenseRequest(s.id, s.actor),
      expireLicenseRequest(s.id, LAZY),
    ]);
    expect(approved).toEqual(APPROVED);
    expect(expired).toBeNull();
    expect(scripted.keys("capture")).toEqual([`pi-capture:${s.id}:1`]);
    expect(scripted.callsOf("cancel")).toEqual([]);
    expect(await licensesOf(s.id)).toHaveLength(1);
    await expectInvariant(s.id);
  });

  it("J8.8: Approve and the expiry at once after the deadline: one expiry under one claim, no capture", async () => {
    const s = await subject();
    await overdue(s.id);
    const [approved, expired] = await Promise.all([
      approveLicenseRequest(s.id, s.actor),
      expireLicenseRequest(s.id, LAZY),
    ]);
    // Before the expire claim, during it, or after it: whichever statement reached Postgres first.
    expect([
      { ok: false, reason: "expired", status: "awaiting_approval" },
      BUSY,
      { ok: false, reason: "not_actionable", status: "expired" },
    ]).toContainEqual(approved);
    // The direct expiry finished it, or Approve scheduled the one that did (02 §8.4).
    expect(expired ?? approved).toMatchObject(
      expired
        ? { changed: true, from: "awaiting_approval", to: "expired" }
        : { ok: false, reason: "expired" },
    );
    await flushAfter();
    expect(await requestRow(s.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
      stripeAttempt: 1,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:1`, "abandoned"],
    ]);
    expect(scripted.callsOf("capture")).toEqual([]);
    expect(await licensesOf(s.id)).toEqual([]);
    expect(await endingsOf(s.id)).toEqual([
      ending("expired", "expired", "lazy"),
    ]);
    await expectInvariant(s.id);
  });

  it("J8.8: the expiry finds Approve's capture in flight past the deadline: it claims nothing, and the approval stands", async () => {
    const s = await subject();
    const held = scripted.hold("capture");
    const approving = approveLicenseRequest(s.id, s.actor);
    await held.reached;
    await overdue(s.id);
    expect(await expireLicenseRequest(s.id, LAZY)).toBeNull();
    expect(scripted.callsOf("cancel")).toEqual([]);
    held.release();
    expect(await approving).toEqual(APPROVED);
    expect(await requestRow(s.id)).toMatchObject({
      status: "approved",
      stripeAttempt: 1,
    });
    expect(await licensesOf(s.id)).toHaveLength(1);
    await expectInvariant(s.id);
  });

  it("J8.8: Approve finds the expiry's cancel in flight: refused with no capture, and the request expires", async () => {
    const s = await subject();
    await overdue(s.id);
    const held = scripted.hold("cancel");
    const expiring = expireLicenseRequest(s.id, LAZY);
    await held.reached;
    expect(await approveLicenseRequest(s.id, s.actor)).toEqual(BUSY);
    expect(scripted.callsOf("capture")).toEqual([]);
    held.release();
    expect(await expiring).toMatchObject({
      changed: true,
      from: "awaiting_approval",
      to: "expired",
    });
    await flushAfter();
    expect(await requestRow(s.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
      stripeAttempt: 1,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:1`, "abandoned"],
    ]);
    await expectInvariant(s.id);
  });
});

describe("expireLicenseRequest and expireDueRequests (03 T9, §7.10; 07 D25, D57, D77)", () => {
  it("claims nothing and asks Stripe nothing before the deadline, or while another claim holds the request", async () => {
    const s = await subject();
    expect(await expireLicenseRequest(s.id, LAZY)).toBeNull();
    const held = await waitingOn(s.live);
    await claim(held.id, "capture");
    await overdue(held.id);
    expect(await expireLicenseRequest(held.id, LAZY)).toBeNull();
    expect(scripted.log).toEqual([]);
    expect(await requestRow(s.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
    });
    expect(await requestRow(held.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
      stripeAttempt: 1,
    });
  });

  it("expires an overdue request under its expire claim: deadline, attempt 1, and no email", async () => {
    const s = await subject();
    await overdue(s.id);
    expect(await expireLicenseRequest(s.id, LAZY)).toMatchObject({
      changed: true,
      from: "awaiting_approval",
      to: "expired",
      effects: [],
    });
    expect(await requestRow(s.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
      expiredAt: expect.any(Date),
      paymentAction: "expire",
      stripeAttempt: 1,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:1`, "abandoned"],
    ]);
    expect(scripted.callsOf("getAuthorization")).toEqual([]);
    expect(await endingsOf(s.id)).toEqual([
      ending("expired", "expired", "lazy"),
    ]);
    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([]);
    await expectInvariant(s.id);
  });

  it("expires one creator's overdue requests, or one request, and leaves the others alone", async () => {
    const mine = await subject();
    await overdue(mine.id);
    const theirs = await subject();
    await overdue(theirs.id);
    expect(await expireDueRequests({ creatorId: mine.creator.id })).toBe(1);
    expect((await requestRow(mine.id)).status).toBe("expired");
    expect(await requestRow(theirs.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
    });

    const second = await waitingOn(theirs.live);
    await overdue(second.id);
    expect(await expireDueRequests({ requestId: second.id })).toBe(1);
    expect((await requestRow(second.id)).status).toBe("expired");
    expect(await requestRow(theirs.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${mine.id}:expire:1`, "abandoned"],
      [`pi-cancel:${second.id}:expire:1`, "abandoned"],
    ]);
  });

  it("skips a claimed, a not-yet-due and a decided request, even when their deadlines come first", async () => {
    const due = await subject();
    const claimed = await waitingOn(due.live);
    await claim(claimed.id, "capture");
    const notDue = await waitingOn(due.live);
    // Approved from Stripe's word with no claim (01 J9.7): only its status keeps it out.
    const decided = await waitingOn(due.live);
    await scripted.movePi(decided.pi, "succeeded");
    expect(await deliverPiEvent("payment_intent.succeeded", decided.id)).toBe(
      "processed",
    );
    expect(await requestRow(decided.id)).toMatchObject({
      status: "approved",
      paymentAction: null,
    });
    await overdue(claimed.id, 5);
    await overdue(decided.id, 4);
    await overdue(due.id, 1);

    // Its one slot goes to the due request: the others are never selected (03 §7.10).
    expect(
      await expireDueRequests({ creatorId: due.creator.id, limit: 1 }),
    ).toBe(1);
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${due.id}:expire:1`, "abandoned"],
    ]);
    expect((await requestRow(due.id)).status).toBe("expired");
    expect(await requestRow(claimed.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
      stripeAttempt: 1,
    });
    expect(await requestRow(notDue.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
    });
    expect((await requestRow(decided.id)).status).toBe("approved");
  });

  it("expires the soonest deadlines first, up to its limit", async () => {
    const s = await subject();
    const later = await waitingOn(s.live);
    const soonest = await waitingOn(s.live);
    await overdue(s.id, 3);
    await overdue(later.id, 1);
    await overdue(soonest.id, 5);
    expect(await expireDueRequests({ creatorId: s.creator.id, limit: 2 })).toBe(
      2,
    );
    expect(scripted.keys("cancel")).toEqual([
      `pi-cancel:${soonest.id}:expire:1`,
      `pi-cancel:${s.id}:expire:1`,
    ]);
    expect((await requestRow(soonest.id)).status).toBe("expired");
    expect((await requestRow(s.id)).status).toBe("expired");
    expect(await requestRow(later.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
    });
  });

  it("counts only the requests now expired: one whose hold Stripe still holds is released, not counted", async () => {
    const s = await subject();
    const second = await waitingOn(s.live);
    await overdue(s.id, 2);
    await overdue(second.id, 1);
    scripted.next("cancel", "transient");
    expect(await expireDueRequests({ creatorId: s.creator.id })).toBe(1);
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:1`, "abandoned"],
      [`pi-cancel:${second.id}:expire:1`, "abandoned"],
    ]);
    expect(await requestRow(s.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 1,
    });
    expect((await requestRow(second.id)).status).toBe("expired");
  });

  it("logs a request whose cancel and Stripe read both fail, keeps its claim, and still expires the next one (07 D26)", async () => {
    recordStderr("license_request.cancel_claim_failed");
    const s = await subject();
    const second = await waitingOn(s.live);
    await overdue(s.id, 2);
    await overdue(second.id, 1);
    scripted.next("cancel", "transient");
    scripted.authorizations(new Error("stripe down"));
    expect(await expireDueRequests({ creatorId: s.creator.id })).toBe(1);
    // Processing… until the stuck-claim reconcile: nothing says "not charged" yet (07 D25).
    expect(await requestRow(s.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "expire",
      stripeAttempt: 1,
    });
    expect((await requestRow(second.id)).status).toBe("expired");
    const { written, events } = stopStderr();
    expect(events).toEqual([
      expect.objectContaining({
        level: "warn",
        requestId: s.id,
        action: "expire",
        error: "Error",
      }),
    ]);
    expect(written).not.toContain(s.row.buyerEmail);
  });

  it("J8.15: a request whose creator never sets up payouts expires at its deadline with the usual cancel, never captured (07 D77)", async () => {
    const s = await subject({
      stripeAccountId: null,
      payoutsStatus: "not_started",
    });
    expect(await approveLicenseRequest(s.id, s.actor)).toEqual({
      ok: false,
      reason: "payouts_not_active",
      status: "awaiting_approval",
    });
    expect(await requestRow(s.id)).toMatchObject({
      stripeAttempt: 0,
      paymentAction: null,
    });
    expect(scripted.log).toEqual([]);

    await overdue(s.id);
    expect(await expireDueRequests({ creatorId: s.creator.id })).toBe(1);
    expect(await requestRow(s.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
      stripeAttempt: 1,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:1`, "abandoned"],
    ]);
    expect(scripted.callsOf("capture")).toEqual([]);
    expect(await licensesOf(s.id)).toEqual([]);
    expect(await getBuyerRequest(s.id, s.token)).toMatchObject({
      status: "expired",
      displayStatus: "expired",
      statusReason: "deadline",
    });
    await expectInvariant(s.id);
  });
});

describe("payment_intent.canceled (02 §8.1; 03 T6, T10, T13; 07 D25, D26)", () => {
  it("J8.7: Stripe's own cancel of an unclaimed hold expires the request (hold_released), with no cancel of ours", async () => {
    const s = await subject();
    await scripted.movePi(s.pi, "canceled");
    expect(await deliverPiEvent("payment_intent.canceled", s.id)).toBe(
      "processed",
    );
    expect(await requestRow(s.id)).toMatchObject({
      status: "expired",
      statusReason: "hold_released",
      expiredAt: expect.any(Date),
      paymentAction: null,
      stripeAttempt: 0,
    });
    expect(scripted.callsOf("cancel")).toEqual([]);
    expect(scripted.callsOf("getAuthorization")).toHaveLength(1);
    expect(await endingsOf(s.id)).toEqual([
      ending("expired", "expired", "stripe"),
    ]);
    expect(await stripeEventsOf(s.id)).toEqual([processedCanceled]);
    await expectInvariant(s.id);
  });

  it("finishes a decline claim as declined, with one request-declined over two deliveries", async () => {
    const s = await subject();
    await claim(s.id, "decline");
    await scripted.movePi(s.pi, "canceled");
    for (let delivery = 0; delivery < 2; delivery += 1) {
      expect(await deliverPiEvent("payment_intent.canceled", s.id)).toBe(
        "processed",
      );
    }
    expect(await requestRow(s.id)).toMatchObject({
      status: "declined",
      statusReason: "creator",
      declinedAt: expect.any(Date),
      stripeAttempt: 1,
    });
    expect(await endingsOf(s.id)).toEqual([
      ending("declined", "declined", "stripe"),
    ]);
    expect(await auditsOf(s.id, "license_request.ignored_event")).toEqual([
      ignoredCanceled("declined"),
    ]);
    expect(scripted.callsOf("getAuthorization")).toHaveLength(1);
    expect(scripted.callsOf("cancel")).toEqual([]);
    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([sentOnce("request-declined")]);
    expect(await stripeEventsOf(s.id)).toEqual([
      processedCanceled,
      processedCanceled,
    ]);
    await expectInvariant(s.id);
  });

  it("finishes an expire claim as expired (deadline)", async () => {
    const s = await subject();
    await overdue(s.id);
    await claim(s.id, "expire");
    await scripted.movePi(s.pi, "canceled");
    expect(await deliverPiEvent("payment_intent.canceled", s.id)).toBe(
      "processed",
    );
    expect(await requestRow(s.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
      stripeAttempt: 1,
    });
    expect(await endingsOf(s.id)).toEqual([
      ending("expired", "expired", "stripe"),
    ]);
    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([]);
    await expectInvariant(s.id);
  });

  it("leaves a fresh capture claim to its holder: nothing changes, and Stripe isn't asked (07 D26)", async () => {
    const s = await subject();
    await claim(s.id, "capture");
    await scripted.movePi(s.pi, "canceled");
    const before = await requestRow(s.id);
    expect(await deliverPiEvent("payment_intent.canceled", s.id)).toBe(
      "processed",
    );
    expect(await requestRow(s.id)).toEqual(before);
    expect(scripted.callsOf("getAuthorization")).toEqual([]);
    expect(await endingsOf(s.id)).toEqual([]);
    expect(await stripeEventsOf(s.id)).toEqual([processedCanceled]);
  });

  it("ends a capture claim stuck for 3 minutes as capture_failed (pi_canceled_during_capture)", async () => {
    const s = await subject();
    await claim(s.id, "capture");
    await claimedMinutesAgo(s.id, 3);
    await scripted.movePi(s.pi, "canceled");
    expect(await deliverPiEvent("payment_intent.canceled", s.id)).toBe(
      "processed",
    );
    expect(await requestRow(s.id)).toMatchObject({
      status: "capture_failed",
      statusReason: "pi_canceled_during_capture",
      captureFailedAt: expect.any(Date),
      stripeAttempt: 1,
    });
    expect(await endingsOf(s.id)).toEqual([
      ending("capture_failed", "capture_failed", "stripe"),
    ]);
    expect(scripted.callsOf("cancel")).toEqual([]);
    expect(await licensesOf(s.id)).toEqual([]);
    await expectInvariant(s.id);
  });

  it("changes nothing while Stripe says the hold still waits: the event alone is never trusted (02 §8.1 step 3)", async () => {
    const s = await subject();
    const before = await requestRow(s.id);
    const audits = await auditsFor(s.id);
    expect(await deliverPiEvent("payment_intent.canceled", s.id)).toBe(
      "processed",
    );
    expect(await requestRow(s.id)).toEqual(before);
    expect(await auditsFor(s.id)).toEqual(audits);
    expect(scripted.callsOf("getAuthorization")).toHaveLength(1);
    expect(scripted.piStatus(s.pi)).toBe("requires_capture");
  });

  it("records the late event on an ended request: one ignored_event by stripe, and Stripe isn't asked (03 T13)", async () => {
    const s = await subject();
    await overdue(s.id);
    expect(await expireLicenseRequest(s.id, LAZY)).toMatchObject({
      changed: true,
      to: "expired",
    });
    const before = await requestRow(s.id);
    expect(await deliverPiEvent("payment_intent.canceled", s.id)).toBe(
      "processed",
    );
    expect(await auditsOf(s.id, "license_request.ignored_event")).toEqual([
      ignoredCanceled("expired"),
    ]);
    expect(await requestRow(s.id)).toEqual(before);
    expect(await endingsOf(s.id)).toEqual([
      ending("expired", "expired", "lazy"),
    ]);
    expect(scripted.callsOf("getAuthorization")).toEqual([]);
    await expectInvariant(s.id);
  });

  it("ignores it while the request is still in checkout: no audit, no Stripe read", async () => {
    const { creator } = await approvingCreator();
    const { row } = await pendingCheckoutRequest(
      await approvableVideo(creator.id),
    );
    expect(await deliverPiEvent("payment_intent.canceled", row.id)).toBe(
      "ignored",
    );
    expect((await requestRow(row.id)).status).toBe("checkout_pending");
    expect(await auditsFor(row.id)).toEqual([]);
    expect(scripted.log).toEqual([]);
    expect(await stripeEventsOf(row.id)).toEqual([processedCanceled]);
  });

  it("fails the delivery when Stripe can't be read, so Stripe sends it again (02 §8.1 step 5)", async () => {
    const s = await subject();
    scripted.authorizations(new Error("stripe down"));
    const event = piEvent("payment_intent.canceled", s.id);
    await expect(onWebhookEvent(event, "cad")).rejects.toThrow("stripe down");
    const [stored] = await db
      .select()
      .from(stripeEvent)
      .where(eq(stripeEvent.id, event.id));
    expect(stored).toMatchObject({ processedAt: null, lastError: "Error" });
    expect(await requestRow(s.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
    });
  });

  it("records money moved late on a declined request (OQ-12): one audit by stripe, still declined, no license", async () => {
    const s = await subject();
    expect(await declineLicenseRequest(s.id, s.actor)).toEqual({ ok: true });
    await scripted.movePi(s.pi, "succeeded");
    expect(await deliverPiEvent("payment_intent.succeeded", s.id)).toBe(
      "processed",
    );
    expect(await auditsOf(s.id, "license_request.money_moved_late")).toEqual([
      {
        data: { piStatus: "succeeded", status: "declined" },
        actorType: "stripe",
      },
    ]);
    expect(await requestRow(s.id)).toMatchObject({
      status: "declined",
      statusReason: "creator",
    });
    expect(await licensesOf(s.id)).toEqual([]);
    // The double sees what the audit records: a declined request whose PaymentIntent succeeded (07 D25).
    expect(scripted.violations).toEqual([
      `getAuthorization ${s.pi}: the request is declined while ${s.pi} is succeeded (07 D25)`,
    ]);
    scripted.violations.splice(0);
  });
});

describe("/r: getBuyerRequest settles its own request before the read (owner answer Q-142 a; 07 D25, D26)", () => {
  it("awaits an overdue request's expiry, then shows it expired; a second load asks Stripe nothing", async () => {
    const s = await subject();
    await overdue(s.id);
    expect(await getBuyerRequest(s.id, s.token)).toMatchObject({
      id: s.id,
      status: "expired",
      displayStatus: "expired",
      statusReason: "deadline",
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:1`, "abandoned"],
    ]);
    expect(await endingsOf(s.id)).toEqual([
      ending("expired", "expired", "lazy"),
    ]);
    const firstLoad = scripted.log.length;
    expect(await getBuyerRequest(s.id, s.token)).toMatchObject({
      status: "expired",
      displayStatus: "expired",
    });
    expect(scripted.log.slice(firstLoad)).toEqual([]);
    await expectInvariant(s.id);
  });

  it("asks Stripe nothing and writes nothing for a wrong key or an unknown id (05 §10)", async () => {
    const s = await subject();
    await overdue(s.id);
    const before = await requestRow(s.id);
    for (const [id, key] of [
      [s.id, generateBuyerToken(s.id).token],
      [s.id, "not-a-key"],
      [randomUUID(), s.token],
    ] as const) {
      expect(await getBuyerRequest(id, key)).toBeNull();
    }
    expect(scripted.log).toEqual([]);
    expect(await requestRow(s.id)).toEqual(before);
  });

  it("asks Stripe nothing for a request not yet due", async () => {
    const s = await subject();
    expect(await getBuyerRequest(s.id, s.token)).toMatchObject({
      status: "awaiting_approval",
      displayStatus: "awaiting_approval",
    });
    expect(scripted.log).toEqual([]);
  });

  it("expires only the request its link opens: another overdue request stays waiting", async () => {
    const s = await subject();
    const other = await waitingOn(s.live);
    await overdue(s.id);
    await overdue(other.id);
    expect(await getBuyerRequest(s.id, s.token)).toMatchObject({
      status: "expired",
    });
    expect(await requestRow(other.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:1`, "abandoned"],
    ]);
  });

  it("shows the request still waiting when the expiry's cancel fails with the hold still on", async () => {
    const s = await subject();
    await overdue(s.id);
    scripted.next("cancel", "transient");
    // Stored awaiting_approval, its displayStatus expired: /r keeps its waiting view (04 §9.10) and says "not charged"
    // only once the expiry is stored (owner answer Q-142 a).
    expect(await getBuyerRequest(s.id, s.token)).toMatchObject({
      status: "awaiting_approval",
      displayStatus: "expired",
      statusReason: null,
    });
    expect(await requestRow(s.id)).toMatchObject({
      paymentAction: null,
      stripeAttempt: 1,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:1`, "abandoned"],
    ]);
  });

  it("shows Processing… when the cancel fails and Stripe can't be read: logged without the key, never thrown", async () => {
    recordStderr("license_request.cancel_claim_failed");
    const s = await subject();
    await overdue(s.id);
    scripted.next("cancel", "transient");
    scripted.authorizations(new Error("stripe down"));
    expect(await getBuyerRequest(s.id, s.token)).toMatchObject({
      status: "awaiting_approval",
      displayStatus: "processing",
    });
    expect(await requestRow(s.id)).toMatchObject({
      paymentAction: "expire",
      stripeAttempt: 1,
    });
    const { written, events } = stopStderr();
    expect(events).toEqual([
      {
        ts: expect.any(String),
        level: "warn",
        event: "license_request.cancel_claim_failed",
        requestId: s.id,
        action: "expire",
        error: "Error",
      },
    ]);
    expect(written).not.toContain(s.token);
    expect(written).not.toContain(s.row.buyerEmail);
  });

  it("finishes a capture claim stuck for 3 minutes from Stripe's succeeded before the read", async () => {
    const s = await subject();
    await claim(s.id, "capture");
    const claimedAt = await claimedMinutesAgo(s.id, 3);
    await scripted.movePi(s.pi, "succeeded");
    expect(await getBuyerRequest(s.id, s.token)).toMatchObject({
      status: "approved",
      displayStatus: "approved",
      licenseCode: expect.stringMatching(LICENSE_CODE_PATTERN),
    });
    expect((await requestRow(s.id)).approvedAt).toEqual(claimedAt);
    expect(scripted.callsOf("capture")).toEqual([]);
    expect(await endingsOf(s.id)).toEqual([
      ending("approved", "captured", "lazy"),
    ]);
    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([sentOnce("license-approved")]);
    await expectInvariant(s.id);
  });

  it("finishes a decline claim stuck for 3 minutes from Stripe's canceled before the read", async () => {
    const s = await subject();
    await claim(s.id, "decline");
    await claimedMinutesAgo(s.id, 3);
    await scripted.movePi(s.pi, "canceled");
    expect(await getBuyerRequest(s.id, s.token)).toMatchObject({
      status: "declined",
      displayStatus: "declined",
      statusReason: "creator",
    });
    expect(scripted.callsOf("cancel")).toEqual([]);
    await flushAfter();
    expect(await outcomeEmails(s.id)).toEqual([sentOnce("request-declined")]);
    await expectInvariant(s.id);
  });
});

describe("the creator pages' lazy layer: settleCreatorRequests (02 §8.4; 07 D26; owner answer Q-142 a)", () => {
  it("reconciles the creator's stuck claims before the read and expires their overdue requests after it; another creator's stay", async () => {
    const mine = await subject();
    await overdue(mine.id);
    const stuck = await waitingOn(mine.live);
    await claim(stuck.id, "capture");
    await claimedMinutesAgo(stuck.id, 3);
    await scripted.movePi(stuck.pi, "succeeded");
    const theirs = await subject();
    await overdue(theirs.id);
    const theirStuck = await waitingOn(theirs.live);
    await claim(theirStuck.id, "capture");
    const theirClaimedAt = await claimedMinutesAgo(theirStuck.id, 3);
    await scripted.movePi(theirStuck.pi, "succeeded");

    await settleCreatorRequests({ creatorId: mine.creator.id });
    // Awaited: the page then reads the outcome, not Processing….
    expect((await requestRow(stuck.id)).status).toBe("approved");
    await flushAfter();
    expect(await requestRow(mine.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
    });
    expect(await requestRow(theirs.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 0,
    });
    expect(await requestRow(theirStuck.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
      paymentActionAt: theirClaimedAt,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${mine.id}:expire:1`, "abandoned"],
    ]);
    expect(
      scripted.callsOf("getAuthorization").map((call) => call.args[0]),
    ).toEqual([stuck.pi]);
  });

  it("with a requestId, settles only that request, and only when it is the creator's", async () => {
    const mine = await subject();
    const sibling = await waitingOn(mine.live);
    const theirs = await subject();
    for (const id of [mine.id, sibling.id, theirs.id]) await overdue(id);
    await settleCreatorRequests({
      creatorId: mine.creator.id,
      requestId: mine.id,
    });
    await settleCreatorRequests({
      creatorId: mine.creator.id,
      requestId: theirs.id,
    });
    await flushAfter();
    expect((await requestRow(mine.id)).status).toBe("expired");
    for (const id of [sibling.id, theirs.id]) {
      expect(await requestRow(id)).toMatchObject({
        status: "awaiting_approval",
        paymentAction: null,
        stripeAttempt: 0,
      });
    }
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${mine.id}:expire:1`, "abandoned"],
    ]);
  });
});

describe("displayStatus in the creator's reads (owner answer Q-142 a; 07 D26)", () => {
  it("shows an overdue unclaimed request Expired and a claimed one Processing…, with the stored status and no write", async () => {
    const s = await subject();
    await overdue(s.id);
    const held = await waitingOn(s.live);
    await claim(held.id, "capture");
    await overdue(held.id);
    const before = [await requestRow(s.id), await requestRow(held.id)];

    expect(await listInbox(s.creator.id, "waiting")).toEqual([
      expect.objectContaining({
        id: s.id,
        status: "awaiting_approval",
        displayStatus: "expired",
      }),
      expect.objectContaining({
        id: held.id,
        status: "awaiting_approval",
        displayStatus: "processing",
      }),
    ]);
    expect(await getRequestForCreator(s.creator.id, s.id)).toMatchObject({
      status: "awaiting_approval",
      displayStatus: "expired",
    });
    expect(await getRequestForCreator(s.creator.id, held.id)).toMatchObject({
      status: "awaiting_approval",
      displayStatus: "processing",
    });
    // Pure reads: nothing asked of Stripe, nothing written (the lazy layer does that).
    expect(scripted.log).toEqual([]);
    expect([await requestRow(s.id), await requestRow(held.id)]).toEqual(before);
  });
});

describe("forceOverdue, the dev clock (scripts/dev-expire-request.ts; 02 §11.1; 07 D51, D57)", () => {
  it("moves a waiting, unclaimed request's deadline to 1 ms after its authorization; the expiry then takes it", async () => {
    const s = await subject();
    // An hour into its wait, so 1 ms after the authorization is past on the database's clock as well as the host's.
    const anHourAgo = new Date(Date.now() - HOUR_MS);
    await db
      .update(licenseRequest)
      .set({ authorizedAt: anHourAgo, updatedAt: anHourAgo })
      .where(eq(licenseRequest.id, s.id));
    const before = await requestRow(s.id);

    const expiresAt = await forceOverdue(db, s.id);
    const after = await requestRow(s.id);
    expect(expiresAt).toEqual(after.expiresAt);
    expect(after.expiresAt?.getTime()).toBe(anHourAgo.getTime() + 1);
    // license_request_expires_after_auth and _hold_margin hold.
    expect(after.expiresAt?.getTime()).toBeLessThanOrEqual(
      (after.captureBefore?.getTime() ?? 0) - 6 * HOUR_MS,
    );
    expect(after.updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime(),
    );
    expect({ ...after, expiresAt: null, updatedAt: null }).toEqual({
      ...before,
      expiresAt: null,
      updatedAt: null,
    });
    expect(scripted.log).toEqual([]);

    expect(await expireDueRequests({ requestId: s.id })).toBe(1);
    expect(await requestRow(s.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
      stripeAttempt: 1,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:expire:1`, "abandoned"],
    ]);
  });

  it("leaves a claimed, a decided or an unknown request alone (nothing to do)", async () => {
    const s = await subject();
    await claim(s.id, "capture");
    const decided = await waitingOn(s.live);
    expect(await declineLicenseRequest(decided.id, s.actor)).toEqual({
      ok: true,
    });
    for (const id of [s.id, decided.id]) {
      const before = await requestRow(id);
      expect(await forceOverdue(db, id)).toBeNull();
      expect(await requestRow(id)).toEqual(before);
    }
    expect(await forceOverdue(db, randomUUID())).toBeNull();
  });
});

describe("the declineRequest action (02 §6.1, §8.2; 07 D28)", () => {
  it("refuses an id that isn't a uuid: invalid_input, nothing asked", async () => {
    expect(await declineRequest({ requestId: "nope" })).toEqual({
      ok: false,
      error: { code: "invalid_input", message: GENERIC_ERROR_MESSAGE },
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(scripted.log).toEqual([]);
  });

  it("declines the signed-in creator's request and refreshes once", async () => {
    const owner = await signedInCreator();
    const s = await waitingOn(await approvableVideo(owner.creatorId));
    expect(await declineRequest({ requestId: s.id })).toEqual({
      ok: true,
      data: { ok: true },
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(await requestRow(s.id)).toMatchObject({
      status: "declined",
      statusReason: "creator",
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${s.id}:decline:1`, "requested_by_customer"],
    ]);
  });

  it("never takes a reason from the browser: an extra reason key is dropped, and the decline is the creator's", async () => {
    const owner = await signedInCreator();
    const s = await waitingOn(await approvableVideo(owner.creatorId));
    const input = {
      requestId: s.id,
      reason: "video_disabled",
    } as Parameters<typeof declineRequest>[0];
    expect(await declineRequest(input)).toEqual({
      ok: true,
      data: { ok: true },
    });
    expect(await requestRow(s.id)).toMatchObject({
      status: "declined",
      statusReason: "creator",
    });
  });
});
