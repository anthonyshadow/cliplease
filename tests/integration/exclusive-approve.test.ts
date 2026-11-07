import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/db/client";
import { license, licenseRequest } from "../../src/db/schema";
import type { License, LicenseRequest, Video } from "../../src/db/schema/types";
import { REQUEST_EMAIL_COPY } from "../../src/emails/request-copy";
import type { TermKey } from "../../src/lib/domain/values";
import { formatLicenseDate } from "../../src/lib/format";
import { computeEndsAt } from "../../src/lib/licensing/ends-at";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import {
  LICENSE_CODE_PATTERN,
  LicenseSnapshotV1Schema,
} from "../../src/lib/licensing/snapshot";
import { DAY_MS } from "../../src/lib/time";
import { type Actor, AUTO_APPROVE, LAZY } from "../../src/server/auth/actor";
import { approveLicenseRequest } from "../../src/server/licensing/approve";
import {
  autoApproveRequest,
  retryAutoApprovals,
} from "../../src/server/licensing/auto-approve";
import {
  getLicenseAvailability,
  lockVideoForLicensing,
} from "../../src/server/licensing/availability";
import { sendCreatorTransfer } from "../../src/server/licensing/money";
import {
  createLicenseRequest,
  declineLicenseRequest,
} from "../../src/server/licensing/requests";
import {
  claimPaymentAction,
  releaseClaim,
} from "../../src/server/licensing/state-machine";
import { saveRateCard } from "../../src/server/pricing/rate-card";
import { setVideoExclusiveOffer } from "../../src/server/pricing/video-overrides";
import { flushAfter } from "../helpers/after";
import {
  approvingCreatorWithVideo,
  authorizedMinutesAgo,
  autoWaitingRequest,
  overdue,
  waitingRequest,
} from "../helpers/approval-fixtures";
import { auditsOf } from "../helpers/connect-flow";
import { waitForLockWaiter } from "../helpers/db";
import {
  insertLicense,
  insertLicenseRequest,
  randomHex,
  requestRow,
} from "../helpers/factories";
import { AFTER_FAILED, recordStderr } from "../helpers/logs";
import { deliverPiEvent } from "../helpers/pi-events";
import { cardWith } from "../helpers/rate-card-fixtures";
import { readLatestEmail } from "../helpers/read-latest-email";
import {
  authorize,
  checkoutInput,
  EXCLUSIVE,
  offeringVideo,
  REQUEST_CTX,
  requested,
  settled,
} from "../helpers/request-flow";
import {
  emailKeysOf,
  emailTemplatesOf,
  endingsOf,
  fallbacksOf,
  licensesOf,
  movementsOf,
  onlyLicense,
  outcomeEmails,
} from "../helpers/request-outcomes";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";
import { expectPaidOnce } from "../helpers/transfer-fixtures";

// Approving an exclusive license (P19g; 02 §8.2 step 1c; 03 T4, T5, T8, I35; 07 D110, D111, D113, D127; 01 J12.13,
// J12.14; owner answer Q-179): the capture claim takes the video's lock and re-checks availability, so a request the
// video can no longer take is declined (exclusive_conflict), never charged; an exclusive request's license is
// exclusive for at most a calendar year, its email names its end, and the video reads exclusive_active until it ends or
// is revoked. Auto-approve skips a conflict and its give-up declines one instead of falling back. Forced rows (a license
// or a pending request inserted directly, past T1's and T2's checks) make the conflicts. The payments driver is the
// scripted double; each case has its own creator and video.

vi.mock("@/server/payments/registry", async (importOriginal) =>
  (await import("../helpers/scripted-suite")).scriptedRegistry(
    await importOriginal<typeof import("@/server/payments/registry")>(),
  ),
);

// after() runs at once: the authorization's and the outcome's emails and the creator transfer, which each test waits for.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("../helpers/after")).runAfter,
}));

// I35's code guard (issue.ts): the real check unless a test makes it refuse every term.
const termGuard = vi.hoisted(() => ({ refuse: false }));
vi.mock("@/lib/licensing/ends-at", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/licensing/ends-at")>();
  return {
    ...real,
    isExclusiveTermWithinLimit: (startsAt: Date, endsAt: Date | null) =>
      !termGuard.refuse && real.isExclusiveTermWithinLimit(startsAt, endsAt),
  };
});

