import { and, asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GET, maxDuration } from "../../src/app/api/cron/expire-requests/route";
import { db } from "../../src/db/client";
import { emailLog } from "../../src/db/schema";
import type { Video } from "../../src/db/schema/types";
import { env } from "../../src/server/env";
import {
  claimPaymentAction,
  type RequestAction,
} from "../../src/server/licensing/state-machine";
import type { PiStatus } from "../../src/server/payments/driver";
import { flushAfter } from "../helpers/after";
import {
  approvableVideo,
  approvingCreator,
  claimedMinutesAgo,
  overdue,
  waitingRequest,
} from "../helpers/approval-fixtures";
import { auditsOf } from "../helpers/connect-flow";
import { resetDb } from "../helpers/db";
import { requestRow } from "../helpers/factories";
import { AFTER_FAILED, captureLogEvents } from "../helpers/logs";
import { endingsOf, onlyLicense } from "../helpers/request-outcomes";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  expectInvariant,
  expectScriptPlayed,
  installScriptedPayments,
} from "../helpers/scripted-suite";

// GET /api/cron/expire-requests against the test database (P19; 02 §5.11, §8.4 layer 2, §9.7; 03 §7.10; 07 D26, D34,
// D47, D57): the bearer first, then one run's passes: the claims stuck for over 10 minutes reconciled from Stripe, the
// waiting requests past their deadline expired, the failed emails retried, all as the cron, and the totals as JSON. A request whose cancel keeps failing is tried once per run, so a run never spins until its budget. The sweeps
// are global: each run starts from an empty database. The bearer is built from .env.test's CRON_SECRET and never
// printed. The payments driver is the scripted double, each PaymentIntent seeded as Stripe has it.

vi.mock("@/server/payments/registry", async (importOriginal) =>
  (await import("../helpers/scripted-suite")).scriptedRegistry(
    await importOriginal<typeof import("@/server/payments/registry")>(),
  ),
);

// after() runs at once: a reconciled approval's email goes out, and each test waits for it.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("../helpers/after")).runAfter,
}));

/** Far under a run's 45 s budget: the run stopped on its own, it didn't spend the budget. */
const AT_ONCE_MS = 5_000;

const CRON_URL = `${env.APP_URL}/api/cron/expire-requests`;

let scripted: ScriptedPayments;
let stderr: ReturnType<typeof captureLogEvents> | null = null;
/** What the code wrote to stdout (info log lines, the console email driver), passed through. */
let stdout: () => string = () => "";

beforeEach(() => {
  scripted = installScriptedPayments();
  stderr = captureLogEvents(AFTER_FAILED);
  const spy = vi.spyOn(process.stdout, "write");
  stdout = () => spy.mock.calls.map(([chunk]) => String(chunk)).join("");
});
afterEach(async () => {
  let printed = "";
  try {
    await flushAfter();
    printed = (stderr?.().written ?? "") + stdout();
  } finally {
    stderr = null;
    stdout = () => "";
    vi.restoreAllMocks();
  }
  // The bearer reaches no log line and no output (02 §5.11): a boolean, so a failure doesn't print it either.
  expect(printed.includes(env.CRON_SECRET)).toBe(false);
  // No after() task failed.
  expect(printed).not.toContain(`"${AFTER_FAILED}"`);
  expectScriptPlayed();
});

/** Vercel Cron's call (02 §9.7): `Authorization: Bearer <CRON_SECRET>`. */
const cron = () =>
  GET(
    new Request(CRON_URL, {
      headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    }),
  );

/** A run's counts by step: every value a count. */
const COUNTS = z.record(z.string(), z.number().int().nonnegative());

/** A run's answer: 200, never cached, and its counts. */
async function countsOf(response: Response): Promise<Record<string, number>> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return COUNTS.parse(await response.json());
}

/** A run that found nothing to do: every count 0, the counts later prompts add included (one toEqual names them all). */
function expectNothingDone(counts: Record<string, number>): void {
  expect(counts).toMatchObject({ expired: 0, reconciled: 0, emailsSent: 0 });
  expect(Object.values(counts).filter((n) => n !== 0)).toEqual([]);
}

/** A creator who can approve and their published video. */
async function creatorsVideo(): Promise<Video> {
  const { creator } = await approvingCreator();
  return approvableVideo(creator.id);
}

/** A waiting request on `live`, its PaymentIntent tracked as Stripe has it (held by default; never derived from the row). */
async function held(live: Video, pi: PiStatus = "requires_capture") {
  const { row } = await waitingRequest(live);
  const paymentIntentId = `pi_fake_${row.id}`;
  scripted.seedPi(paymentIntentId, pi);
  return { id: row.id, pi: paymentIntentId };
}

