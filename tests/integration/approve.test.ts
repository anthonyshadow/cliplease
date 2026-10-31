import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
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
import {
  auditEvent,
  emailLog,
  licenseRequest,
  stripeEvent,
  video,
} from "../../src/db/schema";
import type { LicenseRequest } from "../../src/db/schema/types";
import type { TermKey } from "../../src/lib/domain/values";
import { formatMoney } from "../../src/lib/format";
import { computeEndsAt } from "../../src/lib/licensing/ends-at";
import {
  LICENSE_CODE_PATTERN,
  LicenseSnapshotV1Schema,
} from "../../src/lib/licensing/snapshot";
import { computeQuote } from "../../src/lib/pricing/compute-quote";
import { MINUTE_MS } from "../../src/lib/time";
import { defaultRateCardInput } from "../../src/lib/validation/pricing";
import { LAZY, WEBHOOK } from "../../src/server/auth/actor";
import { env } from "../../src/server/env";
import { approveLicenseRequest } from "../../src/server/licensing/approve";
import { issueLicense } from "../../src/server/licensing/issue";
import { listInbox } from "../../src/server/licensing/queries";
import {
  claimPaymentAction,
  reconcileFromStripe,
  reconcileStuckClaims,
  releaseClaim,
} from "../../src/server/licensing/state-machine";
import type { PaymentsDriver } from "../../src/server/payments/driver";
import { onWebhookEvent } from "../../src/server/payments/events";
import { saveRateCard } from "../../src/server/pricing/rate-card";
import { hashBuyerToken } from "../../src/server/tokens/buyer-token";
import { flushAfter } from "../helpers/after";
import {
  approvableVideo,
  approvingCreator,
  overdue,
  PAID_SOCIAL_YEAR_WORLDWIDE,
  waitingRequest,
} from "../helpers/approval-fixtures";
import { bareCreator } from "../helpers/auth";
import { auditsOf } from "../helpers/connect-flow";
import {
  insertLicense,
  insertLicenseRequest,
  publishVideo,
  requestRow,
} from "../helpers/factories";
import {
  AFTER_FAILED,
  captureLogEvents,
  dropStderr,
  endStderr,
  recordStderr,
} from "../helpers/logs";
import { BARE_DOLLAR } from "../helpers/money";
import { piEvent } from "../helpers/pi-events";
import { readLatestEmail } from "../helpers/read-latest-email";
import { readyLibraryVideo } from "../helpers/ready-videos";
import {
  endingsOf,
  licensesOf,
  movementsOf,
  onlyLicense,
} from "../helpers/request-outcomes";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  expectScriptPlayed,
  installScriptedPayments,
} from "../helpers/scripted-suite";
import { expectPaidOnce } from "../helpers/transfer-fixtures";

// Approve: capture and issue the license (P18; 02 §8.2; 03 T4–T6, T10; 07 D24–D26, D29, D33, D71, D74, D94, D101; 01
// J4.7, J8.2, J8.3, J8.8, J9.1, J9.3, J9.7; OQ-12, Q-123 a). P19 adds the expiry a tap past the deadline schedules and
// T7, a capture Stripe refuses for good (03 T7; 01 J8.9). The payments driver is the scripted double: the fake's
// answers unless a test scripts getAuthorization or queues an outcome; capture is spied on (never fault injection in
// the fake, 07 D35). P19b: T5 also leaves the creator's transfer, sent after the response (07 D75), so a test that
// compares audits across a later T5 path waits for that first, and Approve tapped twice still pays once.

vi.mock("@/server/payments/registry", async (importOriginal) =>
  (await import("../helpers/scripted-suite")).scriptedRegistry(
    await importOriginal<typeof import("@/server/payments/registry")>(),
  ),
);

// after() runs at once: license-approved goes out, and each test waits for it.
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

// computeQuote counted, never replaced: Approve must not price again (J4.7).
vi.mock("@/lib/pricing/compute-quote", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/pricing/compute-quote")>();
  return { ...real, computeQuote: vi.fn(real.computeQuote) };
});

let scripted: ScriptedPayments;
let captures: MockInstance<PaymentsDriver["capture"]>;
beforeEach(() => {
  scripted = installScriptedPayments();
  captures = vi.spyOn(scripted.driverFor("cad"), "capture");
  codes.next = [];
  recordStderr(AFTER_FAILED);
});
afterEach(async () => {
  try {
    await flushAfter();
    // No after() task failed: afterResponse logs a failure instead of rejecting.
    endStderr();
  } finally {
    dropStderr();
    vi.restoreAllMocks();
  }
});