let scripted: ScriptedPayments;
beforeEach(() => {
  scripted = installScriptedPayments();
  termGuard.refuse = false;
  recordStderr(AFTER_FAILED);
});
afterEach(finishScriptedTest);

const ROUNDS = 10;
const APPROVED = {
  ok: true,
  licenseCode: expect.stringMatching(LICENSE_CODE_PATTERN),
};
const CONFLICT = {
  ok: false,
  reason: "exclusive_conflict",
  status: "declined",
} as const;
const NOT_ACTIONABLE = {
  ok: false,
  reason: "not_actionable",
  status: null,
} as const;
/** The 1-year worked example, exclusive at ×3.00: CA$4,725.00 + CA$472.50 = CA$5,197.50. */
const EXCLUSIVE_AMOUNTS = {
  licensePriceCents: 472500,
  platformFeeCents: 47250,
  amountTotalCents: 519750,
  currency: "cad",
} as const;
/** A forced row's exclusive pair. */
const EXCLUSIVE_ROW = { exclusive: true, exclusiveMultiplierBps: 30000 };

type Owner = Awaited<ReturnType<typeof offeringVideo>>;

/** A buyer address of its own, so readLatestEmail finds this request's email. */
const buyerEmail = () => `buyer-${randomHex(4)}@example.com`;

/** T1 through createLicenseRequest, then T2 as the webhook brings it (markAuthorized): the request waits. */
async function paid(
  owner: Owner,
  change: Record<string, unknown> = {},
): Promise<LicenseRequest> {
  const row = await requested(owner.live.id, {
    buyerEmail: buyerEmail(),
    ...change,
  });
  return authorize(row.id);
}

/** A request waiting on `live`, inserted directly with T2 applied, past T1's and T2's checks: a forced pending row. */
async function forcedPending(
  live: Pick<Video, "id" | "creatorId">,
  exclusive: boolean,
): Promise<LicenseRequest> {
  return (await waitingRequest(live, exclusive ? EXCLUSIVE_ROW : {})).row;
}

/** An approved request and its license running from now for `term`, inserted directly: a forced license. */
async function runningLicense(
  live: Pick<Video, "id" | "creatorId">,
  exclusive: boolean,
  term: TermKey = "y1",
): Promise<License> {
  const startsAt = new Date();
  const request = await insertLicenseRequest(live, {
    status: "approved",
    termKey: term,
    ...(exclusive ? EXCLUSIVE_ROW : {}),
  });
  return insertLicense(request, {
    exclusive,
    startsAt,
    endsAt: computeEndsAt(startsAt, term),
  });
}

/** Revokes `licenseId` as issued in error (07 D127's admin action, by hand). */
const revoke = (licenseId: string) =>
  db
    .update(license)
    .set({ revokedAt: new Date(), revokedReason: "issued_in_error" })
    .where(eq(license.id, licenseId));

const requestsOf = (videoId: string) =>
  db.select().from(licenseRequest).where(eq(licenseRequest.videoId, videoId));

const exclusiveLicensesOn = (videoId: string) =>
  db
    .select()
    .from(license)
    .where(and(eq(license.videoId, videoId), eq(license.exclusive, true)));

const conflictAudits = (requestId: string) =>
  auditsOf(requestId, "license_request.exclusive_conflict");

/** One outcome email, sent on the first attempt. */
const sentOnce = (template: string) => ({
  template,
  status: "sent",
  attempts: 1,
});

/** The capture and cancel keys the double saw for `requestId`, in order. */
const keysFor = (method: "capture" | "cancel", requestId: string) =>
  scripted
    .callsOf(method)
    .filter((call) => call.requestId === requestId)
    .map((call) => call.key);

/** T1 on `videoId`, which must refuse with `reason` and insert no row. */
async function expectRefused(
  videoId: string,
  change: Record<string, unknown>,
  reason: string,
) {
  const before = await requestsOf(videoId);
  expect(
    await createLicenseRequest(checkoutInput(videoId, change), REQUEST_CTX),
  ).toEqual({ ok: false, reason });
  expect(await requestsOf(videoId)).toEqual(before);
}

/**
 * The request ended declined / exclusive_conflict as the system's `source` (the decline's `attempt`), no license, one
 * conflict audit naming its kind, and one request-declined email whose text has the conflict sentence.
 */