/** Request `id` claimed for `action` by a caller that is still at work, or that died: claimed `minutes` ago. */
async function claimed(
  id: string,
  action: RequestAction,
  minutes: number,
): Promise<Date> {
  if (!(await claimPaymentAction(id, action))) {
    throw new Error(`no ${action} claim on ${id}`);
  }
  return claimedMinutesAgo(id, minutes);
}

/** Request `id`'s `template` email as sends that failed `attempts` times left it (07 D34: 3 at most). */
async function failedEmail(
  id: string,
  template: "request-new" | "request-received",
  attempts: number,
): Promise<void> {
  const moved = await db
    .update(emailLog)
    .set({ status: "failed", attempts, error: "send:Error" })
    .where(eq(emailLog.idempotencyKey, `${template}/${id}`))
    .returning({ id: emailLog.id });
  if (moved.length !== 1) throw new Error(`no ${template} email for ${id}`);
}

/** The request's emails: template, status and attempts. */
const emailsOf = (requestId: string) =>
  db
    .select({
      template: emailLog.template,
      status: emailLog.status,
      attempts: emailLog.attempts,
    })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.entityType, "license_request"),
        eq(emailLog.entityId, requestId),
      ),
    )
    .orderBy(asc(emailLog.template));

describe("GET /api/cron/expire-requests (02 §8.4 layer 2, §9.7; 07 D57)", () => {
  it("gives a run 60 s (07 D26)", () => {
    expect(maxDuration).toBe(60);
  });

  it.each([
    { label: "no Authorization header", authorization: null },
    { label: "a wrong bearer", authorization: "Bearer wrong" },
    { label: "another scheme", authorization: "Basic x" },
  ])(
    "answers 401 to $label and runs nothing: the due request stays as it is, and Stripe is asked nothing (02 §5.11)",
    async ({ authorization }) => {
      const due = await held(await creatorsVideo());
      await overdue(due.id);
      const before = await requestRow(due.id);
      const headers = new Headers();
      if (authorization !== null) headers.set("authorization", authorization);
      const response = await GET(new Request(CRON_URL, { headers }));
      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        error: { code: "unauthorized" },
      });
      expect(await requestRow(due.id)).toEqual(before);
      expect(scripted.log).toEqual([]);
    },
  );

  it("expires what is due, reconciles a claim stuck past 10 minutes and retries a failed email, as the cron; a second run finds nothing (07 D26, D34, D47)", async () => {
    await resetDb();
    const live = await creatorsVideo();
    // Past its deadline, unclaimed.
    const due = await held(live);
    await overdue(due.id);
    // Captured at Stripe by an Approve that died 11 minutes ago, before its finish.
    const stuck = await held(live, "succeeded");
    const stuckAt = await claimed(stuck.id, "capture", 11);
    // An Approve still at work: claimed a minute ago.
    const inFlight = await held(live);
    const inFlightAt = await claimed(inFlight.id, "capture", 1);
    // Waiting, with one email to retry and one out of attempts.
    const mailed = await held(live);
    await failedEmail(mailed.id, "request-received", 1);
    await failedEmail(mailed.id, "request-new", 3);

    const body = await countsOf(await cron());
    expect(body).toEqual({ expired: 1, reconciled: 1, emailsSent: 1 });
    await flushAfter();

    // The due request: the expire claim, the cancel under its key, then expired with deadline, by the cron.
    expect(await requestRow(due.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
      expiredAt: expect.any(Date),
      paymentAction: "expire",
      stripeAttempt: 1,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${due.id}:expire:1`, "abandoned"],
    ]);
    expect(scripted.callsOf("cancel")[0]?.committed).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "expire",
      stripeAttempt: 1,
    });
    expect(await endingsOf(due.id)).toEqual([
      {
        data: { from: "awaiting_approval", to: "expired", event: "expired" },
        actorType: "cron",
      },
    ]);
    // An expiry emails nobody in CORE (07 D34), and its authorization's emails aren't due for 2 minutes: left queued.
    expect(await emailsOf(due.id)).toEqual([
      { template: "request-new", status: "queued", attempts: 0 },
      { template: "request-received", status: "queued", attempts: 0 },
    ]);

    // The stuck claim: Stripe's succeeded issues the license from the claim's time (T5), by the cron, with its email.
    expect(await requestRow(stuck.id)).toMatchObject({
      status: "approved",
      approvedAt: stuckAt,
      paymentAction: "capture",
      stripeAttempt: 1,
    });
    const issued = await onlyLicense(stuck.id);
    expect(issued.startsAt).toEqual(stuckAt);
    expect(await endingsOf(stuck.id)).toEqual([
      {
        data: { from: "awaiting_approval", to: "approved", event: "captured" },
        actorType: "cron",
      },
    ]);
    expect(await auditsOf(issued.id, "license.issued")).toEqual([
      { data: { code: issued.code }, actorType: "cron" },
    ]);
    expect(await emailsOf(stuck.id)).toContainEqual({
      template: "license-approved",
      status: "sent",
      attempts: 1,
    });

    // The claim a minute old is its holder's: untouched, and Stripe isn't asked about it.
    expect(await requestRow(inFlight.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
      paymentActionAt: inFlightAt,
      stripeAttempt: 1,
    });
    expect(
      scripted.callsOf("getAuthorization").map((call) => call.args[0]),
    ).toEqual([stuck.pi]);
    expect(scripted.callsOf("capture")).toEqual([]);

    // The failed request-received is sent on its second attempt; request-new has none left.
    expect(await emailsOf(mailed.id)).toEqual([
      { template: "request-new", status: "failed", attempts: 3 },
      { template: "request-received", status: "sent", attempts: 2 },
    ]);
    for (const { id } of [due, stuck, inFlight, mailed]) {
      await expectInvariant(id);
    }

    // Run again: nothing is due, and nothing is asked of Stripe or sent again.
    expectNothingDone(await countsOf(await cron()));
    await flushAfter();
    expect(scripted.callsOf("cancel")).toHaveLength(1);
    expect(scripted.callsOf("getAuthorization")).toHaveLength(1);
    expect(scripted.callsOf("capture")).toEqual([]);
    await onlyLicense(stuck.id);
    expect((await requestRow(inFlight.id)).paymentActionAt).toEqual(inFlightAt);
    expect(await emailsOf(mailed.id)).toEqual([
      { template: "request-new", status: "failed", attempts: 3 },
      { template: "request-received", status: "sent", attempts: 2 },
    ]);
  });

  it("tries a request whose cancel keeps failing once per run, and answers at once: the run doesn't spin (07 D25, D57)", async () => {
    await resetDb();
    const due = await held(await creatorsVideo());
    await overdue(due.id);
    scripted.script({
      cancel: { ok: false, kind: "transient", code: "StripeConnectionError" },
    });

    const started = performance.now();
    const response = await cron();
    expect(performance.now() - started).toBeLessThan(AT_ONCE_MS);
    expectNothingDone(await countsOf(response));
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${due.id}:expire:1`, "abandoned"],
    ]);
    // Stripe says the hold still waits: the claim is released (07 D25), so the request is due again, next run.
    expect(scripted.callsOf("getAuthorization")).toHaveLength(1);
    expect(await requestRow(due.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      paymentActionAt: null,
      stripeAttempt: 1,
    });

    // The next run tries it once more, under a key of its own (07 D30), and still counts nothing.
    expectNothingDone(await countsOf(await cron()));
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${due.id}:expire:1`, "abandoned"],
      [`pi-cancel:${due.id}:expire:2`, "abandoned"],
    ]);
    expect(scripted.callsOf("getAuthorization")).toHaveLength(2);
    expect(await requestRow(due.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 2,
    });
    expect(scripted.piStatus(due.pi)).toBe("requires_capture");
    await expectInvariant(due.id);
  });

  it("releases a claim stuck past 10 minutes on an overdue request, then expires it in the same run: the reconcile goes first (06 §9)", async () => {
    await resetDb();
    const due = await held(await creatorsVideo());
    await overdue(due.id);
    // An expiry by a run that died 11 minutes ago, before its cancel reached Stripe: the hold still waits.
    await claimed(due.id, "expire", 11);

    const counts = await countsOf(await cron());
    // The two, and every other count 0 (the counts later prompts add included).
    expect(counts).toMatchObject({ expired: 1, reconciled: 1, emailsSent: 0 });
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe(2);
    expect(
      scripted.callsOf("getAuthorization").map((call) => call.args[0]),
    ).toEqual([due.pi]);
    // Released on Stripe's word, then claimed again under a key of its own (07 D30).
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${due.id}:expire:2`, "abandoned"],
    ]);
    expect(await requestRow(due.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
      paymentAction: "expire",
      stripeAttempt: 2,
    });
    expect(await endingsOf(due.id)).toEqual([
      {
        data: { from: "awaiting_approval", to: "expired", event: "expired" },
        actorType: "cron",
      },
    ]);
    await expectInvariant(due.id);

    expectNothingDone(await countsOf(await cron()));
  });
});
