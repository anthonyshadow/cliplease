import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/client";
import { auditEvent } from "../../src/db/schema";
import type { LicenseRequest } from "../../src/db/schema/types";
import type { LicenseRequestStatus } from "../../src/lib/domain/values";
import { LICENSE_CODE_PATTERN } from "../../src/lib/licensing/snapshot";
import type { LicenseRequestEvent } from "../../src/lib/licensing/transitions";
import { MINUTE_MS } from "../../src/lib/time";
import { type Actor, LAZY } from "../../src/server/auth/actor";
import { approveLicenseRequest } from "../../src/server/licensing/approve";
import { getBuyerRequest } from "../../src/server/licensing/request-status";
import {
  declineLicenseRequest,
  expireLicenseRequest,
} from "../../src/server/licensing/requests";
import {
  applyTransition,
  claimPaymentAction,
  reconcileFromStripe,
  reconcileStuckClaims,
} from "../../src/server/licensing/state-machine";
import type { PiStatus } from "../../src/server/payments/driver";
import type { WebhookOutcome } from "../../src/server/payments/events";
import { flushAfter } from "../helpers/after";
import {
  approvableVideo,
  approvingCreator,
  overdue,
  waitingRequest,
} from "../helpers/approval-fixtures";
import { auditsOf } from "../helpers/connect-flow";
import { requestRow } from "../helpers/factories";
import { AFTER_FAILED, recordStderr, stopStderr } from "../helpers/logs";
import {
  deliverPiEvent,
  eventFor,
  type PiEventType,
} from "../helpers/pi-events";
import {
  endingsOf,
  licensesOf,
  movementsOf,
  outcomeEmails,
  stripeEventsOf,
} from "../helpers/request-outcomes";
import type {
  MoneyCall,
  MoneyMethod,
  Outcome,
  ScriptedPayments,
} from "../helpers/scripted-payments";
import {
  expectInvariant,
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";
import { expectPaidOnce } from "../helpers/transfer-fixtures";

// The D25 money matrix (P19; 07 D24–D26, D30; 03 T4–T10, T13; 02 §8.1, §8.2; 01 J8.8, J8.9, J8.14): Approve's capture,
// a decline's cancel and an expiry's cancel, each ok, transient, permanent or ambiguous (Stripe acted, the answer was
// lost), with Stripe's event delivered after the call or during it. One invariant holds throughout: a request is stored
// approved only once its PaymentIntent is captured, and declined, expired or capture_failed ("not charged") only once
// it is canceled. The payments driver is the scripted double: its PaymentIntents move only by its own capture and
// cancel, a scripted read or an explicit move, and it checks the invariant before every move and at every call.
// P19b: an approved ending also pays the creator, once, after the response (07 D74–D76): one creator_transfer of the
// license price under the double's ledger id and one transfer_succeeded audit. No other ending moves money to anyone.

vi.mock("@/server/payments/registry", async (importOriginal) =>
  (await import("../helpers/scripted-suite")).scriptedRegistry(
    await importOriginal<typeof import("@/server/payments/registry")>(),
  ),
);

// after() runs at once: the outcome emails go out, and each test waits for them.
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

type Action = "capture" | "decline" | "expire";
type Order = "after" | "during";

/** The Stripe call each act makes. */
const METHOD: Record<Action, MoneyMethod> = {
  capture: "capture",
  decline: "cancel",
  expire: "cancel",
};

/** The acts: Approve and Decline by the creator, the expiry by the system after a page load (02 §8.2, §8.4). */
function act(action: Action, id: string, actor: Actor): Promise<unknown> {
  switch (action) {
    case "capture":
      return approveLicenseRequest(id, actor);
    case "decline":
      return declineLicenseRequest(id, actor);
    case "expire":
      return expireLicenseRequest(id, LAZY);
  }
}

/**
 * A creator who can approve and a waiting request on their video, its PaymentIntent seeded as `pi` (never derived from
 * the row), past its deadline for an expiry.
 */
async function subject(action: Action, pi: PiStatus = "requires_capture") {
  const { creator, actor } = await approvingCreator();
  const { row, token } = await waitingRequest(
    await approvableVideo(creator.id),
  );
  const paymentIntentId = `pi_fake_${row.id}`;
  scripted.seedPi(paymentIntentId, pi);
  if (action === "expire") await overdue(row.id);
  return {
    id: row.id,
    pi: paymentIntentId,
    actor,
    token,
    buyerEmail: row.buyerEmail,
  };
}

const APPROVED = {
  ok: true,
  licenseCode: expect.stringMatching(LICENSE_CODE_PATTERN),
};
const RETRY = { ok: false, reason: "retry", status: "awaiting_approval" };
/** A claim still held after the call: Processing… until a reconcile (07 D25). */
const HELD = {
  ok: false,
  reason: "not_actionable",
  status: "awaiting_approval",
};
/** What Stripe answers a capture or cancel the PaymentIntent's state forbids. */
const REFUSED = {
  ok: false,
  kind: "permanent",
  code: "payment_intent_unexpected_state",
};

/** expireLicenseRequest after its claim: changed only when its own finish wrote the ending, else the request as it is. */
const expiry = (changed: boolean, to: LicenseRequestStatus) =>
  expect.objectContaining({
    changed,
    from: changed ? "awaiting_approval" : to,
    to,
  });

/**
 * How a row ends: the stored request, Stripe's calls, the emails, the answer, the audits and Stripe's events. The
 * creator's pay follows from `status` (expectPayout): paid once when approved, nothing otherwise.
 */
type Ending = {
  status: LicenseRequestStatus;
  statusReason: string | null;
  stripeAttempt: number;
  licenses: number;
  /** The capture keys, and the cancels as [key, Stripe's reason]: template literals, as P19b greps them. */
  captures: (id: string) => string[];
  cancels: (id: string) => Array<[string, string]>;
  /** The request's email_log without the two its authorization queued: each sent once. */
  emails: string[];
  result: unknown;
  /** Who wrote the ending (null: nobody, still waiting): the act's own actor, the webhook, or the lazy system. */
  by: "creator" | "lazy" | "stripe" | null;
  /** The event of the ignored_event a canceled event on the ended row writes (03 T13). */
  ignored: LicenseRequestEvent | null;
  /** The PaymentIntent events delivered, in order: each processed. */
  events: PiEventType[];
  /** getAuthorization calls: Stripe read after a call that wasn't ok, and by the webhook. */
  reads: number;
};

/** T5 from Approve's capture: one license, license-approved, and Stripe's succeeded. */
const CAPTURED: Omit<Ending, "by" | "reads"> = {
  status: "approved",
  statusReason: null,
  stripeAttempt: 1,
  licenses: 1,
  captures: (id) => [`pi-capture:${id}:1`],
  cancels: () => [],
  emails: ["license-approved"],
  result: APPROVED,
  ignored: null,
  events: ["payment_intent.succeeded"],
};

/** A capture that failed with the hold still held: the claim released, retry (07 D25, D30). */
const CAPTURE_RELEASED: Ending = {
  status: "awaiting_approval",
  statusReason: null,
  stripeAttempt: 1,
  licenses: 0,
  captures: (id) => [`pi-capture:${id}:1`],
  cancels: () => [],
  emails: [],
  result: RETRY,
  by: null,
  ignored: null,
  events: [],
  reads: 1,
};

/** T7: Stripe refused the capture for good, so the hold is canceled under the capture claim taken again. */
const CAPTURE_FAILED: Omit<Ending, "ignored"> = {
  status: "capture_failed",
  statusReason: "capture_error:amount_too_large",
  stripeAttempt: 2,
  licenses: 0,
  captures: (id) => [`pi-capture:${id}:1`],
  cancels: (id) => [[`pi-cancel:${id}:capture_failed:2`, "abandoned"]],
  emails: [],
  result: { ok: false, reason: "capture_failed", status: "capture_failed" },
  by: "creator",
  events: ["payment_intent.canceled"],
  reads: 1,
};

/** T8: the decline's cancel released the hold. */
const DECLINED: Omit<Ending, "by" | "ignored" | "reads"> = {
  status: "declined",
  statusReason: "creator",
  stripeAttempt: 1,
  licenses: 0,
  captures: () => [],
  cancels: (id) => [[`pi-cancel:${id}:decline:1`, "requested_by_customer"]],
  emails: ["request-declined"],
  result: { ok: true },
  events: ["payment_intent.canceled"],
};

/** A decline's cancel that failed with the hold still held: released, retry. */
const DECLINE_RELEASED: Ending = {
  status: "awaiting_approval",
  statusReason: null,
  stripeAttempt: 1,
  licenses: 0,
  captures: () => [],
  cancels: (id) => [[`pi-cancel:${id}:decline:1`, "requested_by_customer"]],
  emails: [],
  result: RETRY,
  by: null,
  ignored: null,
  events: [],
  reads: 1,
};

/** T9: the expiry's cancel released the hold; no email in CORE (07 D34). */
const EXPIRED: Omit<Ending, "result" | "by" | "ignored" | "reads"> = {
  status: "expired",
  statusReason: "deadline",
  stripeAttempt: 1,
  licenses: 0,
  captures: () => [],
  cancels: (id) => [[`pi-cancel:${id}:expire:1`, "abandoned"]],
  emails: [],
  events: ["payment_intent.canceled"],
};

/** An expiry's cancel that failed with the hold still held: released, so the request is due again. */
const EXPIRE_RELEASED: Ending = {
  status: "awaiting_approval",
  statusReason: null,
  stripeAttempt: 1,
  licenses: 0,
  captures: () => [],
  cancels: (id) => [[`pi-cancel:${id}:expire:1`, "abandoned"]],
  emails: [],
  result: expiry(false, "awaiting_approval"),
  by: null,
  ignored: null,
  events: [],
  reads: 1,
};

const AMOUNT_TOO_LARGE: Outcome = {
  kind: "permanent",
  code: "amount_too_large",
};
const RESOURCE_MISSING: Outcome = {
  kind: "permanent",
  code: "resource_missing",
};

type Row = Ending & { action: Action; outcome: Outcome; order: Order };

/**
 * THE 24 ROWS. Transient and permanent move nothing, so Stripe sends nothing and both orders are one scenario; a
 * permanent capture's event comes from T7's cancel. During the call, the webhook finishes what the act claimed and the
 * act's own fenced finish writes nothing.
 */
const ROWS: Row[] = [
  {
    action: "capture",
    outcome: "ok",
    order: "after",
    ...CAPTURED,
    by: "creator",
    reads: 1,
  },
  // The webhook's T5 runs inside the call; Approve's own finish loses the fence and answers from the stored license.
  {
    action: "capture",
    outcome: "ok",
    order: "during",
    ...CAPTURED,
    by: "stripe",
    reads: 2,
  },
  {
    action: "capture",
    outcome: "transient",
    order: "after",
    ...CAPTURE_RELEASED,
  },
  {
    action: "capture",
    outcome: "transient",
    order: "during",
    ...CAPTURE_RELEASED,
  },
  {
    action: "capture",
    outcome: AMOUNT_TOO_LARGE,
    order: "after",
    ...CAPTURE_FAILED,
    ignored: "capture_failed",
  },
  // The canceled event during T7's cancel finds a fresh capture claim: its holder's to finish, and Stripe isn't asked.
  {
    action: "capture",
    outcome: AMOUNT_TOO_LARGE,
    order: "during",
    ...CAPTURE_FAILED,
    ignored: null,
  },
  {
    action: "capture",
    outcome: "ambiguous",
    order: "after",
    ...CAPTURED,
    by: "creator",
    reads: 2,
  },
  {
    action: "capture",
    outcome: "ambiguous",
    order: "during",
    ...CAPTURED,
    by: "stripe",
    reads: 2,
  },
  {
    action: "decline",
    outcome: "ok",
    order: "after",
    ...DECLINED,
    by: "creator",
    ignored: "declined",
    reads: 0,
  },
  {
    action: "decline",
    outcome: "ok",
    order: "during",
    ...DECLINED,
    by: "stripe",
    ignored: null,
    reads: 1,
  },
  {
    action: "decline",
    outcome: "transient",
    order: "after",
    ...DECLINE_RELEASED,
  },
  {
    action: "decline",
    outcome: "transient",
    order: "during",
    ...DECLINE_RELEASED,
  },
  {
    action: "decline",
    outcome: RESOURCE_MISSING,
    order: "after",
    ...DECLINE_RELEASED,
  },
  {
    action: "decline",
    outcome: RESOURCE_MISSING,
    order: "during",
    ...DECLINE_RELEASED,
  },
  // The reason comes from the stored video when the reconcile finishes the decline (07 D28): creator.
  {
    action: "decline",
    outcome: "ambiguous",
    order: "after",
    ...DECLINED,
    by: "creator",
    ignored: "declined",
    reads: 1,
  },
  {
    action: "decline",
    outcome: "ambiguous",
    order: "during",
    ...DECLINED,
    by: "stripe",
    ignored: null,
    reads: 2,
  },
  {
    action: "expire",
    outcome: "ok",
    order: "after",
    ...EXPIRED,
    result: expiry(true, "expired"),
    by: "lazy",
    ignored: "expired",
    reads: 0,
  },
  {
    action: "expire",
    outcome: "ok",
    order: "during",
    ...EXPIRED,
    result: expiry(false, "expired"),
    by: "stripe",
    ignored: null,
    reads: 1,
  },
  {
    action: "expire",
    outcome: "transient",
    order: "after",
    ...EXPIRE_RELEASED,
  },
  {
    action: "expire",
    outcome: "transient",
    order: "during",
    ...EXPIRE_RELEASED,
  },
  {
    action: "expire",
    outcome: RESOURCE_MISSING,
    order: "after",
    ...EXPIRE_RELEASED,
  },
  {
    action: "expire",
    outcome: RESOURCE_MISSING,
    order: "during",
    ...EXPIRE_RELEASED,
  },
  {
    action: "expire",
    outcome: "ambiguous",
    order: "after",
    ...EXPIRED,
    result: expiry(false, "expired"),
    by: "lazy",
    ignored: "expired",
    reads: 1,
  },
  {
    action: "expire",
    outcome: "ambiguous",
    order: "during",
    ...EXPIRED,
    result: expiry(false, "expired"),
    by: "stripe",
    ignored: null,
    reads: 2,
  },
];

const labelOf = (outcome: Outcome) =>
  typeof outcome === "string"
    ? outcome
    : [outcome.kind, outcome.code].filter(Boolean).join(" ");

function rowOf(action: Action, outcome: Outcome, order: Order): Row {
  const row = ROWS.find(
    (r) => r.action === action && r.outcome === outcome && r.order === order,
  );
  if (!row) throw new Error(`no row ${action} ${labelOf(outcome)} ${order}`);
  return row;
}

type Delivery = { type: PiEventType; outcome: WebhookOutcome };

/** What a row's act left to check: its answer, the events delivered, and the claims read during calls that moved nothing. */
type Run = {
  id: string;
  pi: string;
  result: unknown;
  delivered: Delivery[];
  claimsDuring: Array<{ call: MoneyCall; row: LicenseRequest }>;
};

async function deliver(
  type: PiEventType,
  requestId: string,
): Promise<Delivery> {
  return { type, outcome: await deliverPiEvent(type, requestId) };
}

/**
 * Runs `row`: its outcome queued (T7's cancel, after a permanent capture, does what Stripe does), then the act. Stripe's
 * events come after it, one per capture or cancel that moved the PaymentIntent; or during the call, from a hook that
 * delivers the event when the PaymentIntent moved and reads the claim the call runs under when it didn't. Then the
 * after() work.
 */
async function runRow(row: Row) {
  const subj = await subject(row.action);
  scripted.next(METHOD[row.action], row.outcome);
  if (
    row.action === "capture" &&
    typeof row.outcome === "object" &&
    row.outcome.kind === "permanent"
  ) {
    scripted.next("cancel", "stripe");
  }
  const delivered: Delivery[] = [];
  const claimsDuring: Run["claimsDuring"] = [];
  if (row.order === "during") {
    const duringCall = async (call: MoneyCall) => {
      if (call.piAfter === call.piBefore) {
        claimsDuring.push({ call, row: await requestRow(subj.id) });
      } else {
        delivered.push(await deliver(eventFor(call.piAfter), subj.id));
      }
    };
    scripted.onCall("capture", duringCall);
    scripted.onCall("cancel", duringCall);
  }
  const result = await act(row.action, subj.id, subj.actor);
  if (row.order === "after") {
    for (const { paymentIntentId, to, by } of [...scripted.piHistory]) {
      if (
        paymentIntentId === subj.pi &&
        (by === "capture" || by === "cancel")
      ) {
        delivered.push(await deliver(eventFor(to), subj.id));
      }
    }
  }
  await flushAfter();
  return { ...subj, result, delivered, claimsDuring };
}

/**
 * The request's audits beyond its transitions, late events and the creator's pay (expectPayout counts that one): none
 * here (no money moved late, no failed issue, no failed transfer).
 */
async function otherAudits(requestId: string) {
  const rows = await db
    .select({ action: auditEvent.action })
    .from(auditEvent)
    .where(eq(auditEvent.entityId, requestId));
  return rows.filter(
    ({ action }) =>
      action !== "license_request.transition" &&
      action !== "license_request.ignored_event" &&
      action !== "license_request.transfer_succeeded",
  );
}

/**
 * The creator's pay for an ending (P19b; 07 D74–D76): approved, paid once (expectPaidOnce) the license price on the
 * first attempt, under the fake's id in the double's ledger (nothing scripted here), whichever T5 scheduled it
 * (Approve's, the webhook's, the lazy system's); any other ending, no money movement, no transfer call and no
 * transfer_succeeded audit.
 */
async function expectPayout(
  stored: LicenseRequest,
  approved: boolean,
): Promise<void> {
  const { id, licensePriceCents } = stored;
  if (approved) {
    await expectPaidOnce(id, { amountCents: licensePriceCents, scripted });
    return;
  }
  expect(await movementsOf(id)).toEqual([]);
  expect(scripted.keys("createTransfer")).toEqual([]);
  expect(await auditsOf(id, "license_request.transfer_succeeded")).toEqual([]);
}

const EVENT_OF: Partial<Record<LicenseRequestStatus, LicenseRequestEvent>> = {
  approved: "captured",
  declined: "declined",
  expired: "expired",
  capture_failed: "capture_failed",
};

/** The ending's transition audit (07 D47): the lazy system's keeps its source in data. */
function endingAudit(
  status: LicenseRequestStatus,
  by: NonNullable<Ending["by"]>,
) {
  const data = {
    from: "awaiting_approval",
    to: status,
    event: EVENT_OF[status],
  };
  return by === "lazy"
    ? { data: { ...data, source: "lazy" }, actorType: "system" }
    : { data, actorType: by };
}

/** The PaymentIntent each stored status stands on (07 D25); a waiting request's hold still waits. */
const PI_OF: Partial<Record<LicenseRequestStatus, PiStatus>> = {
  awaiting_approval: "requires_capture",
  approved: "succeeded",
  declined: "canceled",
  expired: "canceled",
  capture_failed: "canceled",
};

/**
 * The claim a key was made under (07 §2.4): `pi-capture:<id>:<attempt>`, `pi-cancel:<id>:<reason>:<attempt>`. T7's
 * capture_failed cancel runs under the capture claim taken again (03 T7).
 */
function claimOfKey(key: string) {
  const parts = key.split(":");
  const action = parts.length === 4 ? parts[2] : "capture";
  return {
    paymentAction: action === "capture_failed" ? "capture" : action,
    stripeAttempt: Number(parts.at(-1)),
  };
}

/** Everything `want` says of the run's request, its Stripe calls, emails, audits, events and PaymentIntent. */
async function expectEnding(run: Run, want: Ending): Promise<void> {
  const { id } = run;
  const stored = await requestRow(id);
  expect(stored).toMatchObject({
    status: want.status,
    statusReason: want.statusReason,
    stripeAttempt: want.stripeAttempt,
  });
  if (want.status === "awaiting_approval") {
    // Released: the next tap claims again, under a key of its own (07 D30).
    expect(stored).toMatchObject({
      paymentAction: null,
      paymentActionAt: null,
    });
  }
  expect(run.result).toEqual(want.result);
  expect(await licensesOf(id)).toHaveLength(want.licenses);

  expect(scripted.keys("capture")).toEqual(want.captures(id));
  expect(scripted.cancels()).toEqual(want.cancels(id));
  // Every call ran under its key's claim, committed before Stripe was called (07 D24).
  for (const call of [
    ...scripted.callsOf("capture"),
    ...scripted.callsOf("cancel"),
  ]) {
    expect(call.committed, call.key).toMatchObject({
      status: "awaiting_approval",
      paymentActionAt: expect.any(Date),
      ...claimOfKey(call.key),
    });
  }
  // While Stripe answered a call that moved nothing, nobody else had resolved the request.
  for (const { call, row } of run.claimsDuring) {
    expect(row, call.key).toMatchObject({
      status: "awaiting_approval",
      paymentAction: call.committed?.paymentAction,
      paymentActionAt: call.committed?.paymentActionAt,
      stripeAttempt: call.committed?.stripeAttempt,
    });
  }
  expect(scripted.callsOf("getAuthorization")).toHaveLength(want.reads);

  const emails = await outcomeEmails(id);
  expect(emails).toEqual(
    want.emails.map((template) => ({ template, status: "sent", attempts: 1 })),
  );
  // CORE sends no expiry or payment-failed email (07 D34).
  expect(
    emails.filter(({ template }) => /expired|payment-failed/.test(template)),
  ).toEqual([]);

  expect(run.delivered).toEqual(
    want.events.map((type) => ({ type, outcome: "processed" })),
  );
  expect(await stripeEventsOf(id)).toEqual(
    want.events.map((type) => ({
      type,
      processedAt: expect.any(Date),
      lastError: null,
    })),
  );

  expect(await endingsOf(id)).toEqual(
    want.by ? [endingAudit(want.status, want.by)] : [],
  );
  expect(await auditsOf(id, "license_request.ignored_event")).toEqual(
    want.ignored
      ? [
          {
            data: {
              from: want.status,
              event: want.ignored,
              stripeEvent: "payment_intent.canceled",
            },
            actorType: "stripe",
          },
        ]
      : [],
  );
  expect(await otherAudits(id)).toEqual([]);
  await expectPayout(stored, want.status === "approved");

  expect(scripted.piStatus(run.pi)).toBe(PI_OF[want.status]);
  await expectInvariant(id);
}

describe("the D25 matrix: capture, decline and expire × ok, transient, permanent, ambiguous × Stripe's event after or during the call (07 D25)", () => {
  it.each(ROWS.map((row) => ({ ...row, label: labelOf(row.outcome) })))(
    "$action · $label · webhook $order",
    async (row) => {
      const run = await runRow(row);
      await expectEnding(run, row);
      if (row.order === "during") {
        // The hook ran on every Stripe call: an event where the PaymentIntent moved, the claim read where it didn't.
        expect(run.delivered.length + run.claimsDuring.length).toBe(
          row.captures(run.id).length + row.cancels(run.id).length,
        );
      }
    },
  );
});

/**
 * A capture that lands late (07 D25): Approve's capture fails (transient: retry, released, C1), then `action`'s cancel
 * arrives after Stripe captured the hold after all, so Stripe refuses it, and the request ends approved from Stripe's
 * word. Stripe's succeeded comes during the cancel or after it, by `order`.
 */
async function lateCapture(action: "decline" | "expire", order: Order) {
  const subj = await subject("capture");
  scripted.next("capture", "transient");
  expect(await approveLicenseRequest(subj.id, subj.actor)).toEqual(RETRY);
  if (action === "expire") await overdue(subj.id);
  scripted.onCall("cancel", () => scripted.movePi(subj.pi, "succeeded"), {
    phase: "before",
    times: 1,
  });
  const delivered: Delivery[] = [];
  if (order === "during") {
    scripted.onCall(
      "cancel",
      async () => {
        delivered.push(await deliver("payment_intent.succeeded", subj.id));
      },
      { times: 1 },
    );
  }
  const result = await act(action, subj.id, subj.actor);
  if (order === "after") {
    delivered.push(await deliver("payment_intent.succeeded", subj.id));
  }
  await flushAfter();
  return { ...subj, result, delivered, claimsDuring: [] };
}

/** A late capture's license starts when Stripe's word came, not at the failed capture's claim; the cancel was refused. */
async function expectLateCapture(run: Run): Promise<void> {
  const [capture] = scripted.callsOf("capture");
  const [cancel] = scripted.callsOf("cancel");
  expect(cancel?.answered).toEqual(REFUSED);
  const stored = await requestRow(run.id);
  const [issued] = await licensesOf(run.id);
  expect(issued?.startsAt).toEqual(stored.approvedAt);
  expect(stored.approvedAt?.getTime()).toBeGreaterThan(
    capture?.committed?.paymentActionAt?.getTime() ?? Number.POSITIVE_INFINITY,
  );
}

describe("named cases (07 D25; 01 J8.14)", () => {
  const ORDERS = [{ order: "after" }, { order: "during" }] as const;

  it.each(ORDERS)(
    "capture times out but succeeded (J8.14), webhook $order",
    async ({ order }) => {
      const row = rowOf("capture", "ambiguous", order);
      const run = await runRow(row);
      // Approved with its license: never capture_failed, never retry.
      await expectEnding(run, row);
      const [capture] = scripted.callsOf("capture");
      const claimedAt = capture?.committed?.paymentActionAt;
      expect(claimedAt).toBeInstanceOf(Date);
      const stored = await requestRow(run.id);
      expect(stored.approvedAt).toEqual(claimedAt);
      expect(stored.paymentActionAt).toEqual(claimedAt);
      const [issued] = await licensesOf(run.id);
      expect(issued?.startsAt).toEqual(claimedAt);
      expect(await getBuyerRequest(run.id, run.token)).toMatchObject({
        status: "approved",
        displayStatus: "approved",
        licenseCode: issued?.code,
      });
    },
  );

  it.each(ORDERS)(
    "capture succeeds after an expire claim, webhook $order",
    async ({ order }) => {
      const run = await lateCapture("expire", order);
      // Never expired: the expiry's cancel came too late, and Stripe's succeeded decides (07 D25).
      await expectEnding(run, {
        status: "approved",
        statusReason: null,
        stripeAttempt: 2,
        licenses: 1,
        captures: (id) => [`pi-capture:${id}:1`],
        cancels: (id) => [[`pi-cancel:${id}:expire:2`, "abandoned"]],
        emails: ["license-approved"],
        result: expiry(false, "approved"),
        by: order === "during" ? "stripe" : "lazy",
        ignored: null,
        events: ["payment_intent.succeeded"],
        reads: 3,
      });
      await expectLateCapture(run);
    },
  );

  it.each(ORDERS)(
    "decline racing a late succeeded, webhook $order",
    async ({ order }) => {
      const run = await lateCapture("decline", order);
      // Approved, and no request-declined: the decline reports the approval it lost to.
      await expectEnding(run, {
        status: "approved",
        statusReason: null,
        stripeAttempt: 2,
        licenses: 1,
        captures: (id) => [`pi-capture:${id}:1`],
        cancels: (id) => [
          [`pi-cancel:${id}:decline:2`, "requested_by_customer"],
        ],
        emails: ["license-approved"],
        result: { ok: false, reason: "not_actionable", status: "approved" },
        by: order === "during" ? "stripe" : "creator",
        ignored: null,
        events: ["payment_intent.succeeded"],
        reads: 3,
      });
      await expectLateCapture(run);
    },
  );
});

/** E1: the act's first call fails with the hold still held; the next one claims attempt 2. */
const RETRIED: Array<{ action: Action; first: unknown; ending: Ending }> = [
  {
    action: "capture",
    first: RETRY,
    ending: {
      ...CAPTURED,
      stripeAttempt: 2,
      captures: (id) => [`pi-capture:${id}:1`, `pi-capture:${id}:2`],
      by: "creator",
      events: [],
      reads: 1,
    },
  },
  {
    action: "decline",
    first: RETRY,
    ending: {
      ...DECLINED,
      stripeAttempt: 2,
      cancels: (id) => [
        [`pi-cancel:${id}:decline:1`, "requested_by_customer"],
        [`pi-cancel:${id}:decline:2`, "requested_by_customer"],
      ],
      by: "creator",
      ignored: null,
      events: [],
      reads: 1,
    },
  },
  {
    action: "expire",
    first: expiry(false, "awaiting_approval"),
    ending: {
      ...EXPIRED,
      stripeAttempt: 2,
      cancels: (id) => [
        [`pi-cancel:${id}:expire:1`, "abandoned"],
        [`pi-cancel:${id}:expire:2`, "abandoned"],
      ],
      result: expiry(true, "expired"),
      by: "lazy",
      ignored: null,
      events: [],
      reads: 1,
    },
  },
];

/** E3: the act's answer is lost and Stripe can't be read after it; the stuck-claim reconcile (lazy) ends it. */
const UNREADABLE: Array<{
  action: "capture" | "decline";
  logged: string;
  ending: Ending;
}> = [
  {
    action: "capture",
    logged: "license_request.reconcile_failed",
    ending: {
      ...CAPTURED,
      result: HELD,
      by: "lazy",
      events: [],
      reads: 2,
    },
  },
  {
    action: "decline",
    logged: "license_request.cancel_claim_failed",
    ending: {
      ...DECLINED,
      result: HELD,
      by: "lazy",
      ignored: null,
      events: [],
      reads: 2,
    },
  },
];

/** E6: T7's own cancel isn't ok; the stuck-claim reconcile (lazy) reads Stripe. */
const T7_CANCEL_FAILED: Array<{ cancel: Outcome; ending: Ending }> = [
  {
    cancel: "transient",
    ending: {
      status: "awaiting_approval",
      statusReason: null,
      stripeAttempt: 2,
      licenses: 0,
      captures: (id) => [`pi-capture:${id}:1`],
      cancels: (id) => [[`pi-cancel:${id}:capture_failed:2`, "abandoned"]],
      emails: [],
      result: HELD,
      by: null,
      ignored: null,
      events: [],
      reads: 2,
    },
  },
  {
    cancel: "ambiguous",
    ending: {
      status: "capture_failed",
      statusReason: "pi_canceled_during_capture",
      stripeAttempt: 2,
      licenses: 0,
      captures: (id) => [`pi-capture:${id}:1`],
      cancels: (id) => [[`pi-cancel:${id}:capture_failed:2`, "abandoned"]],
      emails: [],
      result: HELD,
      by: "lazy",
      ignored: null,
      events: [],
      reads: 2,
    },
  },
];

describe("around the matrix (07 D24–D26, D30; 03 T7; 01 J8.9)", () => {
  it.each(RETRIED)(
    "E1: after a released claim, the next $action claims attempt 2 under a key of its own (07 D30)",
    async ({ action, first, ending }) => {
      const s = await subject(action);
      scripted.next(METHOD[action], "transient");
      expect(await act(action, s.id, s.actor)).toEqual(first);
      expect(await requestRow(s.id)).toMatchObject({
        status: "awaiting_approval",
        paymentAction: null,
        stripeAttempt: 1,
      });
      const result = await act(action, s.id, s.actor);
      await flushAfter();
      await expectEnding(
        { ...s, result, delivered: [], claimsDuring: [] },
        ending,
      );
    },
  );

  it("E2: T7's cancel runs under the capture claim taken again: committed at attempt 2, after the capture's (03 T7; 07 D24)", async () => {
    const s = await subject("capture");
    scripted.next("capture", { kind: "permanent", code: "card_declined" });
    scripted.next("cancel", "stripe");
    expect(await approveLicenseRequest(s.id, s.actor)).toEqual({
      ok: false,
      reason: "capture_failed",
      status: "capture_failed",
    });
    const [capture] = scripted.callsOf("capture");
    const [cancel] = scripted.callsOf("cancel");
    expect(capture?.committed).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
      stripeAttempt: 1,
    });
    expect(cancel?.committed).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
      stripeAttempt: 2,
    });
    expect(cancel?.committed?.paymentActionAt?.getTime()).toBeGreaterThan(
      capture?.committed?.paymentActionAt?.getTime() ??
        Number.POSITIVE_INFINITY,
    );
    expect(await requestRow(s.id)).toMatchObject({
      status: "capture_failed",
      statusReason: "capture_error:card_declined",
      stripeAttempt: 2,
      paymentActionAt: cancel?.committed?.paymentActionAt,
    });
    expect(scripted.piStatus(s.pi)).toBe("canceled");
    await expectInvariant(s.id);
  });

  it.each(UNREADABLE)(
    "E3: $action's answer lost and Stripe unreadable after it: the claim stays until the stuck-claim reconcile (07 D26)",
    async ({ action, logged, ending }) => {
      recordStderr(logged);
      const s = await subject(action);
      scripted.next(METHOD[action], "ambiguous");
      scripted.authorizations(new Error("stripe down"));
      const result = await act(action, s.id, s.actor);
      await flushAfter();
      // Processing…: still claimed, nothing issued, nothing told (07 D25).
      expect(await requestRow(s.id)).toMatchObject({
        status: "awaiting_approval",
        paymentAction: action,
        stripeAttempt: 1,
      });
      expect(await licensesOf(s.id)).toEqual([]);
      expect(await outcomeEmails(s.id)).toEqual([]);
      expect(
        await reconcileStuckClaims({ requestId: s.id, olderThanMinutes: 0 }),
      ).toBe(1);
      await flushAfter();
      await expectEnding(
        { ...s, result, delivered: [], claimsDuring: [] },
        ending,
      );
      const { written, events } = stopStderr();
      expect(events).toEqual([
        expect.objectContaining({ requestId: s.id, error: "Error" }),
      ]);
      expect(written).not.toContain(s.buyerEmail);
    },
  );

  it("E4: a hold Stripe already released: Approve ends capture_failed (pi_canceled_during_capture) and cancels nothing (01 J8.9)", async () => {
    const s = await subject("capture", "canceled");
    const result = await approveLicenseRequest(s.id, s.actor);
    await flushAfter();
    await expectEnding(
      { ...s, result, delivered: [], claimsDuring: [] },
      {
        status: "capture_failed",
        statusReason: "pi_canceled_during_capture",
        stripeAttempt: 1,
        licenses: 0,
        captures: (id) => [`pi-capture:${id}:1`],
        cancels: () => [],
        emails: [],
        result: {
          ok: false,
          reason: "capture_failed",
          status: "capture_failed",
        },
        by: "creator",
        ignored: null,
        events: [],
        reads: 1,
      },
    );
    expect(scripted.callsOf("capture")[0]?.answered).toEqual(REFUSED);
  });

  it("E5: a hold Stripe already captured: the capture is refused, and Stripe's word issues the license (01 J8.9)", async () => {
    const s = await subject("capture", "succeeded");
    const result = await approveLicenseRequest(s.id, s.actor);
    await flushAfter();
    await expectEnding(
      { ...s, result, delivered: [], claimsDuring: [] },
      { ...CAPTURED, by: "creator", events: [], reads: 1 },
    );
    expect(scripted.callsOf("capture")[0]?.answered).toEqual(REFUSED);
  });

  it.each(
    T7_CANCEL_FAILED.map((row) => ({ ...row, label: labelOf(row.cancel) })),
  )(
    "E6: T7's own cancel $label: the capture claim stays at attempt 2 until the stuck-claim reconcile (03 T7; 07 D26)",
    async ({ cancel, ending }) => {
      recordStderr("license_request.capture_cancel_failed");
      const s = await subject("capture");
      scripted.next("capture", { kind: "permanent", code: "card_declined" });
      scripted.next("cancel", cancel);
      const result = await approveLicenseRequest(s.id, s.actor);
      // Nothing says "not charged" before Stripe has released the hold: Processing… under the new claim.
      expect(await requestRow(s.id)).toMatchObject({
        status: "awaiting_approval",
        paymentAction: "capture",
        stripeAttempt: 2,
      });
      expect(
        await reconcileStuckClaims({ requestId: s.id, olderThanMinutes: 0 }),
      ).toBe(1);
      await flushAfter();
      await expectEnding(
        { ...s, result, delivered: [], claimsDuring: [] },
        ending,
      );
      // A thrown cancel reads as transient, like a refused one, named after what it threw.
      expect(stopStderr().events).toEqual([
        expect.objectContaining({
          requestId: s.id,
          kind: "transient",
          stripeCode: "StripeConnectionError",
        }),
      ]);
    },
  );

  it("E7: a permanent capture failure reported under a stale claim cancels nothing (03 T7: the caller's own claim only)", async () => {
    const s = await subject("capture");
    const claimed = await claimPaymentAction(s.id, "capture");
    if (!claimed) throw new Error("not claimed");
    const stale = {
      action: "capture" as const,
      claimedAt: new Date(claimed.paymentActionAt.getTime() - MINUTE_MS),
    };
    expect(
      await reconcileFromStripe(s.id, {
        claim: stale,
        captureOutcome: { ok: false, kind: "permanent", code: "card_declined" },
      }),
    ).toBe("unchanged");
    expect(scripted.callsOf("cancel")).toEqual([]);
    expect(scripted.callsOf("getAuthorization")).toHaveLength(1);
    expect(await requestRow(s.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
      paymentActionAt: claimed.paymentActionAt,
      stripeAttempt: 1,
    });
    expect(scripted.piStatus(s.pi)).toBe("requires_capture");
    await expectInvariant(s.id);
  });

  it("E8: the invariant itself: an ending stored while the hold still waits is a violation (07 D25)", async () => {
    const s = await subject("decline");
    await db.transaction((tx) =>
      applyTransition(
        tx,
        s.id,
        "declined",
        { declinedAt: new Date(), statusReason: "creator" },
        s.actor,
      ),
    );
    await scripted.checkInvariant(s.id);
    expect(scripted.violations).toEqual([
      `checkInvariant: the request is declined while ${s.pi} is requires_capture (07 D25)`,
    ]);
    scripted.violations.splice(0);
  });
});
