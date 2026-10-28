import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeCheckoutExpire,
  fakeCheckoutPay,
} from "../../src/app/dev/fake-checkout/[requestId]/actions";
import { db, pool } from "../../src/db/client";
import { licenseRequest, stripeEvent, video } from "../../src/db/schema";
import type { LicenseRequest, Video } from "../../src/db/schema/types";
import type { Currency } from "../../src/lib/domain/values";
import { DAY_MS, HOUR_MS } from "../../src/lib/time";
import type { Actor } from "../../src/server/auth/actor";
import { env } from "../../src/server/env";
import { getBuyerRequest } from "../../src/server/licensing/request-status";
import {
  markAuthorized,
  reconcileCheckoutReturn,
} from "../../src/server/licensing/requests";
import { applyTransition } from "../../src/server/licensing/state-machine";
import type { PaymentsEvent } from "../../src/server/payments/driver";
import { onWebhookEvent } from "../../src/server/payments/events";
import { generateBuyerToken } from "../../src/server/tokens/buyer-token";
import { unpublishVideo } from "../../src/server/videos/lifecycle";
import { redirectTo } from "../helpers/actions";
import { auditsOf } from "../helpers/connect-flow";
import {
  insertCreator,
  insertLicenseRequest,
  publishVideo,
} from "../helpers/factories";
import { captureLogEvents } from "../helpers/logs";
import {
  pricedCreator,
  readyLibraryVideo,
  readyUpload,
} from "../helpers/ready-videos";
import {
  createScriptedPayments,
  type ScriptedPayments,
} from "../helpers/scripted-payments";

// Authorization through the event path (P16b; 02 §8.1, §8.3; 03 T2, T3, T11–T13; 07 D24, D27, D28, D32, D35, D74,
// D81, D95, D96; owner answers Q-119 a, Q-122 a, Q-123 a): the fake checkout's events and Stripe's, deduplicated in
// stripe_event, through markAuthorized's asserts, the video and the hold's length, with every abandoned hold canceled
// after its commit, once. The payments driver is the scripted double: the fake's answers unless a test scripts others.

const payments = vi.hoisted(() => ({
  current: undefined as ScriptedPayments | undefined,
}));
vi.mock("@/server/payments/registry", async (importOriginal) => {
  const registry =
    await importOriginal<typeof import("@/server/payments/registry")>();
  return {
    ...registry,
    paymentsDriver: (currency: Currency) =>
      payments.current?.driverFor(currency) ??
      registry.paymentsDriver(currency),
  };
});

let scripted: ScriptedPayments;
beforeEach(() => {
  scripted = createScriptedPayments();
  payments.current = scripted;
});
afterEach(() => vi.restoreAllMocks());

const WEBHOOK: Actor = { kind: "system", source: "webhook" };

/** A checkout_pending request on `target` (a fresh published upload when none), with a real key and its fake session. */
async function pendingRequest(target?: Video) {
  const live =
    target ??
    (await publishVideo(await readyUpload((await insertCreator()).id)));
  const id = randomUUID();
  const key = generateBuyerToken(id);
  const row = await insertLicenseRequest(live, {
    id,
    stripeCheckoutSessionId: `cs_fake_${id}`,
    buyerTokenHash: key.hash,
    buyerTokenEnc: key.enc,
  });
  return { row, token: key.token, live };
}

async function requestRow(id: string): Promise<LicenseRequest> {
  const [row] = await db
    .select()
    .from(licenseRequest)
    .where(eq(licenseRequest.id, id));
  if (!row) throw new Error("no request");
  return row;
}

async function eventRow(id: string) {
  const [row] = await db
    .select()
    .from(stripeEvent)
    .where(eq(stripeEvent.id, id));
  if (!row) throw new Error("no event");
  return row;
}

const transitionsOf = (id: string) =>
  auditsOf(id, "license_request.transition");

const base = () => ({
  id: `evt_test_${randomUUID()}`,
  livemode: false,
  appUrl: env.APP_URL,
});