/** A creator who can approve, their published video and one waiting request on it. */
async function waiting(overrides: Partial<LicenseRequest> = {}) {
  const { creator, actor } = await approvingCreator();
  const live = await approvableVideo(creator.id);
  const { row, token } = await waitingRequest(live, overrides);
  return { creator, actor, live, row, token };
}

/** A license with a known code on another request, so the next insert with it collides. */
async function takenCode(): Promise<string> {
  const { row } = await waiting();
  return (await insertLicense(row)).code;
}

const approvedEmails = (requestId: string) =>
  db
    .select()
    .from(emailLog)
    .where(
      and(
        eq(emailLog.entityId, requestId),
        eq(emailLog.template, "license-approved"),
      ),
    );

const auditsFor = (entityId: string) =>
  db
    .select({ action: auditEvent.action })
    .from(auditEvent)
    .where(eq(auditEvent.entityId, entityId));

/** The capture calls' keys, in order. */
const captureKeys = () => captures.mock.calls.map((call) => call[1]);

/** The request's email templates, in order. */
async function emailTemplatesOf(requestId: string): Promise<string[]> {
  const rows = await db
    .select({ template: emailLog.template })
    .from(emailLog)
    .where(eq(emailLog.entityId, requestId))
    .orderBy(emailLog.template);
  return rows.map((r) => r.template);
}

/** A claim taken now for `action`, as the claim's holder fences with it. */
async function claimed(requestId: string, action: "capture" | "decline") {
  const row = await claimPaymentAction(requestId, action);
  if (!row) throw new Error("not claimed");
  return { action: row.paymentAction, claimedAt: row.paymentActionAt };
}