async function expectConflictDeclined(
  row: LicenseRequest,
  {
    source,
    attempt = 1,
    since,
  }: { source: "lazy" | "auto_approve"; attempt?: number; since: number },
) {
  expect(await requestRow(row.id)).toMatchObject({
    status: "declined",
    statusReason: "exclusive_conflict",
    declinedAt: expect.any(Date),
    paymentAction: "decline",
    stripeAttempt: attempt,
  });
  expect(keysFor("capture", row.id)).toEqual([]);
  expect(await licensesOf(row.id)).toEqual([]);
  expect(await conflictAudits(row.id)).toEqual([
    { data: { exclusive: row.exclusive, source }, actorType: "system" },
  ]);
  expect(await endingsOf(row.id)).toEqual([
    {
      data: {
        from: "awaiting_approval",
        to: "declined",
        event: "declined",
        source,
      },
      actorType: "system",
    },
  ]);
  await flushAfter();
  expect(await outcomeEmails(row.id)).toEqual([sentOnce("request-declined")]);
  const sent = await readLatestEmail({
    to: row.buyerEmail,
    template: "request-declined",
    since,
  });
  expect(sent.text).toContain(REQUEST_STATUS_COPY.exclusiveConflictBody);
}

describe("Approve an exclusive request (02 §8.2; 03 T5; 07 D111, D113)", () => {
  it("captures once, issues an exclusive 1-year license with its snapshot, pays the creator, emails its end, and the video reads exclusive_active", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner, EXCLUSIVE);
    expect(row).toMatchObject({ ...EXCLUSIVE_AMOUNTS, exclusive: true });
    const since = Date.now();

    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(APPROVED);
    expect(
      scripted.callsOf("capture").map(({ key, currency }) => [key, currency]),
    ).toEqual([[`pi-capture:${row.id}:1`, "cad"]]);
    expect(scripted.callsOf("cancel")).toEqual([]);

    const after = await requestRow(row.id);
    const issued = await onlyLicense(row.id);
    expect(issued.exclusive).toBe(true);
    expect(after.approvedAt).toEqual(after.paymentActionAt);
    expect(issued.startsAt).toEqual(after.approvedAt);
    expect(issued.endsAt).toEqual(computeEndsAt(issued.startsAt, "y1"));
    const snapshot = LicenseSnapshotV1Schema.parse(issued.snapshot);
    expect(snapshot).toMatchObject({
      code: issued.code,
      exclusive: true,
      renewalOfCode: null,
      amounts: EXCLUSIVE_AMOUNTS,
    });

    await flushAfter();
    expect(await sendCreatorTransfer(row.id)).toBe("skipped");
    await expectPaidOnce(row.id, {
      by: "system",
      amountCents: 472500,
      currency: "cad",
      scripted,
    });

    expect(await emailKeysOf(row.id)).toContain(`license-approved/${row.id}`);
    expect(await outcomeEmails(row.id)).toEqual([sentOnce("license-approved")]);
    const sent = await readLatestEmail({
      to: row.buyerEmail,
      template: "license-approved",
      since,
    });
    if (!issued.endsAt) throw new Error("an exclusive license has an end");
    expect(sent.text).toContain(
      REQUEST_EMAIL_COPY.exclusiveApproved(formatLicenseDate(issued.endsAt)),
    );
    expect(formatLicenseDate(issued.endsAt)).toContain("UTC");

    expect(await getLicenseAvailability(db, owner.live.id)).toMatchObject({
      state: "exclusive_active",
      until: issued.endsAt,
    });
    await expectRefused(owner.live.id, {}, "licensed_exclusively");
    await expectRefused(owner.live.id, EXCLUSIVE, "licensed_exclusively");
  });

  it("a standard approve issues a standard license, its snapshot and email without the exclusive line", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner);
    const since = Date.now();
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(APPROVED);
    const issued = await onlyLicense(row.id);
    expect(issued.exclusive).toBe(false);
    expect(LicenseSnapshotV1Schema.parse(issued.snapshot).exclusive).toBe(
      false,
    );
    await flushAfter();
    const sent = await readLatestEmail({
      to: row.buyerEmail,
      template: "license-approved",
      since,
    });
    expect(sent.text).not.toContain("This license is exclusive");
  });

  it("an exclusive 30-day approve ends 30 days after it starts", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner, {
      exclusive: true,
      termKey: "d30",
      expectedTotalCents: 259875,
    });
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(APPROVED);
    const issued = await onlyLicense(row.id);
    expect(issued.exclusive).toBe(true);
    expect(issued.endsAt).toEqual(
      new Date(issued.startsAt.getTime() + 30 * DAY_MS),
    );
  });

  it("the capture claim waits for the video's lock: nothing claimed or captured until the holder commits", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner, EXCLUSIVE);
    let approving: Promise<unknown> = Promise.resolve();
    let waited: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      await lockVideoForLicensing(tx, owner.live.id);
      approving = approveLicenseRequest(row.id, owner.actor);
      waited = settled(approving);
      await waitForLockWaiter("select %for update");
      expect(scripted.callsOf("capture")).toEqual([]);
      expect(await requestRow(row.id)).toMatchObject({
        status: "awaiting_approval",
        stripeAttempt: 0,
        paymentAction: null,
      });
    });
    expect(await waited).toBeNull();
    expect(await approving).toEqual(APPROVED);
    expect(keysFor("capture", row.id)).toEqual([`pi-capture:${row.id}:1`]);
  });
});