const completed = (row: LicenseRequest): PaymentsEvent => ({
  ...base(),
  type: "checkout.session.completed",
  sessionId: `cs_fake_${row.id}`,
  requestId: row.id,
  paymentIntentId: `pi_fake_${row.id}`,
});

const expired = (row: LicenseRequest): PaymentsEvent => ({
  ...base(),
  type: "checkout.session.expired",
  sessionId: `cs_fake_${row.id}`,
  requestId: row.id,
});

const paymentIntentEvent = (
  row: LicenseRequest,
  type:
    | "payment_intent.amount_capturable_updated"
    | "payment_intent.succeeded"
    | "payment_intent.payment_failed",
): PaymentsEvent => ({
  ...base(),
  type,
  paymentIntentId: `pi_fake_${row.id}`,
  requestId: row.id,
});

/** The cancels the double saw: their key, Stripe's reason and the request's committed status at the call. */
const cancels = () =>
  scripted
    .callsOf("cancel")
    .map(({ key, args, status }) => ({ key, reason: args[1], status }));

/** What an abandon (T3) leaves: the hold's ids, one attempt counted, never authorized. */
async function expectAbandoned(id: string, reason: string) {
  expect(await requestRow(id)).toMatchObject({
    status: "abandoned",
    statusReason: reason,
    stripePaymentIntentId: `pi_fake_${id}`,
    stripeChargeId: `ch_fake_${id}`,
    stripeAttempt: 1,
    authorizedAt: null,
    captureBefore: null,
    expiresAt: null,
    abandonedAt: expect.any(Date),
  });
  expect(await transitionsOf(id)).toEqual([
    {
      data: { from: "checkout_pending", to: "abandoned", event: reason },
      actorType: "stripe",
    },
  ]);
  expect(cancels()).toEqual([
    {
      key: `pi-cancel:${id}:${reason}:1`,
      reason: "abandoned",
      status: "abandoned",
    },
  ]);
}

describe("the fake checkout's Pay and Let it expire (T2, T11; 07 D35, D96)", () => {
  it("Pay authorizes the request for its 72 h window, records the event once and lands on the success URL", async () => {
    const { row, token } = await pendingRequest();
    const before = Date.now();
    await expect(fakeCheckoutPay(row.id)).rejects.toMatchObject(
      redirectTo(`/r/${row.id}?t=${token}&session_id=cs_fake_${row.id}`),
    );
    const after = await requestRow(row.id);
    expect(after).toMatchObject({
      status: "awaiting_approval",
      stripePaymentIntentId: `pi_fake_${row.id}`,
      stripeChargeId: `ch_fake_${row.id}`,
      stripeAttempt: 0,
      paymentAction: null,
      abandonedAt: null,
      statusReason: null,
    });
    const authorizedAt = after.authorizedAt?.getTime() ?? Number.NaN;
    expect(authorizedAt).toBeGreaterThanOrEqual(before);
    expect(after.expiresAt?.getTime()).toBe(authorizedAt + 72 * HOUR_MS);
    expect(after.captureBefore?.getTime()).toBe(authorizedAt + 7 * DAY_MS);
    expect(await transitionsOf(row.id)).toEqual([
      {
        data: {
          from: "checkout_pending",
          to: "awaiting_approval",
          event: "authorized",
        },
        actorType: "stripe",
      },
    ]);
    const events = await db
      .select()
      .from(stripeEvent)
      .where(eq(stripeEvent.licenseRequestId, row.id));
    expect(events).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^evt_fake_[0-9a-f-]{36}$/),
        platformCurrency: "cad",
        type: "checkout.session.completed",
        livemode: false,
        objectId: `cs_fake_${row.id}`,
        attempts: 1,
        processedAt: expect.any(Date),
        lastError: null,
      }),
    ]);
    expect(cancels()).toEqual([]);

    // A request past checkout goes back to its /r page, with no event.
    await expect(fakeCheckoutPay(row.id)).rejects.toMatchObject(
      redirectTo(`/r/${row.id}?t=${token}`),
    );
    await expect(fakeCheckoutExpire(row.id)).rejects.toMatchObject(
      redirectTo(`/r/${row.id}?t=${token}`),
    );
    expect(
      await db
        .select({ id: stripeEvent.id })
        .from(stripeEvent)
        .where(eq(stripeEvent.licenseRequestId, row.id)),
    ).toHaveLength(1);
    expect(await getBuyerRequest(row.id, token)).toMatchObject({
      status: "awaiting_approval",
      expiresAt: after.expiresAt?.toISOString(),
    });
  });

  it("Let it expire abandons the request as checkout_expired, with no hold to cancel", async () => {
    const { row, token } = await pendingRequest();
    await expect(fakeCheckoutExpire(row.id)).rejects.toMatchObject(
      redirectTo(`/r/${row.id}?t=${token}`),
    );
    expect(await requestRow(row.id)).toMatchObject({
      status: "abandoned",
      statusReason: "checkout_expired",
      abandonedAt: expect.any(Date),
      stripeAttempt: 0,
      stripePaymentIntentId: null,
      authorizedAt: null,
    });
    expect(await transitionsOf(row.id)).toEqual([
      {
        data: {
          from: "checkout_pending",
          to: "abandoned",
          event: "checkout_expired",
        },
        actorType: "stripe",
      },
    ]);
    expect(cancels()).toEqual([]);
    expect(await getBuyerRequest(row.id, token)).toMatchObject({
      status: "abandoned",
      statusReason: "checkout_expired",
    });
  });
});