describe("Approve (02 §8.2; 01 J8.2, J9.1, J9.3)", () => {
  it("captures under the claim's key on the request's account, then issues one license and emails the buyer", async () => {
    const { creator, actor, live, row, token } = await waiting();
    const since = Date.now();
    const result = await approveLicenseRequest(row.id, actor);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    expect(result.licenseCode).toMatch(LICENSE_CODE_PATTERN);

    expect(captureKeys()).toEqual([`pi-capture:${row.id}:1`]);
    expect(captures.mock.calls[0]?.[0]).toBe(`pi_fake_${row.id}`);
    const after = await requestRow(row.id);
    expect(after).toMatchObject({
      status: "approved",
      paymentAction: "capture",
      stripeAttempt: 1,
    });
    const issued = await onlyLicense(row.id);
    expect(issued.code).toBe(result.licenseCode);
    expect(after.approvedAt).toEqual(after.paymentActionAt);
    expect(issued.startsAt).toEqual(after.approvedAt);
    expect(issued.endsAt).toEqual(
      computeEndsAt(issued.startsAt, row.termKey as TermKey),
    );
    expect(issued).toMatchObject({
      videoId: live.id,
      creatorId: creator.id,
      termsVersion: "v1",
      originalObjectKey: live.originalObjectKey,
      originalBytes: live.originalBytes,
      originalMime: live.originalMime,
    });

    const snapshot = LicenseSnapshotV1Schema.parse(issued.snapshot);
    expect(snapshot).toMatchObject({
      code: issued.code,
      startsAt: issued.startsAt.toISOString(),
      endsAt: issued.endsAt?.toISOString() ?? null,
      issuedAt: issued.createdAt.toISOString(),
      licensee: { name: row.licenseeName },
      creator: { handle: creator.handle, displayName: creator.displayName },
      ownership: { kind: "self_attested" },
      postings: [],
      creditLine: `Video: @${creator.handle}`,
      exclusions: { music: false, people: false },
      amounts: {
        licensePriceCents: row.licensePriceCents,
        platformFeeCents: row.platformFeeCents,
        amountTotalCents: row.amountTotalCents,
        currency: "cad",
      },
      exclusive: false,
      renewalOfCode: null,
    });
    expect(snapshot).not.toHaveProperty("creator.guardianName");

    const transitions = await auditsOf(row.id, "license_request.transition");
    expect(transitions).toContainEqual({
      data: { from: "awaiting_approval", to: "approved", event: "captured" },
      actorType: "creator",
    });
    expect(await auditsOf(issued.id, "license.issued")).toEqual([
      { data: { code: issued.code }, actorType: "creator" },
    ]);

    await flushAfter();
    const [email] = await approvedEmails(row.id);
    expect(email).toMatchObject({
      idempotencyKey: `license-approved/${row.id}`,
      entityType: "license_request",
      status: "sent",
      attempts: 1,
      subject: `Approved: your license ${issued.code} is ready`,
    });
    expect(email?.subject).not.toMatch(/http|t=|\/l\//);
    const sent = await readLatestEmail({
      to: row.buyerEmail,
      template: "license-approved",
      since,
    });
    expect(sent.subject).toBe(`Approved: your license ${issued.code} is ready`);
    const link = new RegExp(
      `${env.APP_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/l/([A-Za-z0-9_-]{43})`,
    ).exec(sent.text);
    expect(link?.[1]).toBe(token);
    expect(hashBuyerToken(link?.[1] ?? "")).toBe(row.buyerTokenHash);
    expect(sent.text).toContain(`${env.APP_URL}/verify/${issued.code}`);
    expect(sent.text).toContain(
      formatMoney(row.amountTotalCents, row.currency),
    );
    expect(sent.text).toContain("Amounts in Canadian dollars (CAD).");
    expect(sent.text).not.toMatch(BARE_DOLLAR);

    const [history] = await listInbox(creator.id, "history");
    expect(history).toMatchObject({
      id: row.id,
      status: "approved",
      displayStatus: "approved",
      licenseCode: issued.code,
    });
  });

  it("keeps a verified owner's identity in the snapshot: the primary posting, its credit line and its link", async () => {
    const { creator, actor } = await approvingCreator();
    const published = await publishVideo(await readyLibraryVideo(creator.id));
    const { row } = await waitingRequest(published);
    const result = await approveLicenseRequest(row.id, actor);
    expect(result.ok).toBe(true);
    const snapshot = LicenseSnapshotV1Schema.parse(
      (await onlyLicense(row.id)).snapshot,
    );
    expect(snapshot.ownership).toMatchObject({
      kind: "verified_owner",
      provider: "mock",
    });
    expect(snapshot.postings).toHaveLength(1);
    expect(snapshot.postings[0]).toMatchObject({
      platform: "mock",
      label: "Demo",
      verified: true,
    });
    expect(snapshot.creditLine).toMatch(/^Video: .+ on Demo$/);
  });

  it("captures once and issues one license when Approve is tapped twice at once (J8.8)", async () => {
    const { actor, row } = await waiting();
    const results = await Promise.all([
      approveLicenseRequest(row.id, actor),
      approveLicenseRequest(row.id, actor),
    ]);
    expect(captureKeys()).toEqual([`pi-capture:${row.id}:1`]);
    expect(await licensesOf(row.id)).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      {
        ok: false,
        reason: "not_actionable",
        status: expect.stringMatching(/^(awaiting_approval|approved)$/),
      },
    ]);
    await flushAfter();
    expect(await approvedEmails(row.id)).toHaveLength(1);
    // One creator transfer, sent once by the Approve that won (P19b).
    await expectPaidOnce(row.id, {
      by: "system",
      amountCents: row.licensePriceCents,
      scripted,
    });
  });

  it("refuses without a claim while payouts aren't active (07 D29, D74, D77)", async () => {
    const { creator, actor } = await approvingCreator({
      payoutsStatus: "pending",
      payoutsStatusSyncedAt: new Date(),
    });
    const { row } = await waitingRequest(await approvableVideo(creator.id));
    expect(await approveLicenseRequest(row.id, actor)).toEqual({
      ok: false,
      reason: "payouts_not_active",
      status: "awaiting_approval",
    });
    expect(await requestRow(row.id)).toMatchObject({
      stripeAttempt: 0,
      paymentAction: null,
    });
    expect(captures).not.toHaveBeenCalled();
  });

  it("refuses without a claim when the video's original isn't ready (07 D33)", async () => {
    const { actor, live, row } = await waiting();
    await db
      .update(video)
      .set({ status: "unpublished", originalStatus: "failed" })
      .where(eq(video.id, live.id));
    expect(await approveLicenseRequest(row.id, actor)).toEqual({
      ok: false,
      reason: "original_missing",
      status: "awaiting_approval",
    });
    expect((await requestRow(row.id)).stripeAttempt).toBe(0);
    expect(captures).not.toHaveBeenCalled();
  });

  it("refuses a request past its deadline without a capture claim, then expires it after the response (01 J8.6; owner answer Q-140 a)", async () => {
    const { actor, row } = await waiting();
    await overdue(row.id);
    expect(await approveLicenseRequest(row.id, actor)).toEqual({
      ok: false,
      reason: "expired",
      status: "awaiting_approval",
    });
    // The expiry the tap found due, as the system's work after the response (02 §8.4): attempt 1 is the expire claim's.
    await flushAfter();
    expect(await requestRow(row.id)).toMatchObject({
      status: "expired",
      statusReason: "deadline",
      expiredAt: expect.any(Date),
      paymentAction: "expire",
      stripeAttempt: 1,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${row.id}:expire:1`, "abandoned"],
    ]);
    expect(captures).not.toHaveBeenCalled();
    expect(await endingsOf(row.id)).toEqual([
      {
        data: {
          from: "awaiting_approval",
          to: "expired",
          event: "expired",
          source: "lazy",
        },
        actorType: "system",
      },
    ]);
    expectScriptPlayed();
  });

  it("tells another creator, or an unknown id, nothing and changes nothing", async () => {
    const { row } = await waiting();
    const other = await bareCreator();
    const before = await auditsFor(row.id);
    for (const [id, actor] of [
      [row.id, other.actor],
      [randomUUID(), other.actor],
    ] as const) {
      expect(await approveLicenseRequest(id, actor)).toEqual({
        ok: false,
        reason: "not_actionable",
        status: null,
      });
    }
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      stripeAttempt: 0,
      paymentAction: null,
    });
    expect(await auditsFor(row.id)).toEqual(before);
    expect(captures).not.toHaveBeenCalled();
  });

  it("reports an approved request as decided when tapped again later, past its deadline: no capture", async () => {
    const { actor, row } = await waiting();
    expect((await approveLicenseRequest(row.id, actor)).ok).toBe(true);
    await overdue(row.id);
    captures.mockClear();
    expect(await approveLicenseRequest(row.id, actor)).toEqual({
      ok: false,
      reason: "not_actionable",
      status: "approved",
    });
    expect(captures).not.toHaveBeenCalled();
    expect(await licensesOf(row.id)).toHaveLength(1);
  });

  it("keeps the claim and records it when the capture went through but the license can't be written", async () => {
    const taken = await takenCode();
    const { actor, row } = await waiting();
    codes.next = [taken, taken, taken, taken, taken];
    expect(await approveLicenseRequest(row.id, actor)).toEqual({
      ok: false,
      reason: "not_actionable",
      status: "awaiting_approval",
    });
    expect(captures).toHaveBeenCalledTimes(1);
    // Reads as Processing… until the stuck-claim reconcile issues the license from Stripe's succeeded.
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
    });
    expect(await licensesOf(row.id)).toEqual([]);
    expect(await auditsOf(row.id, "license_request.issue_failed")).toEqual([
      { data: { error: "Error" }, actorType: "creator" },
    ]);
  });

  it("releases the claim after a transient capture with the hold still on: retry, then a new key (07 D25, D30)", async () => {
    const { actor, row } = await waiting();
    captures.mockResolvedValueOnce({
      ok: false,
      kind: "transient",
      code: "StripeConnectionError",
    });
    expect(await approveLicenseRequest(row.id, actor)).toEqual({
      ok: false,
      reason: "retry",
      status: "awaiting_approval",
    });
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      paymentActionAt: null,
      stripeAttempt: 1,
    });
    expect(await licensesOf(row.id)).toEqual([]);
    const again = await approveLicenseRequest(row.id, actor);
    expect(again.ok).toBe(true);
    expect(captureKeys()).toEqual([
      `pi-capture:${row.id}:1`,
      `pi-capture:${row.id}:2`,
    ]);
    expect((await requestRow(row.id)).stripeAttempt).toBe(2);
  });

  it("J4.7: a price edit while the request waits changes nothing it was quoted; Approve never prices again", async () => {
    const { creator, actor, row } = await waiting(PAID_SOCIAL_YEAR_WORLDWIDE);
    expect(
      computeQuote({
        currency: "cad",
        basePriceCents: 15000,
        useBps: 30000,
        termBps: 20000,
        territoryBps: 17500,
        platformFeeBps: row.platformFeeBps,
        platformFeeMinCents: row.platformFeeMinCents,
      }),
    ).toMatchObject({
      ok: true,
      quote: {
        licensePriceCents: 157500,
        platformFeeCents: 15750,
        totalCents: 173250,
      },
    });
    await saveRateCard(actor, {
      ...defaultRateCardInput("cad"),
      basePriceCents: 20000,
    });
    vi.mocked(computeQuote).mockClear();
    expect((await approveLicenseRequest(row.id, actor)).ok).toBe(true);
    expect(computeQuote).not.toHaveBeenCalled();
    const after = await requestRow(row.id);
    const stored = (r: LicenseRequest) => ({
      basePriceCents: r.basePriceCents,
      useMultiplierBps: r.useMultiplierBps,
      termMultiplierBps: r.termMultiplierBps,
      territoryMultiplierBps: r.territoryMultiplierBps,
      platformFeeBps: r.platformFeeBps,
      licensePriceCents: r.licensePriceCents,
      platformFeeCents: r.platformFeeCents,
      amountTotalCents: r.amountTotalCents,
    });
    expect(stored(after)).toEqual(stored(row));
    expect(stored(after)).toMatchObject({
      basePriceCents: 15000,
      licensePriceCents: 157500,
      platformFeeCents: 15750,
      amountTotalCents: 173250,
    });
    expect(captureKeys()).toEqual([`pi-capture:${row.id}:1`]);
    expect(captures.mock.calls[0]?.[0]).toBe(row.stripePaymentIntentId);
    const snapshot = LicenseSnapshotV1Schema.parse(
      (await onlyLicense(row.id)).snapshot,
    );
    expect(snapshot.amounts).toEqual({
      licensePriceCents: 157500,
      platformFeeCents: 15750,
      amountTotalCents: 173250,
      currency: "cad",
    });
    expect(snapshot.scope).toMatchObject({
      useLabel: "Paid social ads",
      termLabel: "1 year",
      territoryLabel: "Worldwide",
      territoryDetail: null,
    });
    const [history] = await listInbox(creator.id, "history");
    expect(history).toMatchObject({
      amountTotalCents: 173250,
      licensePriceCents: 157500,
      currency: "cad",
    });
    expect(formatMoney(history?.amountTotalCents ?? 0, "cad")).toBe(
      "CA$1,732.50",
    );
  });
});

describe("T7: a capture Stripe refuses for good (03 T7; 07 D25, D30; 01 J8.9)", () => {
  it("cancels the hold under the capture claim taken again, then fails the request with Stripe's code", async () => {
    const { actor, row } = await waiting();
    scripted.next("capture", { kind: "permanent", code: "amount_too_large" });
    expect(await approveLicenseRequest(row.id, actor)).toEqual({
      ok: false,
      reason: "capture_failed",
      status: "capture_failed",
    });
    expect(captureKeys()).toEqual([`pi-capture:${row.id}:1`]);
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${row.id}:capture_failed:2`, "abandoned"],
    ]);
    // The claim taken again committed before the cancel (07 D24): the cancel has a key of its own.
    expect(scripted.callsOf("cancel")[0]?.committed).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
      stripeAttempt: 2,
    });
    expect(await requestRow(row.id)).toMatchObject({
      status: "capture_failed",
      statusReason: "capture_error:amount_too_large",
      captureFailedAt: expect.any(Date),
      paymentAction: "capture",
      stripeAttempt: 2,
    });
    expect(scripted.piStatus(`pi_fake_${row.id}`)).toBe("canceled");
    expect(await licensesOf(row.id)).toEqual([]);
    expect(await endingsOf(row.id)).toEqual([
      {
        data: {
          from: "awaiting_approval",
          to: "capture_failed",
          event: "capture_failed",
        },
        actorType: "creator",
      },
    ]);
    // capture_failed emails nobody in CORE (07 D34): only the authorization's two.
    await flushAfter();
    expect(await emailTemplatesOf(row.id)).toEqual([
      "request-new",
      "request-received",
    ]);
    expectScriptPlayed();
  });

  it("keeps the claim taken again while T7's cancel isn't ok, until the stuck-claim reconcile releases it (07 D26)", async () => {
    const { actor, row } = await waiting();
    scripted.next("capture", { kind: "permanent", code: "amount_too_large" });
    scripted.next("cancel", "transient");
    const logged = captureLogEvents("license_request.capture_cancel_failed");
    // Nothing says "not charged" before Stripe has released the hold: Processing… under the new claim.
    expect(await approveLicenseRequest(row.id, actor)).toEqual({
      ok: false,
      reason: "not_actionable",
      status: "awaiting_approval",
    });
    expect(logged().events).toEqual([
      expect.objectContaining({
        requestId: row.id,
        kind: "transient",
        stripeCode: "StripeConnectionError",
      }),
    ]);
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      statusReason: null,
      paymentAction: "capture",
      stripeAttempt: 2,
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${row.id}:capture_failed:2`, "abandoned"],
    ]);
    // Stripe still holds the card: the reconcile lets the claim go, and the creator can tap again.
    expect(
      await reconcileStuckClaims({ requestId: row.id, olderThanMinutes: 0 }),
    ).toBe(1);
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      paymentActionAt: null,
      stripeAttempt: 2,
    });
    expect(scripted.callsOf("cancel")).toHaveLength(1);
    expect(await licensesOf(row.id)).toEqual([]);
    expectScriptPlayed();
  });

  it("stores a code that doesn't look like Stripe's as capture_error:unknown", async () => {
    const { actor, row } = await waiting();
    scripted.next("capture", { kind: "permanent", code: "Bad Code!" });
    expect(await approveLicenseRequest(row.id, actor)).toEqual({
      ok: false,
      reason: "capture_failed",
      status: "capture_failed",
    });
    expect(await requestRow(row.id)).toMatchObject({
      status: "capture_failed",
      statusReason: "capture_error:unknown",
    });
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${row.id}:capture_failed:2`, "abandoned"],
    ]);
    expectScriptPlayed();
  });

  it("cancels nothing for a permanent failure reported under a claim the caller no longer holds", async () => {
    const { row } = await waiting();
    const stale = await claimed(row.id, "capture");
    expect(await releaseClaim(row.id, stale)).toBe(true);
    const current = await claimed(row.id, "capture");
    expect(
      await reconcileFromStripe(row.id, {
        claim: stale,
        captureOutcome: { ok: false, kind: "permanent", code: "card_declined" },
      }),
    ).toBe("unchanged");
    expect(scripted.callsOf("cancel")).toEqual([]);
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
      paymentActionAt: current.claimedAt,
      stripeAttempt: 2,
    });
    expectScriptPlayed();
  });
});