describe("turning the offer off (01 J12.13)", () => {
  const offs: [string, (a: Actor, videoId: string) => Promise<unknown>][] = [
    [
      "the video's switch",
      (a, videoId) =>
        setVideoExclusiveOffer(a, {
          videoId,
          mode: "off",
          multiplierBps: null,
        }),
    ],
    ["the card's switch", (a) => saveRateCard(a, cardWith(false, 30000))],
  ];

  it("after the approval changes nothing the license holds, and the video stays exclusive_active", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner, EXCLUSIVE);
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(APPROVED);
    const before = await onlyLicense(row.id);
    for (const [, turnOff] of offs) await turnOff(owner.actor, owner.live.id);
    expect(await onlyLicense(row.id)).toEqual(before);
    expect(await getLicenseAvailability(db, owner.live.id)).toMatchObject({
      state: "exclusive_active",
      until: before.endsAt,
    });
    await expectRefused(owner.live.id, {}, "licensed_exclusively");
  });

  it.each(offs)(
    "%s while the request waits: Approve still issues the exclusive license",
    async (_, turnOff) => {
      const owner = await offeringVideo();
      const row = await paid(owner, EXCLUSIVE);
      await turnOff(owner.actor, owner.live.id);
      expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(
        APPROVED,
      );
      expect((await onlyLicense(row.id)).exclusive).toBe(true);
      expect(keysFor("capture", row.id)).toEqual([`pi-capture:${row.id}:1`]);
      expect(scripted.callsOf("cancel")).toEqual([]);
    },
  );
});