describe("duplicate and late events (02 §8.1; 03 T13)", () => {
  it("takes one event id once: a second delivery is a duplicate", async () => {
    const { row } = await pendingRequest();
    const event = completed(row);
    expect(await onWebhookEvent(event, "cad")).toBe("processed");
    expect(await onWebhookEvent(event, "cad")).toBe("duplicate");
    expect(await transitionsOf(row.id)).toHaveLength(1);
    expect((await eventRow(event.id)).attempts).toBe(1);
  });

  it("records a second, distinct completed event and changes nothing", async () => {
    const { row } = await pendingRequest();
    await onWebhookEvent(completed(row), "cad");
    const authorized = await requestRow(row.id);
    expect(await onWebhookEvent(completed(row), "cad")).toBe("processed");
    expect(await requestRow(row.id)).toEqual(authorized);
    expect(await transitionsOf(row.id)).toHaveLength(1);
    expect(await auditsOf(row.id, "license_request.ignored_event")).toEqual([
      {
        data: { from: "awaiting_approval", event: "authorized" },
        actorType: "stripe",
      },
    ]);
  });

  it("keeps an authorized request waiting when its session's expiry comes late", async () => {
    const { row } = await pendingRequest();
    await onWebhookEvent(completed(row), "cad");
    expect(await onWebhookEvent(expired(row), "cad")).toBe("processed");
    expect((await requestRow(row.id)).status).toBe("awaiting_approval");
    expect(await auditsOf(row.id, "license_request.ignored_event")).toEqual([
      {
        data: { from: "awaiting_approval", event: "checkout_expired" },
        actorType: "stripe",
      },
    ]);
  });

  it("keeps an expired checkout abandoned when a completed event comes late, asking Stripe nothing", async () => {
    const { row } = await pendingRequest();
    await onWebhookEvent(expired(row), "cad");
    const calls = scripted.log.length;
    expect(await onWebhookEvent(completed(row), "cad")).toBe("processed");
    expect(scripted.log).toHaveLength(calls);
    expect(await requestRow(row.id)).toMatchObject({
      status: "abandoned",
      statusReason: "checkout_expired",
    });
    expect(await transitionsOf(row.id)).toHaveLength(1);
    expect(await auditsOf(row.id, "license_request.ignored_event")).toEqual([
      { data: { from: "abandoned", event: "authorized" }, actorType: "stripe" },
    ]);
  });
});