describe("reconcileFromStripe's base branches (07 D25; 03 T5, T6, T10)", () => {
  it("succeeded on a claimed request: T5, one license, and the buyer's email", async () => {
    const { row } = await waiting();
    const claim = await claimed(row.id, "capture");
    scripted.script({ getAuthorization: { status: "succeeded" } });
    expect(await reconcileFromStripe(row.id)).toBe("finished");
    const after = await requestRow(row.id);
    expect(after.status).toBe("approved");
    expect(after.approvedAt).toEqual(claim.claimedAt);
    expect((await onlyLicense(row.id)).startsAt).toEqual(claim.claimedAt);
    await flushAfter();
    expect(await approvedEmails(row.id)).toMatchObject([{ status: "sent" }]);
  });

  it.each([
    {
      action: "capture",
      status: "capture_failed",
      reason: "pi_canceled_during_capture",
      at: "captureFailedAt",
    },
    {
      action: "decline",
      status: "declined",
      reason: "creator",
      at: "declinedAt",
    },
  ] as const)(
    "canceled with a $action claim → $status ($reason)",
    async ({ action, status, reason, at }) => {
      const { row } = await waiting();
      await claimed(row.id, action);
      scripted.script({ getAuthorization: { status: "canceled" } });
      expect(await reconcileFromStripe(row.id)).toBe("finished");
      const after = await requestRow(row.id);
      expect(after).toMatchObject({ status, statusReason: reason });
      expect(after[at]).toBeInstanceOf(Date);
      expect(await licensesOf(row.id)).toEqual([]);
    },
  );

  it("canceled with an expire claim → expired (deadline)", async () => {
    const { row } = await waiting();
    await overdue(row.id);
    const claim = await claimPaymentAction(row.id, "expire");
    expect(claim?.paymentAction).toBe("expire");
    scripted.script({ getAuthorization: { status: "canceled" } });
    expect(await reconcileFromStripe(row.id)).toBe("finished");
    const after = await requestRow(row.id);
    expect(after).toMatchObject({
      status: "expired",
      statusReason: "deadline",
    });
    expect(after.expiredAt).toBeInstanceOf(Date);
  });

  it("canceled with no claim → expired (hold_released)", async () => {
    const { row } = await waiting();
    scripted.script({ getAuthorization: { status: "canceled" } });
    expect(await reconcileFromStripe(row.id)).toBe("finished");
    expect(await requestRow(row.id)).toMatchObject({
      status: "expired",
      statusReason: "hold_released",
    });
  });

  it("requires_capture: releases the caller's own claim, and leaves a claim it doesn't hold", async () => {
    const { row } = await waiting();
    const claim = await claimed(row.id, "capture");
    expect(await reconcileFromStripe(row.id)).toBe("unchanged");
    expect((await requestRow(row.id)).paymentAction).toBe("capture");
    expect(await reconcileFromStripe(row.id, { claim })).toBe("released");
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      paymentActionAt: null,
      stripeAttempt: 1,
    });
  });

  it("a retrieve that throws changes nothing, and says so", async () => {
    const { row } = await waiting();
    await claimed(row.id, "capture");
    const before = await requestRow(row.id);
    scripted.script({ getAuthorization: new Error("stripe down") });
    await expect(reconcileFromStripe(row.id)).rejects.toThrow("stripe down");
    expect(await requestRow(row.id)).toEqual(before);
  });

  it.each(["declined", "abandoned"] as const)(
    "money moved late on a %s request: one audit, nothing else (OQ-12)",
    async (status) => {
      const { creator } = await approvingCreator();
      const live = await approvableVideo(creator.id);
      const id = randomUUID();
      await insertLicenseRequest(live, {
        id,
        status,
        stripePaymentIntentId: `pi_fake_${id}`,
        ...(status === "declined"
          ? { declinedAt: new Date(), statusReason: "creator" }
          : { abandonedAt: new Date(), statusReason: "amount_mismatch" }),
      });
      scripted.script({ getAuthorization: { status: "succeeded" } });
      expect(await reconcileFromStripe(id, { actor: WEBHOOK })).toBe(
        "unchanged",
      );
      expect(await auditsOf(id, "license_request.money_moved_late")).toEqual([
        { data: { piStatus: "succeeded", status }, actorType: "stripe" },
      ]);
      expect((await requestRow(id)).status).toBe(status);
      expect(await licensesOf(id)).toEqual([]);
    },
  );

  it("succeeded on an approved request changes nothing and writes nothing", async () => {
    const { actor, row } = await waiting();
    expect((await approveLicenseRequest(row.id, actor)).ok).toBe(true);
    // Approve's transfer first (P19b): the snapshot holds its audit.
    await flushAfter();
    const paidOnce = {
      by: "system",
      amountCents: row.licensePriceCents,
      scripted,
    } as const;
    const paid = await expectPaidOnce(row.id, paidOnce);
    const audits = await auditsFor(row.id);
    scripted.script({ getAuthorization: { status: "succeeded" } });
    expect(await reconcileFromStripe(row.id)).toBe("unchanged");
    // The transfer the reconcile schedules finds it paid: skipped, nothing sent or written.
    await flushAfter();
    expect(await auditsFor(row.id)).toEqual(audits);
    expect(await licensesOf(row.id)).toHaveLength(1);
    expect(await expectPaidOnce(row.id, paidOnce)).toEqual(paid);
  });

  it("reconciles a capture claim stuck for over 2 minutes from Stripe's succeeded (07 D26)", async () => {
    const { row } = await waiting();
    const claim = await claimed(row.id, "capture");
    const stuckAt = new Date(claim.claimedAt.getTime() - 3 * MINUTE_MS);
    await db
      .update(licenseRequest)
      .set({ paymentActionAt: stuckAt })
      .where(eq(licenseRequest.id, row.id));
    scripted.script({ getAuthorization: { status: "succeeded" } });
    expect(
      await reconcileStuckClaims({ requestId: row.id, olderThanMinutes: 2 }),
    ).toBe(1);
    const after = await requestRow(row.id);
    expect(after.status).toBe("approved");
    expect(after.approvedAt).toEqual(stuckAt);
  });
});