describe("the claim's re-check declines a conflict (02 §8.2 step 1c; 03 T8; 07 D111)", () => {
  it("a standard request on a video with a running exclusive license: declined as lazy, never captured", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner);
    await runningLicense(owner.live, true);
    const since = Date.now();
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(CONFLICT);
    expect(scripted.callsOf("capture")).toEqual([]);
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${row.id}:decline:1`, "requested_by_customer"],
    ]);
    await expectConflictDeclined(row, { source: "lazy", since });
  });

  it("the mirror: an exclusive request on a video with a running standard license", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner, EXCLUSIVE);
    await runningLicense(owner.live, false);
    const since = Date.now();
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(CONFLICT);
    expect(scripted.cancels()).toEqual([
      [`pi-cancel:${row.id}:decline:1`, "requested_by_customer"],
    ]);
    await expectConflictDeclined(row, { source: "lazy", since });
  });

  it("two exclusives waiting: the first approved is declined, then the other is approved; one exclusive license", async () => {
    const owner = await offeringVideo();
    const first = await paid(owner, EXCLUSIVE);
    const second = await forcedPending(owner.live, true);
    const since = Date.now();
    expect(await approveLicenseRequest(first.id, owner.actor)).toEqual(
      CONFLICT,
    );
    await expectConflictDeclined(first, { source: "lazy", since });
    expect(await approveLicenseRequest(second.id, owner.actor)).toEqual(
      APPROVED,
    );
    expect(keysFor("capture", second.id)).toEqual([
      `pi-capture:${second.id}:1`,
    ]);
    expect(await exclusiveLicensesOn(owner.live.id)).toHaveLength(1);
  });

  it("a standard request while an exclusive one waits is declined", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner);
    await forcedPending(owner.live, true);
    const since = Date.now();
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(CONFLICT);
    await expectConflictDeclined(row, { source: "lazy", since });
  });

  it(`two exclusives approved at once, ${ROUNDS} rounds: at most one capture and one license, every other declined once`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { actor, live } = await approvingCreatorWithVideo();
      const rows = [
        await forcedPending(live, true),
        await forcedPending(live, true),
      ];
      const results = await Promise.all(
        rows.map((r) => approveLicenseRequest(r.id, actor)),
      );
      const captured = rows.flatMap((r) => keysFor("capture", r.id));
      expect(captured.length).toBeLessThanOrEqual(1);
      const licenses = await exclusiveLicensesOn(live.id);
      expect(licenses.length).toBeLessThanOrEqual(1);
      expect(licenses).toHaveLength(captured.length);
      for (const [i, r] of rows.entries()) {
        const stored = await requestRow(r.id);
        if (stored.status === "approved") {
          expect(results[i]).toEqual(APPROVED);
          continue;
        }
        expect(results[i]).toEqual(CONFLICT);
        expect(stored.statusReason).toBe("exclusive_conflict");
        expect(keysFor("cancel", r.id)).toEqual([
          `pi-cancel:${r.id}:decline:1`,
        ]);
      }
    }
  });
});

describe("auto-approve and a conflict (07 D81, D111; owner answer Q-179)", () => {
  it("skips: the request is declined as auto_approve, never captured nor handed to the creator; a retry then finds nothing", async () => {
    const { creator, live } = await approvingCreatorWithVideo();
    const { row } = await autoWaitingRequest(live, 3);
    await runningLicense(live, true);
    const since = Date.now();
    expect(await autoApproveRequest(row.id)).toBe("skipped");
    expect(scripted.callsOf("capture")).toEqual([]);
    expect(await requestRow(row.id)).toMatchObject({
      autoApproveFallbackAt: null,
    });
    await expectConflictDeclined(row, { source: "auto_approve", since });
    expect(await fallbacksOf(row.id)).toEqual([]);
    expect(await emailTemplatesOf(row.id)).toEqual([
      "request-declined",
      "request-received",
    ]);

    const calls = scripted.callsFromNow();
    expect(await retryAutoApprovals({ limit: 10, creatorId: creator.id })).toBe(
      0,
    );
    expect(calls()).toEqual([]);
  });

  /** An auto request authorized `minutesAgo`, a running exclusive license, and the first run's decline released. */
  async function releasedConflict(minutesAgo: number) {
    const owner = await approvingCreatorWithVideo();
    const { row } = await autoWaitingRequest(owner.live, minutesAgo);
    await runningLicense(owner.live, true);
    scripted.next("cancel", "transient");
    expect(await autoApproveRequest(row.id)).toBe("skipped");
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      autoApproveFallbackAt: null,
      stripeAttempt: 1,
    });
    await flushAfter();
    expect(await outcomeEmails(row.id)).toEqual([]);
    expect(await conflictAudits(row.id)).toEqual([]);
    return { ...owner, row };
  }

  it("a released decline is declined by the retry (2 to 10 minutes after authorization), never handed over", async () => {
    const { creator, row } = await releasedConflict(5);
    const since = Date.now();
    expect(await retryAutoApprovals({ limit: 10, creatorId: creator.id })).toBe(
      0,
    );
    expect(keysFor("cancel", row.id)).toEqual([
      `pi-cancel:${row.id}:decline:1`,
      `pi-cancel:${row.id}:decline:2`,
    ]);
    await expectConflictDeclined(row, {
      source: "auto_approve",
      attempt: 2,
      since,
    });
    expect(await fallbacksOf(row.id)).toEqual([]);
    expect(await emailTemplatesOf(row.id)).not.toContain("request-new");
  });

  it("Q-179: 10 minutes after authorization, the give-up declines it instead of falling back gave_up", async () => {
    const { creator, row } = await releasedConflict(5);
    await authorizedMinutesAgo(row.id, 11);
    const since = Date.now();
    const calls = scripted.callsFromNow();
    expect(await retryAutoApprovals({ limit: 10, creatorId: creator.id })).toBe(
      0,
    );
    // No guard and no capture: the give-up's decline is a cancel that can only release the hold.
    expect(calls()).toEqual(["cancel"]);
    expect(keysFor("cancel", row.id)).toEqual([
      `pi-cancel:${row.id}:decline:1`,
      `pi-cancel:${row.id}:decline:2`,
    ]);
    await expectConflictDeclined(row, {
      source: "auto_approve",
      attempt: 2,
      since,
    });
    expect(await fallbacksOf(row.id)).toEqual([]);
    expect(await emailTemplatesOf(row.id)).not.toContain("request-new");
  });
});

describe("a conflict decline Stripe doesn't confirm at once (07 D25, D28)", () => {
  it("a transient cancel with the hold still on: the claim released, no email; the next approve declines under attempt 2", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner);
    await runningLicense(owner.live, true);
    scripted.next("cancel", "transient");
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual({
      ok: false,
      reason: "exclusive_conflict",
      status: "awaiting_approval",
    });
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: null,
      stripeAttempt: 1,
    });
    expect(scripted.piStatus(`pi_fake_${row.id}`)).toBe("requires_capture");
    await flushAfter();
    expect(await outcomeEmails(row.id)).toEqual([]);

    const since = Date.now();
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(CONFLICT);
    expect(keysFor("cancel", row.id)).toEqual([
      `pi-cancel:${row.id}:decline:1`,
      `pi-cancel:${row.id}:decline:2`,
    ]);
    await expectConflictDeclined(row, { source: "lazy", attempt: 2, since });
  });

  it("an ambiguous cancel: Stripe's word finishes it declined / exclusive_conflict", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner);
    await runningLicense(owner.live, true);
    scripted.next("cancel", "ambiguous");
    const since = Date.now();
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(CONFLICT);
    expect(scripted.callsOf("cancel")[0]?.answered).toBe("threw");
    expect(scripted.callsOf("getAuthorization").length).toBeGreaterThan(0);
    await expectConflictDeclined(row, { source: "lazy", since });
  });

  it("an ambiguous cancel whose conflict is gone when Stripe's word is read keeps the decline's own reason", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner);
    const forced = await runningLicense(owner.live, true);
    scripted.next("cancel", "ambiguous");
    // After Stripe canceled the hold, before its answer is lost: the reconcile finds the video open again.
    scripted.onCall(
      "cancel",
      async () => {
        await revoke(forced.id);
      },
      { times: 1 },
    );
    const since = Date.now();
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(CONFLICT);
    expect(await getLicenseAvailability(db, owner.live.id)).toMatchObject({
      state: "open",
    });
    await expectConflictDeclined(row, { source: "lazy", since });
  });

  it("payment_intent.canceled during the conflict's cancel: one decline, one email", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner);
    await runningLicense(owner.live, true);
    const delivered: string[] = [];
    scripted.onCall(
      "cancel",
      async () => {
        delivered.push(await deliverPiEvent("payment_intent.canceled", row.id));
      },
      { times: 1 },
    );
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(CONFLICT);
    expect(delivered).toEqual(["processed"]);
    expect(await requestRow(row.id)).toMatchObject({
      status: "declined",
      statusReason: "exclusive_conflict",
    });
    expect(await conflictAudits(row.id)).toHaveLength(1);
    expect(await endingsOf(row.id)).toHaveLength(1);
    await flushAfter();
    expect(await outcomeEmails(row.id)).toEqual([sentOnce("request-declined")]);
  });

  it("no regression: a creator's own ambiguous decline with no conflict ends creator", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner);
    scripted.next("cancel", "ambiguous");
    expect(await declineLicenseRequest(row.id, owner.actor)).toEqual({
      ok: true,
    });
    expect(await requestRow(row.id)).toMatchObject({
      status: "declined",
      statusReason: "creator",
    });
    expect(await conflictAudits(row.id)).toEqual([]);
  });
});

describe("who may decline for a conflict, and which rows are re-checked (07 D28, D111)", () => {
  it("refuses the system with another reason and the creator with exclusive_conflict: nothing changes, Stripe isn't asked", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner);
    await flushAfter();
    const before = await requestRow(row.id);
    const calls = scripted.callsFromNow();
    for (const [actor, reason] of [
      [LAZY, "creator"],
      [AUTO_APPROVE, "video_disabled"],
      [owner.actor, "exclusive_conflict"],
    ] as const) {
      expect(await declineLicenseRequest(row.id, actor, reason)).toEqual(
        NOT_ACTIONABLE,
      );
    }
    expect(await requestRow(row.id)).toEqual(before);
    expect(calls()).toEqual([]);
  });

  it("an overdue row and an already-claimed row get null, not a conflict, and nothing is canceled", async () => {
    const { live } = await approvingCreatorWithVideo();
    const late = await forcedPending(live, false);
    const held = await forcedPending(live, false);
    const claimed = await claimPaymentAction(held.id, "decline");
    expect(claimed?.paymentAction).toBe("decline");
    await runningLicense(live, true);
    await overdue(late.id);
    expect(await claimPaymentAction(late.id, "capture")).toBeNull();
    expect(await claimPaymentAction(held.id, "capture")).toBeNull();
    expect(scripted.callsOf("cancel")).toEqual([]);
    expect(await requestRow(late.id)).toMatchObject({
      paymentAction: null,
      stripeAttempt: 0,
    });
    expect(await requestRow(held.id)).toMatchObject({
      paymentAction: "decline",
      stripeAttempt: 1,
    });
  });
});

describe("a capture claim holds the video past its deadline (owner answer Q-182; known risk 19)", () => {
  it("until it is released: the video reads reserved, another exclusive is declined and a standard request refused", async () => {
    const owner = await offeringVideo();
    const first = await forcedPending(owner.live, true);
    const claimed = await claimPaymentAction(first.id, "capture");
    if (!claimed || "conflict" in claimed) throw new Error("not claimed");
    // The capture may have taken the money, and its finish hasn't run yet when the deadline passes.
    await overdue(first.id);
    expect(await getLicenseAvailability(db, owner.live.id)).toMatchObject({
      state: "reserved",
    });
    await expectRefused(owner.live.id, {}, "video_reserved");
    const since = Date.now();
    const second = await forcedPending(owner.live, true);
    expect(await approveLicenseRequest(second.id, owner.actor)).toEqual(
      CONFLICT,
    );
    await expectConflictDeclined(second, { source: "lazy", since });

    // Released (nothing moved): an overdue request without a claim holds nothing.
    expect(
      await releaseClaim(first.id, {
        action: "capture",
        claimedAt: claimed.paymentActionAt,
      }),
    ).toBe(true);
    expect(await getLicenseAvailability(db, owner.live.id)).toMatchObject({
      state: "open",
    });
  });
});

describe("I35's code guard (07 D111, D112)", () => {
  it("an exclusive term past its limit issues nothing: the issue_failed audit, the capture claim kept", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner, EXCLUSIVE);
    termGuard.refuse = true;
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual({
      ok: false,
      reason: "not_actionable",
      status: "awaiting_approval",
    });
    expect(keysFor("capture", row.id)).toEqual([`pi-capture:${row.id}:1`]);
    expect(await licensesOf(row.id)).toEqual([]);
    expect(await movementsOf(row.id)).toEqual([]);
    expect(await requestRow(row.id)).toMatchObject({
      status: "awaiting_approval",
      paymentAction: "capture",
    });
    expect(await auditsOf(row.id, "license_request.issue_failed")).toEqual([
      { data: { error: "ExclusiveTermTooLongError" }, actorType: "creator" },
    ]);
  });

  it("runs only for an exclusive license: a standard approve still issues", async () => {
    const owner = await offeringVideo();
    const row = await paid(owner);
    termGuard.refuse = true;
    expect(await approveLicenseRequest(row.id, owner.actor)).toEqual(APPROVED);
    expect((await onlyLicense(row.id)).exclusive).toBe(false);
  });
});

describe("a revoked exclusive license opens the video (01 J12.14)", () => {
  it("availability reads open, and a new exclusive request is approved with no conflict", async () => {
    const owner = await offeringVideo();
    const first = await paid(owner, EXCLUSIVE);
    expect(await approveLicenseRequest(first.id, owner.actor)).toEqual(
      APPROVED,
    );
    await revoke((await onlyLicense(first.id)).id);
    expect(await getLicenseAvailability(db, owner.live.id)).toMatchObject({
      state: "open",
    });
    const next = await paid(owner, EXCLUSIVE);
    expect(await approveLicenseRequest(next.id, owner.actor)).toEqual(APPROVED);
    expect((await onlyLicense(next.id)).exclusive).toBe(true);
    expect(scripted.callsOf("cancel")).toEqual([]);
  });
});