describe("the D32 asserts (07 D32, D74, D95): each one alone abandons the request as amount_mismatch", () => {
  it.each([
    ["amountCents", { getAuthorization: { amountCents: 16501 } }],
    ["currency", { getAuthorization: { currency: "usd" } }],
    ["sessionCurrency", { retrieveCheckout: { currency: "usd" } }],
    ["applicationFeeCents", { getAuthorization: { applicationFeeCents: 100 } }],
    ["destination", { getAuthorization: { destination: "acct_fake_other" } }],
    ["onBehalfOf", { getAuthorization: { onBehalfOf: "acct_fake_other" } }],
    [
      "transferGroup",
      { getAuthorization: { transferGroup: "license-request:other" } },
    ],
    [
      "captureMethod",
      { getAuthorization: { captureMethod: "automatic" as const } },
    ],
    ["metadataRequestId", { getAuthorization: { metadataRequestId: null } }],
  ])("%s", async (field, script) => {
    const { row } = await pendingRequest();
    scripted.script(script);
    expect(await onWebhookEvent(completed(row), "cad")).toBe("processed");
    await expectAbandoned(row.id, "amount_mismatch");
    expect(await auditsOf(row.id, "license_request.amount_mismatch")).toEqual([
      { data: { fields: [field] }, actorType: "stripe" },
    ]);
  });
});

describe("the hold's length and the video (03 T2, T3; 07 D27, D81)", () => {
  it("abandons a hold that leaves less than an hour to approve as hold_too_short", async () => {
    const { row } = await pendingRequest();
    scripted.script({
      getAuthorization: { captureBefore: new Date(Date.now() + 6.5 * HOUR_MS) },
    });
    await onWebhookEvent(completed(row), "cad");
    await expectAbandoned(row.id, "hold_too_short");
  });

  it("abandons the request as video_unavailable when the video was turned off during checkout", async () => {
    const creator = await insertCreator();
    const live = await publishVideo(await readyUpload(creator.id));
    const { row } = await pendingRequest(live);
    await unpublishVideo(
      { kind: "creator", userId: creator.userId, creatorId: creator.id },
      live.id,
    );
    await onWebhookEvent(completed(row), "cad");
    await expectAbandoned(row.id, "video_unavailable");
  });

  it("abandons the request as video_unavailable when the video was disabled during checkout", async () => {
    const { row, live } = await pendingRequest();
    await db
      .update(video)
      .set({
        status: "disabled",
        disabledAt: new Date(),
        disabledReason: "other",
      })
      .where(eq(video.id, live.id));
    await onWebhookEvent(completed(row), "cad");
    await expectAbandoned(row.id, "video_unavailable");
  });

  it("abandons the request as video_unavailable when a mock posting hides the video (07 D51)", async () => {
    const { creator } = await pricedCreator();
    const demo = await publishVideo(await readyLibraryVideo(creator.id));
    const { row } = await pendingRequest(demo);
    await markAuthorized(row.id, WEBHOOK, []);
    await expectAbandoned(row.id, "video_unavailable");
  });

  it("keeps the cancel's failure on record, the request abandoned: the hold lapses uncharged", async () => {
    const failures = [
      [
        { ok: false, kind: "permanent", code: "resource_missing" },
        { kind: "permanent", code: "resource_missing" },
      ],
      [new Error("socket hang up"), { kind: "ambiguous", code: "Error" }],
    ] as const;
    for (const [outcome, recorded] of failures) {
      const { row } = await pendingRequest();
      scripted.script({
        getAuthorization: { amountCents: 1 },
        cancel: outcome,
      });
      expect(await onWebhookEvent(completed(row), "cad")).toBe("processed");
      expect((await requestRow(row.id)).status).toBe("abandoned");
      expect(await auditsOf(row.id, "license_request.cancel_failed")).toEqual([
        {
          data: { reason: "amount_mismatch", ...recorded },
          actorType: "stripe",
        },
      ]);
    }
  });
});