describe("payment_intent.succeeded and Approve together (01 J9.7)", () => {
  it("webhook first: T5 with no claim, then Approve finds it decided", async () => {
    const { actor, row } = await waiting();
    scripted.script({ getAuthorization: { status: "succeeded" } });
    expect(
      await onWebhookEvent(piEvent("payment_intent.succeeded", row.id), "cad"),
    ).toBe("processed");
    const after = await requestRow(row.id);
    expect(after).toMatchObject({
      status: "approved",
      paymentAction: null,
      stripeAttempt: 0,
    });
    expect((await onlyLicense(row.id)).startsAt).toEqual(after.approvedAt);
    expect(await approveLicenseRequest(row.id, actor)).toEqual({
      ok: false,
      reason: "not_actionable",
      status: "approved",
    });
    expect(captures).not.toHaveBeenCalled();
    await flushAfter();
    expect(await licensesOf(row.id)).toHaveLength(1);
    expect(await approvedEmails(row.id)).toHaveLength(1);
  });

  it("Approve first: the webhook changes nothing", async () => {
    const { actor, row } = await waiting();
    expect((await approveLicenseRequest(row.id, actor)).ok).toBe(true);
    // Approve's transfer first (P19b): the snapshot holds its audit.
    await flushAfter();
    const paidOnce = {
      by: "system",
      amountCents: row.licensePriceCents,
      scripted,
    } as const;
    const paid = await expectPaidOnce(row.id, paidOnce);
    const audits = await auditsFor(row.id);
    scripted.script({ getAuthorization: { status: "succeeded" } });
    expect(
      await onWebhookEvent(piEvent("payment_intent.succeeded", row.id), "cad"),
    ).toBe("processed");
    // The webhook's transfer finds it paid: skipped, nothing sent or written.
    await flushAfter();
    expect(await licensesOf(row.id)).toHaveLength(1);
    expect(await approvedEmails(row.id)).toHaveLength(1);
    expect(await auditsFor(row.id)).toEqual(audits);
    expect(await expectPaidOnce(row.id, paidOnce)).toEqual(paid);
  });

  it("both at once: one license and one email", async () => {
    const { actor, row } = await waiting();
    scripted.script({ getAuthorization: { status: "succeeded" } });
    const [approved] = await Promise.all([
      approveLicenseRequest(row.id, actor),
      onWebhookEvent(piEvent("payment_intent.succeeded", row.id), "cad"),
    ]);
    expect(
      approved.ok ||
        (approved.reason === "not_actionable" &&
          approved.status === "approved"),
    ).toBe(true);
    await flushAfter();
    expect(await licensesOf(row.id)).toHaveLength(1);
    expect(await approvedEmails(row.id)).toHaveLength(1);
    expect((await requestRow(row.id)).status).toBe("approved");
    // Whichever T5 won, and whichever path scheduled it, the creator is paid once (P19b).
    await expectPaidOnce(row.id, {
      amountCents: row.licensePriceCents,
      scripted,
    });
  });

  it("a webhook whose retrieve fails stays unprocessed, so Stripe sends it again (02 §8.1 step 5)", async () => {
    const { row } = await waiting();
    scripted.script({ getAuthorization: new Error("stripe down") });
    const event = piEvent("payment_intent.succeeded", row.id);
    await expect(onWebhookEvent(event, "cad")).rejects.toThrow("stripe down");
    const [stored] = await db
      .select()
      .from(stripeEvent)
      .where(eq(stripeEvent.id, event.id));
    expect(stored).toMatchObject({ processedAt: null, lastError: "Error" });
    expect((await requestRow(row.id)).status).toBe("awaiting_approval");
  });
});

describe("issueLicense (07 D33, D101)", () => {
  it("retries a taken code in its own savepoint: one license with a fresh code, the transaction still usable", async () => {
    const taken = await takenCode();
    const { row } = await waiting();
    codes.next = [taken];
    const issued = await db.transaction(async (tx) => {
      const result = await issueLicense(tx, row.id, new Date(), {
        actor: LAZY,
      });
      // A statement after the collision still runs: the savepoint, not the transaction, was rolled back.
      await tx.execute(sql`select 1`);
      return result;
    });
    expect(issued.code).not.toBe(taken);
    expect(issued.code).toMatch(LICENSE_CODE_PATTERN);
    const stored = await onlyLicense(row.id);
    expect(stored.code).toBe(issued.code);
    expect(LicenseSnapshotV1Schema.parse(stored.snapshot).code).toBe(
      issued.code,
    );
  });

  it("gives up after five taken codes, and nothing commits", async () => {
    const taken = await takenCode();
    const { row } = await waiting();
    codes.next = [taken, taken, taken, taken, taken];
    await expect(
      db.transaction((tx) =>
        issueLicense(tx, row.id, new Date(), { actor: LAZY }),
      ),
    ).rejects.toThrow("no free license code");
    expect(await licensesOf(row.id)).toEqual([]);
    expect(await movementsOf(row.id)).toEqual([]);
  });

  it("returns the request's license when called again, with no second audit", async () => {
    const { row } = await waiting();
    const startsAt = new Date();
    const first = await db.transaction((tx) =>
      issueLicense(tx, row.id, startsAt, { actor: LAZY }),
    );
    const second = await db.transaction((tx) =>
      issueLicense(tx, row.id, new Date(startsAt.getTime() + MINUTE_MS), {
        actor: LAZY,
      }),
    );
    expect(second).toEqual(first);
    expect(await auditsOf(first.licenseId, "license.issued")).toHaveLength(1);
    // The creator's transfer, left pending for the caller to send (P19b): one, however often T5 runs.
    expect(await movementsOf(row.id)).toEqual([
      expect.objectContaining({
        kind: "creator_transfer",
        status: "pending",
        currency: "cad",
        amountCents: row.licensePriceCents,
        attempt: 0,
        stripeObjectId: null,
        claimedAt: null,
      }),
    ]);
  });
});