describe("the buyer's return (02 §8.3; owner answer Q-119 a)", () => {
  it("changes nothing while the session is open: the fake's before Pay", async () => {
    const { row, token } = await pendingRequest();
    await reconcileCheckoutReturn(row.id, token, `cs_fake_${row.id}`);
    expect((await requestRow(row.id)).status).toBe("checkout_pending");
    expect(scripted.callsOf("getAuthorization")).toEqual([]);
  });

  it("authorizes a completed session with a held card, as the return URL", async () => {
    const { row, token } = await pendingRequest();
    scripted.script({ retrieveCheckout: { status: "complete" } });
    await reconcileCheckoutReturn(row.id, token, `cs_fake_${row.id}`);
    expect((await requestRow(row.id)).status).toBe("awaiting_approval");
    expect(await transitionsOf(row.id)).toEqual([
      {
        data: {
          from: "checkout_pending",
          to: "awaiting_approval",
          event: "authorized",
          source: "return_url",
        },
        actorType: "system",
      },
    ]);
  });

  it("asks Stripe nothing for a wrong session id or a wrong key", async () => {
    const { row, token } = await pendingRequest();
    scripted.script({ retrieveCheckout: { status: "complete" } });
    await reconcileCheckoutReturn(row.id, token, `cs_fake_${randomUUID()}`);
    await reconcileCheckoutReturn(row.id, "A".repeat(43), `cs_fake_${row.id}`);
    expect((await requestRow(row.id)).status).toBe("checkout_pending");
    expect(scripted.log).toEqual([]);
  });

  it("changes nothing while the PaymentIntent isn't held", async () => {
    const { row, token } = await pendingRequest();
    scripted.script({
      retrieveCheckout: { status: "complete" },
      getAuthorization: { status: "requires_payment_method" },
    });
    await reconcileCheckoutReturn(row.id, token, `cs_fake_${row.id}`);
    expect(await onWebhookEvent(completed(row), "cad")).toBe("processed");
    expect((await requestRow(row.id)).status).toBe("checkout_pending");
    expect(await transitionsOf(row.id)).toEqual([]);
    expect(await auditsOf(row.id, "license_request.ignored_event")).toEqual([]);
  });

  it("lets /r confirm a return, and show the stored status when Stripe can't be read", async () => {
    const { row, token } = await pendingRequest();
    scripted.script({ retrieveCheckout: { status: "complete" } });
    expect(
      await getBuyerRequest(row.id, token, `cs_fake_${row.id}`),
    ).toMatchObject({ status: "awaiting_approval" });

    const other = await pendingRequest();
    scripted.script({ retrieveCheckout: new Error("stripe down") });
    const logged = captureLogEvents("license_request.return_failed");
    const shown = await getBuyerRequest(
      other.row.id,
      other.token,
      `cs_fake_${other.row.id}`,
    );
    const { written, events } = logged();
    expect(shown).toMatchObject({ status: "checkout_pending" });
    expect(events).toEqual([
      expect.objectContaining({
        event: "license_request.return_failed",
        requestId: other.row.id,
        error: "Error",
      }),
    ]);
    expect(written).not.toContain(other.token);
  });
});

/**
 * Waits until `n` sessions wait on a lock: both arrivals queued behind the test's (the second may wait on the first,
 * which holds the row's place in the queue).
 */
async function waitForLockWaiters(n: number) {
  await vi.waitFor(
    async () => {
      const { rows } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_stat_activity where cardinality(pg_blocking_pids(pid)) > 0`,
      );
      expect(rows[0]?.n).toBe(n);
    },
    { timeout: 10_000, interval: 20 },
  );
}

describe("the webhook and the return at once (02 §8.1, §8.3; 07 D24)", () => {
  it.each([
    ["authorizes", {}, "awaiting_approval", 0],
    ["abandons", { getAuthorization: { amountCents: 1 } }, "abandoned", 1],
  ] as const)(
    "%s once, with at most one cancel",
    async (_, script, status, cancelCount) => {
      const { row, token } = await pendingRequest();
      scripted.script({ retrieveCheckout: { status: "complete" }, ...script });
      // Hold the row so both arrivals queue on applyTransition's lock, then let them go.
      const holder = await pool.connect();
      try {
        await holder.query("begin");
        await holder.query(
          "select 1 from license_request where id = $1 for update",
          [row.id],
        );
        const both = Promise.all([
          onWebhookEvent(completed(row), "cad"),
          reconcileCheckoutReturn(row.id, token, `cs_fake_${row.id}`),
        ]);
        await waitForLockWaiters(2);
        await holder.query("commit");
        await both;
      } finally {
        // Closed, not pooled: after a failure its transaction may still be open.
        holder.release(true);
      }
      expect((await requestRow(row.id)).status).toBe(status);
      expect(await transitionsOf(row.id)).toHaveLength(1);
      expect(cancels()).toHaveLength(cancelCount);
    },
  );
});

describe("events that change nothing (02 §8.1; 03 T12)", () => {
  it("ignores an event for an unknown or malformed request, and marks it processed", async () => {
    const logged = captureLogEvents("stripe_event.unmatched");
    const ids: string[] = [];
    for (const requestId of [randomUUID(), "not-a-uuid", null]) {
      const event: PaymentsEvent = {
        ...base(),
        type: "checkout.session.completed",
        sessionId: `cs_fake_${randomUUID()}`,
        requestId,
        paymentIntentId: null,
      };
      ids.push(event.id);
      expect(await onWebhookEvent(event, "cad")).toBe("ignored");
      expect(await eventRow(event.id)).toMatchObject({
        processedAt: expect.any(Date),
        licenseRequestId: null,
        lastError: null,
      });
    }
    expect(logged().events).toEqual(
      ids.map((eventId) => ({
        ts: expect.any(String),
        level: "warn",
        event: "stripe_event.unmatched",
        eventId,
        type: "checkout.session.completed",
      })),
    );
    expect(scripted.log).toEqual([]);
  });

  it("authorizes on the PaymentIntent's own event as on the session's (02 §8.1 row 1)", async () => {
    const { row } = await pendingRequest();
    const event = paymentIntentEvent(
      row,
      "payment_intent.amount_capturable_updated",
    );
    expect(await onWebhookEvent(event, "cad")).toBe("processed");
    expect((await requestRow(row.id)).status).toBe("awaiting_approval");
    expect(await eventRow(event.id)).toMatchObject({
      objectId: `pi_fake_${row.id}`,
      licenseRequestId: row.id,
    });
  });

  it("finds the request by its stored session when the event names none", async () => {
    const { row } = await pendingRequest();
    const event = { ...completed(row), requestId: null };
    expect(await onWebhookEvent(event, "cad")).toBe("processed");
    expect((await requestRow(row.id)).status).toBe("awaiting_approval");
    expect((await eventRow(event.id)).licenseRequestId).toBe(row.id);
  });

  it("records a failed payment and changes nothing (T12)", async () => {
    const { row } = await pendingRequest();
    const event = paymentIntentEvent(row, "payment_intent.payment_failed");
    expect(await onWebhookEvent(event, "cad")).toBe("processed");
    expect((await requestRow(row.id)).status).toBe("checkout_pending");
    expect(await auditsOf(row.id, "license_request.payment_failed")).toEqual([
      { data: { from: "checkout_pending" }, actorType: "stripe" },
    ]);
    expect(await eventRow(event.id)).toMatchObject({
      objectId: `pi_fake_${row.id}`,
      licenseRequestId: row.id,
    });
  });

  it("ignores the event types later prompts handle, and Stripe's others", async () => {
    const { row } = await pendingRequest();
    const succeeded = paymentIntentEvent(row, "payment_intent.succeeded");
    expect(await onWebhookEvent(succeeded, "cad")).toBe("ignored");
    expect(await eventRow(succeeded.id)).toMatchObject({
      processedAt: expect.any(Date),
      licenseRequestId: row.id,
    });
    const other: PaymentsEvent = {
      ...base(),
      type: "ignored",
      stripeType: "charge.refunded",
    };
    expect(await onWebhookEvent(other, "cad")).toBe("ignored");
    expect(await eventRow(other.id)).toMatchObject({
      type: "charge.refunded",
      objectId: null,
      processedAt: expect.any(Date),
    });
    expect((await requestRow(row.id)).status).toBe("checkout_pending");
  });

  it("only records a PaymentIntent already charged during checkout (owner answer Q-123 a)", async () => {
    const { row } = await pendingRequest();
    scripted.script({ getAuthorization: { status: "succeeded" } });
    expect(await onWebhookEvent(completed(row), "cad")).toBe("processed");
    expect((await requestRow(row.id)).status).toBe("checkout_pending");
    expect(await auditsOf(row.id, "license_request.ignored_event")).toEqual([
      {
        data: {
          from: "checkout_pending",
          event: "authorized",
          piStatus: "succeeded",
        },
        actorType: "stripe",
      },
    ]);
    expect(cancels()).toEqual([]);
  });
});

describe("another platform account's event (07 D96)", () => {
  it("ignores a cad request's event from the usd account as currency_mismatch, before any payments call", async () => {
    const { row } = await pendingRequest();
    const event = completed(row);
    expect(await onWebhookEvent(event, "usd")).toBe("ignored");
    expect(await eventRow(event.id)).toMatchObject({
      platformCurrency: "usd",
      processedAt: expect.any(Date),
      lastError: "currency_mismatch",
      licenseRequestId: row.id,
    });
    expect(await auditsOf(event.id, "stripe_event.currency_mismatch")).toEqual([
      { data: { requestId: row.id }, actorType: "stripe" },
    ]);
    expect((await requestRow(row.id)).status).toBe("checkout_pending");
    expect(await transitionsOf(row.id)).toEqual([]);
    expect(scripted.log).toEqual([]);
  });
});

describe("a failure while handling an event (02 §8.1 step 4)", () => {
  it("keeps the error's class, not its message, and handles the event again on the next delivery", async () => {
    const { row } = await pendingRequest();
    const event = completed(row);
    scripted.script({
      getAuthorization: new Error(`boom for ${row.buyerEmail}`),
    });
    await expect(onWebhookEvent(event, "cad")).rejects.toThrow("boom");
    expect(await eventRow(event.id)).toMatchObject({
      processedAt: null,
      lastError: "Error",
      attempts: 1,
    });
    scripted.script({ getAuthorization: undefined });
    expect(await onWebhookEvent(event, "cad")).toBe("processed");
    expect(await eventRow(event.id)).toMatchObject({
      processedAt: expect.any(Date),
      lastError: null,
      attempts: 2,
    });
    expect((await requestRow(row.id)).status).toBe("awaiting_approval");
  });
});

describe("applyTransition (02 §5.7)", () => {
  it("refuses a patch that doesn't fit its event before reading the row, and an unknown request", async () => {
    const { row } = await pendingRequest();
    const now = new Date();
    const attempts = [
      ["authorized", { stripePaymentIntentId: `pi_fake_${row.id}` }],
      [
        "authorized",
        {
          stripePaymentIntentId: `pi_fake_${row.id}`,
          authorizedAt: now,
          expiresAt: now,
        },
      ],
      ["hold_too_short", { abandonedAt: now, statusReason: "amount_mismatch" }],
      [
        "amount_mismatch",
        {
          abandonedAt: now,
          statusReason: "amount_mismatch",
          authorizedAt: now,
        },
      ],
    ] as const;
    for (const [event, patch] of attempts) {
      await expect(
        db.transaction((tx) =>
          applyTransition(tx, row.id, event, patch, WEBHOOK),
        ),
      ).rejects.toThrow(`applyTransition ${event}`);
    }
    await expect(
      db.transaction((tx) =>
        applyTransition(
          tx,
          randomUUID(),
          "checkout_expired",
          { abandonedAt: now, statusReason: "checkout_expired" },
          WEBHOOK,
        ),
      ),
    ).rejects.toThrow("unknown request");
    expect(await requestRow(row.id)).toEqual(row);
  });
});
