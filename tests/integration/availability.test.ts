import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, pool, type Tx } from "../../src/db/client";
import {
  auditEvent,
  creatorProfile,
  license,
  licenseRequest,
  rateCard,
  rateOption,
  video,
} from "../../src/db/schema";
import type { LicenseRequest, Video } from "../../src/db/schema/types";
import { DAY_MS } from "../../src/lib/time";
import { type Actor, WEBHOOK } from "../../src/server/auth/actor";
import { env } from "../../src/server/env";
import {
  getLicenseAvailability,
  loadAvailabilityFacts,
  lockVideoForLicensing,
} from "../../src/server/licensing/availability";
import {
  type CreateLicenseRequestResult,
  createLicenseRequest,
  markAuthorized,
} from "../../src/server/licensing/requests";
import { claimPaymentAction } from "../../src/server/licensing/state-machine";
import { saveRateCard } from "../../src/server/pricing/rate-card";
import { setVideoExclusiveOffer } from "../../src/server/pricing/video-overrides";
import {
  listPublicVideos,
  readLicensePageData,
} from "../../src/server/videos/public";
import {
  getVideoAvailability,
  listCreatorVideos,
} from "../../src/server/videos/queries";
import { flushAfter } from "../helpers/after";
import {
  approvableVideo,
  approvingCreatorWithVideo,
  overdue,
  pendingCheckoutRequest,
  waitingRequest,
} from "../helpers/approval-fixtures";
import { expectDbError, PG_ERROR, waitForLockWaiter } from "../helpers/db";
import {
  insertLicense,
  insertLicenseRequest,
  requestRow,
} from "../helpers/factories";
import { AFTER_FAILED, recordStderr } from "../helpers/logs";
import { cardWith } from "../helpers/rate-card-fixtures";
import {
  authorize,
  checkoutInput,
  EXCLUSIVE,
  offeringVideo,
  PAST_THE_POOL,
  REQUEST_CTX,
  requested,
  requestedPastThePool,
  setHold,
  settled,
  withoutStarvingPool,
} from "../helpers/request-flow";
import type { ScriptedPayments } from "../helpers/scripted-payments";
import {
  cancels,
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";

// Whether a video can be licensed, and what holds to it (P19f; 02 §5.7; 07 D110; 01 J12.13; owner answers Q-170, Q-171;
// AD-55–AD-60) against the test database: every availability state from the rows that cause it; T1's refusals, its
// snapshot and its second quote under the video's lock; T2's lock and re-check; who wins a race; and turning the offer
// off under a request. The hold's own rules are in checkout-hold.test.ts. The payments driver is the scripted double.

vi.mock("@/server/payments/registry", async (importOriginal) =>
  (await import("../helpers/scripted-suite")).scriptedRegistry(
    await importOriginal<typeof import("@/server/payments/registry")>(),
  ),
);

// after() runs at once: an authorized request's emails, which each test waits for (finishScriptedTest).
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

const STANDARD_TOTAL = 173250;
const ROUNDS = 10;

const requestsOf = (videoId: string) =>
  db.select().from(licenseRequest).where(eq(licenseRequest.videoId, videoId));

const stateOf = async (videoId: string) =>
  (await getLicenseAvailability(db, videoId)).state;

/** A request as a license's row: approved, or exclusive and approved. */
const licensedRequest = (
  live: Pick<Video, "id" | "creatorId">,
  exclusive = false,
) =>
  insertLicenseRequest(live, {
    status: "approved",
    exclusive,
    exclusiveMultiplierBps: exclusive ? 30000 : 10000,
  });

/** A license running from now: 30 days unless told otherwise. */
async function runningLicense(
  live: Pick<Video, "id" | "creatorId">,
  exclusive = false,
  overrides: Parameters<typeof insertLicense>[1] = {},
) {
  return insertLicense(await licensedRequest(live, exclusive), {
    exclusive,
    ...overrides,
  });
}

/** T1 on `videoId`, which must refuse with `reason` and leave no row nor audit. */
async function expectRefused(
  videoId: string,
  change: Record<string, unknown>,
  reason: string,
) {
  const before = await requestsOf(videoId);
  const audits = await createdAudits(videoId);
  expect(
    await createLicenseRequest(checkoutInput(videoId, change), REQUEST_CTX),
  ).toEqual({ ok: false, reason });
  expect(await requestsOf(videoId)).toEqual(before);
  expect(await createdAudits(videoId)).toEqual(audits);
}

/** The video's license_request.created audits. */
const createdAudits = (videoId: string) =>
  db
    .select({ id: auditEvent.id })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.action, "license_request.created"),
        sql`${auditEvent.data}->>'videoId' = ${videoId}`,
      ),
    );

/**
 * Holds the video's row while T1 for `change` arrives and queues on it, runs `meanwhile` in the holder, commits, and
 * returns T1's answer.
 */
async function requestDuringLock(
  videoId: string,
  change: Record<string, unknown>,
  meanwhile: (tx: Tx) => Promise<unknown>,
): Promise<CreateLicenseRequestResult> {
  let attempt: Promise<CreateLicenseRequestResult> | undefined;
  await db.transaction(async (tx) => {
    await lockVideoForLicensing(tx, videoId);
    attempt = createLicenseRequest(checkoutInput(videoId, change), REQUEST_CTX);
    await waitForLockWaiter("select %for update");
    await meanwhile(tx);
  });
  if (!attempt) throw new Error("no attempt");
  return attempt;
}

/** The two rows' statuses after a race for one video. */
function expectOneWon(rows: readonly LicenseRequest[]) {
  const won = rows.filter((r) => r.status === "awaiting_approval");
  const lost = rows.filter((r) => r.status === "abandoned");
  expect(won).toHaveLength(1);
  expect(lost).toHaveLength(1);
  expect(lost[0]?.statusReason).toBe("video_unavailable");
}

describe("every state (07 D110)", () => {
  it("is open with nothing on the video, the offer deciding only whether it can be requested exclusively; the facts are real booleans", async () => {
    const { actor, live } = await approvingCreatorWithVideo();
    expect(await getLicenseAvailability(db, live.id)).toEqual({
      state: "open",
      canRequestNonExclusive: true,
      canRequestExclusive: false,
      until: null,
      reservationPlanId: null,
    });
    await saveRateCard(actor, cardWith(true, 30000));
    expect(await getLicenseAvailability(db, live.id)).toMatchObject({
      state: "open",
      canRequestExclusive: true,
    });
    expect(await loadAvailabilityFacts(db, live.id)).toEqual({
      runningExclusiveUntil: null,
      runningNonExclusive: false,
      pendingExclusive: false,
      pendingNonExclusive: false,
      reservationUntil: null,
      reservationPlanId: null,
    });
  });

  it("is non_exclusive_only from a running standard license and a perpetual one", async () => {
    const running = await offeringVideo();
    await runningLicense(running.live);
    expect(await getLicenseAvailability(db, running.live.id)).toMatchObject({
      state: "non_exclusive_only",
      canRequestNonExclusive: true,
      canRequestExclusive: false,
      until: null,
    });

    const perpetual = await offeringVideo();
    await insertLicense(
      await insertLicenseRequest(perpetual.live, {
        status: "approved",
        termKey: "perpetual",
      }),
      { endsAt: null },
    );
    expect(await stateOf(perpetual.live.id)).toBe("non_exclusive_only");
  });

  it("is non_exclusive_only from a fresh standard request in checkout, and from one waiting, claimed or not", async () => {
    const paying = await offeringVideo();
    await insertLicenseRequest(paying.live);
    expect(await stateOf(paying.live.id)).toBe("non_exclusive_only");

    const waiting = await offeringVideo();
    const { row } = await waitingRequest(waiting.live);
    expect(await stateOf(waiting.live.id)).toBe("non_exclusive_only");
    expect(await claimPaymentAction(row.id, "decline")).not.toBeNull();
    expect(await stateOf(waiting.live.id)).toBe("non_exclusive_only");
  });

  it("is reserved from an exclusive request in checkout, or waiting", async () => {
    const exclusiveRow = { exclusive: true, exclusiveMultiplierBps: 30000 };
    const paying = await offeringVideo();
    await insertLicenseRequest(paying.live, exclusiveRow);
    expect(await getLicenseAvailability(db, paying.live.id)).toMatchObject({
      state: "reserved",
      canRequestNonExclusive: false,
      canRequestExclusive: false,
      until: null,
    });

    const waiting = await offeringVideo();
    await waitingRequest(waiting.live, exclusiveRow);
    expect(await stateOf(waiting.live.id)).toBe("reserved");
  });

  it("is exclusive_active from an exclusive license, until the latest of two, an upcoming term included", async () => {
    const { live } = await offeringVideo();
    const now = Date.now();
    const sooner = new Date(now + 30 * DAY_MS);
    const later = new Date(now + 395 * DAY_MS);
    await runningLicense(live, true, { endsAt: sooner });
    await runningLicense(live, true, {
      startsAt: new Date(now + 30 * DAY_MS),
      endsAt: later,
    });
    const availability = await getLicenseAvailability(db, live.id);
    expect(availability).toMatchObject({
      state: "exclusive_active",
      canRequestNonExclusive: false,
      canRequestExclusive: false,
    });
    expect(availability.until).toBeInstanceOf(Date);
    expect(availability.until).toEqual(later);
  });

  it("is open again once the license is revoked or has ended", async () => {
    const revoked = await offeringVideo();
    const issued = await runningLicense(revoked.live, true);
    expect(await stateOf(revoked.live.id)).toBe("exclusive_active");
    await db
      .update(license)
      .set({ revokedAt: new Date(), revokedReason: "issued_in_error" })
      .where(eq(license.id, issued.id));
    expect(await stateOf(revoked.live.id)).toBe("open");

    const ended = await offeringVideo();
    const now = Date.now();
    await runningLicense(ended.live, true, {
      startsAt: new Date(now - 40 * DAY_MS),
      endsAt: new Date(now - 10 * DAY_MS),
    });
    expect(await stateOf(ended.live.id)).toBe("open");
  });
});

describe("stale rows don't block (owner answer Q-170)", () => {
  const exclusiveRow = { exclusive: true, exclusiveMultiplierBps: 30000 };

  it("a session past its end, a hold past with its session open, a waiting request past its deadline", async () => {
    const sessionOver = await offeringVideo();
    await insertLicenseRequest(sessionOver.live, {
      ...exclusiveRow,
      checkoutExpiresAt: new Date(Date.now() - 60_000),
    });
    expect(await stateOf(sessionOver.live.id)).toBe("open");

    const holdOver = await offeringVideo();
    const { row: lapsed } = await pendingCheckoutRequest(
      holdOver.live,
      exclusiveRow,
    );
    expect(await stateOf(holdOver.live.id)).toBe("reserved");
    await setHold(lapsed.id, -1);
    expect(await stateOf(holdOver.live.id)).toBe("open");

    const late = await offeringVideo();
    const { row: waiting } = await waitingRequest(late.live, exclusiveRow);
    expect(await stateOf(late.live.id)).toBe("reserved");
    await overdue(waiting.id);
    expect(await stateOf(late.live.id)).toBe("open");
  });

  it.each([
    "approved",
    "declined",
    "expired",
    "abandoned",
    "capture_failed",
    "renewal_canceled",
    "renewal_failed",
  ] as const)("a request that ended %s", async (status) => {
    const { live } = await offeringVideo();
    await insertLicenseRequest(live, { ...exclusiveRow, status });
    expect(await stateOf(live.id)).toBe("open");
  });
});

describe("T1's refusals (02 §5.7; AD-58)", () => {
  it("video_reserved for both kinds while an exclusive request waits", async () => {
    const { live } = await offeringVideo();
    await requested(live.id, EXCLUSIVE);
    await expectRefused(live.id, {}, "video_reserved");
    await expectRefused(live.id, EXCLUSIVE, "video_reserved");
    expect(cancels()).toEqual([]);
  });

  it("licensed_exclusively for both kinds while an exclusive license runs", async () => {
    const { live } = await offeringVideo();
    await runningLicense(live, true);
    await expectRefused(live.id, {}, "licensed_exclusively");
    await expectRefused(live.id, EXCLUSIVE, "licensed_exclusively");
  });

  it("exclusive_unavailable for an exclusive while a standard license runs, or a standard request waits", async () => {
    const licensed = await offeringVideo();
    await runningLicense(licensed.live);
    await expectRefused(licensed.live.id, EXCLUSIVE, "exclusive_unavailable");

    const waiting = await offeringVideo();
    await requested(waiting.live.id);
    await expectRefused(waiting.live.id, EXCLUSIVE, "exclusive_unavailable");
  });

  it("exclusive_unavailable when it isn't offered, before any price, and option_disabled for an exclusive Perpetual", async () => {
    const { live } = await approvingCreatorWithVideo();
    await expectRefused(live.id, EXCLUSIVE, "exclusive_unavailable");
    await expectRefused(
      live.id,
      { exclusive: true, expectedTotalCents: 1 },
      "exclusive_unavailable",
    );

    const offering = await offeringVideo();
    await expectRefused(
      offering.live.id,
      { ...EXCLUSIVE, termKey: "perpetual" },
      "option_disabled",
    );
  });

  it("the CHECK backs the term: an exclusive row can't be Perpetual", async () => {
    const { live } = await offeringVideo();
    const row = await insertLicenseRequest(live, { termKey: "perpetual" });
    await expectDbError(
      db
        .update(licenseRequest)
        .set({ exclusive: true, exclusiveMultiplierBps: 30000 })
        .where(eq(licenseRequest.id, row.id)),
      {
        code: PG_ERROR.check,
        constraint: "license_request_exclusive_fields",
      },
    );
  });

  it("standard requests sit side by side", async () => {
    const { live } = await offeringVideo();
    await requested(live.id);
    await requested(live.id);
    const rows = await requestsOf(live.id);
    expect(rows.map((r) => r.status)).toEqual([
      "checkout_pending",
      "checkout_pending",
    ]);
  });
});

describe("the snapshot, and what a browser can't change (07 D79, D109, D111)", () => {
  it("stores the exclusive request as quoted, with the premium", async () => {
    const { live } = await offeringVideo();
    expect(await requested(live.id, EXCLUSIVE)).toMatchObject({
      exclusive: true,
      exclusiveMultiplierBps: 30000,
      licensePriceCents: 472500,
      platformFeeCents: 47250,
      amountTotalCents: 519750,
    });
  });

  it("stores a video's own premium", async () => {
    const { actor, live } = await offeringVideo();
    await setVideoExclusiveOffer(actor, {
      videoId: live.id,
      mode: "on",
      multiplierBps: 20000,
    });
    expect(
      await requested(live.id, { exclusive: true, expectedTotalCents: 346500 }),
    ).toMatchObject({
      exclusive: true,
      exclusiveMultiplierBps: 20000,
      licensePriceCents: 315000,
      platformFeeCents: 31500,
      amountTotalCents: 346500,
    });
  });

  it("stores a standard request at ×1.00, whatever is on offer", async () => {
    const { live } = await offeringVideo();
    expect(await requested(live.id)).toMatchObject({
      exclusive: false,
      exclusiveMultiplierBps: 10000,
      amountTotalCents: STANDARD_TOTAL,
    });
  });

  it("refuses a total that doesn't match the type sent, or the video's own premium, with the server's", async () => {
    const { actor, live } = await offeringVideo();
    const send = (change: Record<string, unknown>) =>
      createLicenseRequest(checkoutInput(live.id, change), REQUEST_CTX);
    expect(
      await send({ exclusive: true, expectedTotalCents: STANDARD_TOTAL }),
    ).toEqual({ ok: false, reason: "price_changed", totalCents: 519750 });
    expect(
      await send({ exclusive: false, expectedTotalCents: 519750 }),
    ).toEqual({
      ok: false,
      reason: "price_changed",
      totalCents: STANDARD_TOTAL,
    });
    await setVideoExclusiveOffer(actor, {
      videoId: live.id,
      mode: "on",
      multiplierBps: 20000,
    });
    expect(await send(EXCLUSIVE)).toEqual({
      ok: false,
      reason: "price_changed",
      totalCents: 346500,
    });
    expect(await requestsOf(live.id)).toEqual([]);
  });

  it("strips a premium or a price sent beside the type", async () => {
    const { live } = await offeringVideo();
    const input = checkoutInput(live.id, {
      ...EXCLUSIVE,
      exclusiveMultiplierBps: 10000,
      licensePriceCents: 1,
    });
    expect(input).not.toHaveProperty("exclusiveMultiplierBps");
    expect(input).not.toHaveProperty("licensePriceCents");
    expect(await createLicenseRequest(input, REQUEST_CTX)).toMatchObject({
      ok: true,
    });
    const [row] = await requestsOf(live.id);
    expect(row).toMatchObject({
      exclusiveMultiplierBps: 30000,
      licensePriceCents: 472500,
    });
  });

  it("names an exclusive license on Checkout's line", async () => {
    const { live } = await offeringVideo();
    await requested(live.id, EXCLUSIVE);
    expect(scripted.callsOf("createCheckout")[0]?.args[0]).toMatchObject({
      licenseLabel: `Exclusive license · ${live.title} · Paid social ads · 1 year · Worldwide`,
      licensePriceCents: 472500,
      platformFeeCents: 47250,
    });
  });

  it("the same exclusive submission twice at once is one row and one Checkout, never video_reserved", async () => {
    const { live } = await offeringVideo();
    const once = checkoutInput(live.id, EXCLUSIVE);
    const results = await Promise.all([
      createLicenseRequest(once, REQUEST_CTX),
      createLicenseRequest(once, REQUEST_CTX),
    ]);
    expect(await requestsOf(live.id)).toHaveLength(1);
    expect(scripted.callsOf("createCheckout")).toHaveLength(1);
    const urls = results.flatMap((r) => (r.ok ? [r.checkoutUrl] : []));
    expect(urls.length).toBeGreaterThanOrEqual(1);
    expect(new Set(urls).size).toBe(1);
    for (const r of results) {
      if (!r.ok) expect(r.reason).toBe("already_submitted");
    }
    // One after the other: the same Checkout.
    expect(await createLicenseRequest(once, REQUEST_CTX)).toEqual({
      ok: true,
      checkoutUrl: urls[0],
    });
  });

  it("a resubmit that flips the type at the same total is already sent", async () => {
    const { actor, live } = await approvingCreatorWithVideo();
    await saveRateCard(actor, cardWith(true, 10000));
    const once = checkoutInput(live.id);
    expect(await createLicenseRequest(once, REQUEST_CTX)).toMatchObject({
      ok: true,
    });
    expect(
      await createLicenseRequest({ ...once, exclusive: true }, REQUEST_CTX),
    ).toEqual({ ok: false, reason: "already_submitted" });
    expect(await requestsOf(live.id)).toHaveLength(1);
  });
});

describe("T1 under the video's lock (AD-57)", () => {
  /** T1 waited on the lock and refused: no row, no Checkout. */
  async function expectRefusedDuringLock(
    live: Pick<Video, "id">,
    change: Record<string, unknown>,
    meanwhile: Parameters<typeof requestDuringLock>[2],
    want: Extract<CreateLicenseRequestResult, { ok: false }>,
  ) {
    const before = (await requestsOf(live.id)).length;
    const checkouts = scripted.callsOf("createCheckout").length;
    expect(await requestDuringLock(live.id, change, meanwhile)).toEqual(want);
    expect(await requestsOf(live.id)).toHaveLength(before);
    expect(scripted.callsOf("createCheckout")).toHaveLength(checkouts);
  }

  it("option_disabled when the video's use went off, or the card's option", async () => {
    const byVideo = await offeringVideo();
    await expectRefusedDuringLock(
      byVideo.live,
      {},
      (tx) =>
        tx
          .update(video)
          .set({ disabledUses: ["paid_social"] })
          .where(eq(video.id, byVideo.live.id)),
      { ok: false, reason: "option_disabled" },
    );

    const byCard = await offeringVideo();
    await expectRefusedDuringLock(
      byCard.live,
      {},
      async (tx) => {
        const [card] = await tx
          .select({ id: rateCard.id })
          .from(rateCard)
          .where(eq(rateCard.creatorId, byCard.creator.id));
        await tx
          .update(rateOption)
          .set({ enabled: false })
          .where(
            and(
              eq(rateOption.rateCardId, card?.id ?? ""),
              eq(rateOption.optionKey, "worldwide"),
            ),
          );
      },
      { ok: false, reason: "option_disabled" },
    );
  });

  it("price_changed when the premium moved", async () => {
    const { live } = await offeringVideo();
    await expectRefusedDuringLock(
      live,
      EXCLUSIVE,
      (tx) =>
        tx
          .update(video)
          .set({ exclusiveEnabled: true, exclusiveMultiplierBps: 40000 })
          .where(eq(video.id, live.id)),
      { ok: false, reason: "price_changed", totalCents: 693000 },
    );
  });

  it("not_available when the video was unpublished", async () => {
    const { live } = await offeringVideo();
    await expectRefusedDuringLock(
      live,
      {},
      (tx) =>
        tx
          .update(video)
          .set({ status: "unpublished" })
          .where(eq(video.id, live.id)),
      { ok: false, reason: "not_available" },
    );
  });

  it("availability answers before the price: a reserved video with a changed premium is video_reserved", async () => {
    const { live } = await offeringVideo();
    await requested(live.id, EXCLUSIVE);
    await expectRefusedDuringLock(
      live,
      EXCLUSIVE,
      (tx) =>
        tx
          .update(video)
          .set({ exclusiveEnabled: true, exclusiveMultiplierBps: 40000 })
          .where(eq(video.id, live.id)),
      { ok: false, reason: "video_reserved" },
    );
  });

  it("throws when the creator's currency changed, which a total alone wouldn't show, and saves nothing", async () => {
    const { creator, live } = await offeringVideo();
    await expect(
      requestDuringLock(live.id, {}, (tx) =>
        tx
          .update(creatorProfile)
          .set({ payoutCurrency: "usd" })
          .where(eq(creatorProfile.id, creator.id)),
      ),
    ).rejects.toThrow("the creator's currency changed");
    expect(await requestsOf(live.id)).toEqual([]);
    expect(scripted.callsOf("createCheckout")).toEqual([]);
  });

  it("the amounts stored and sent to Checkout are the quote made under the lock", async () => {
    const { creator, live } = await offeringVideo();
    const feeBps = env.PLATFORM_FEE_BPS;
    try {
      // The same total, split another way: CA$132 × 10.5 = CA$1,386.00 + 25% = CA$1,732.50.
      const result = await requestDuringLock(live.id, {}, async (tx) => {
        env.PLATFORM_FEE_BPS = 2500;
        await tx
          .update(rateCard)
          .set({ basePriceCents: 13200 })
          .where(eq(rateCard.creatorId, creator.id));
      });
      expect(result).toMatchObject({ ok: true });
    } finally {
      env.PLATFORM_FEE_BPS = feeBps;
    }
    const [row] = await requestsOf(live.id);
    expect(row).toMatchObject({
      basePriceCents: 13200,
      platformFeeBps: 2500,
      licensePriceCents: 138600,
      platformFeeCents: 34650,
      amountTotalCents: STANDARD_TOTAL,
    });
    expect(scripted.callsOf("createCheckout")[0]?.args[0]).toMatchObject({
      licensePriceCents: 138600,
      platformFeeCents: 34650,
    });
  });
});

describe("races for one video (real pool)", () => {
  it(`exclusive against standard, ${ROUNDS} rounds: one new row, the loser told which`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { live } = await offeringVideo();
      const [exclusive, standard] = await Promise.all([
        createLicenseRequest(checkoutInput(live.id, EXCLUSIVE), REQUEST_CTX),
        createLicenseRequest(checkoutInput(live.id), REQUEST_CTX),
      ]);
      expect(await requestsOf(live.id)).toHaveLength(1);
      if (exclusive.ok) {
        expect(standard).toEqual({ ok: false, reason: "video_reserved" });
      } else {
        expect(standard.ok).toBe(true);
        expect(exclusive).toEqual({
          ok: false,
          reason: "exclusive_unavailable",
        });
      }
    }
  });

  it(`two exclusives, ${ROUNDS} rounds: one row, one video_reserved`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { live } = await offeringVideo();
      const results = await Promise.all([
        createLicenseRequest(checkoutInput(live.id, EXCLUSIVE), REQUEST_CTX),
        createLicenseRequest(checkoutInput(live.id, EXCLUSIVE), REQUEST_CTX),
      ]);
      expect(await requestsOf(live.id)).toHaveLength(1);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok)).toEqual([
        { ok: false, reason: "video_reserved" },
      ]);
    }
  });

  it.each([5, PAST_THE_POOL])(
    "%i standards while an exclusive waits: all video_reserved, no row, and the pool isn't starved",
    async (count) => {
      const { live } = await offeringVideo();
      await requested(live.id, EXCLUSIVE);
      const results = await withoutStarvingPool(
        Array.from({ length: count }, () => checkoutInput(live.id)),
        (input) => createLicenseRequest(input, REQUEST_CTX),
      );
      expect(results).toEqual(
        results.map(() => ({ ok: false, reason: "video_reserved" })),
      );
      expect(await requestsOf(live.id)).toHaveLength(1);
    },
  );

  it(`${PAST_THE_POOL} standards on an open video: all taken, and the pool isn't starved under the second quote`, async () => {
    const { live } = await offeringVideo();
    const results = await withoutStarvingPool(
      Array.from({ length: PAST_THE_POOL }, () => checkoutInput(live.id)),
      (input) => createLicenseRequest(input, REQUEST_CTX),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(PAST_THE_POOL);
    expect(await requestsOf(live.id)).toHaveLength(PAST_THE_POOL);
  });

  it(`${PAST_THE_POOL} standards paying at once: all wait for the creator, no cancel, and the pool isn't starved under T2's checks`, async () => {
    const { live } = await offeringVideo();
    const rows = await requestedPastThePool(live.id);
    await withoutStarvingPool(rows, ({ id }) => markAuthorized(id, WEBHOOK));
    expect((await requestsOf(live.id)).map((r) => r.status)).toEqual(
      rows.map(() => "awaiting_approval"),
    );
    expect(cancels()).toEqual([]);
  });
});

describe("the lock itself (07 D110; AD-75)", () => {
  it("holds the video row FOR UPDATE until the transaction ends", async () => {
    const { live } = await offeringVideo();
    const lockIt = {
      text: "select id from video where id = $1 for update",
      values: [live.id],
    };
    const c = await pool.connect();
    try {
      await db.transaction(async (tx) => {
        expect(await lockVideoForLicensing(tx, live.id)).toEqual({
          status: "published",
        });
        await c.query("begin");
        await c.query("set local lock_timeout = '200ms'");
        await expect(c.query(lockIt)).rejects.toMatchObject({
          code: "55P03",
        });
        await c.query("rollback");
      });
      await c.query("begin");
      expect((await c.query(lockIt)).rows).toEqual([{ id: live.id }]);
      await c.query("rollback");
    } finally {
      // Closed, not pooled: after a failure its transaction may still be open.
      c.release(true);
    }
  });

  it("throws for an unknown video", async () => {
    await expect(
      db.transaction((tx) => lockVideoForLicensing(tx, randomUUID())),
    ).rejects.toThrow("unknown video");
  });
});

describe("T2 under the video's lock (07 D110; AD-60)", () => {
  it("waits for the lock before it decides", async () => {
    const { live } = await offeringVideo();
    const { id } = await requested(live.id, EXCLUSIVE);
    let attempt: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      await lockVideoForLicensing(tx, live.id);
      attempt = settled(markAuthorized(id, WEBHOOK));
      await waitForLockWaiter("select %for update");
      expect((await requestRow(id)).status).toBe("checkout_pending");
    });
    expect(await attempt).toBeNull();
    expect((await requestRow(id)).status).toBe("awaiting_approval");
  });

  it("waits for it even when the hold's amount is wrong, so an abandon can't slip past a decision", async () => {
    const { live } = await offeringVideo();
    const { id } = await requested(live.id);
    scripted.script({ getAuthorization: { amountCents: 1 } });
    let attempt: Promise<unknown> = Promise.resolve();
    await db.transaction(async (tx) => {
      await lockVideoForLicensing(tx, live.id);
      attempt = settled(markAuthorized(id, WEBHOOK));
      await waitForLockWaiter("select %for update");
      expect((await requestRow(id)).status).toBe("checkout_pending");
    });
    expect(await attempt).toBeNull();
    expect(await requestRow(id)).toMatchObject({
      status: "abandoned",
      statusReason: "amount_mismatch",
    });
  });

  it(`a lapsed exclusive and a lapsed standard paying at once, ${ROUNDS} rounds: one waits, one is abandoned, one cancel`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const cancelsBefore = cancels().length;
      const { live } = await offeringVideo();
      const standard = await requested(live.id);
      await setHold(standard.id, -1);
      const exclusive = await requested(live.id, EXCLUSIVE);
      await setHold(exclusive.id, -1);
      await Promise.all([
        markAuthorized(exclusive.id, WEBHOOK),
        markAuthorized(standard.id, WEBHOOK),
      ]);
      expectOneWon(await requestsOf(live.id));
      expect(cancels().length - cancelsBefore).toBe(1);
    }
  });

  it(`two lapsed exclusives paying at once, ${ROUNDS} rounds: one waits, one is abandoned, one cancel`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const cancelsBefore = cancels().length;
      const { live } = await offeringVideo();
      const first = await requested(live.id, EXCLUSIVE);
      await setHold(first.id, -1);
      const second = await requested(live.id, EXCLUSIVE);
      await setHold(second.id, -1);
      await Promise.all([
        markAuthorized(first.id, WEBHOOK),
        markAuthorized(second.id, WEBHOOK),
      ]);
      expectOneWon(await requestsOf(live.id));
      expect(cancels().length - cancelsBefore).toBe(1);
    }
  });
});

describe("T2's re-check (07 D110; AD-60)", () => {
  /** The only cancel so far is this request's, after its abandon committed. */
  const expectCanceled = (id: string) =>
    expect(cancels()).toEqual([
      {
        key: `pi-cancel:${id}:video_unavailable:1`,
        reason: "abandoned",
        status: "abandoned",
      },
    ]);

  it("a lapsed exclusive, then a standard, then the exclusive's Pay: abandoned, the standard untouched", async () => {
    const { live } = await offeringVideo();
    const exclusive = await requested(live.id, EXCLUSIVE);
    await setHold(exclusive.id, -1);
    const standard = await requested(live.id);
    await markAuthorized(exclusive.id, WEBHOOK);
    expect(await requestRow(exclusive.id)).toMatchObject({
      status: "abandoned",
      statusReason: "video_unavailable",
    });
    expectCanceled(exclusive.id);
    expect(await requestRow(standard.id)).toEqual(standard);
  });

  it("the mirror: a lapsed standard, then an exclusive, then the standard's Pay", async () => {
    const { live } = await offeringVideo();
    const standard = await requested(live.id);
    await setHold(standard.id, -1);
    const exclusive = await requested(live.id, EXCLUSIVE);
    await markAuthorized(standard.id, WEBHOOK);
    expect(await requestRow(standard.id)).toMatchObject({
      status: "abandoned",
      statusReason: "video_unavailable",
    });
    expectCanceled(standard.id);
    expect(await requestRow(exclusive.id)).toEqual(exclusive);
  });

  it("an exclusive license issued before the Pay abandons it", async () => {
    const { live } = await offeringVideo();
    const { id } = await requested(live.id);
    await runningLicense(live, true);
    await markAuthorized(id, WEBHOOK);
    expect(await requestRow(id)).toMatchObject({
      status: "abandoned",
      statusReason: "video_unavailable",
    });
    expectCanceled(id);
  });

  it("two standards both pay: neither one's running hold nor its waiting row stops the other", async () => {
    const { live } = await offeringVideo();
    const first = await requested(live.id);
    const second = await requested(live.id);
    await authorize(first.id);
    await authorize(second.id);
    expect(cancels()).toEqual([]);
  });

  it("a standard pays beside a running standard license", async () => {
    const { live } = await offeringVideo();
    const { id } = await requested(live.id);
    await runningLicense(live);
    await authorize(id);
    expect(cancels()).toEqual([]);
  });

  it("the normal exclusive Pay waits for the creator, and the video reads reserved", async () => {
    const { live } = await offeringVideo();
    const { id } = await requested(live.id, EXCLUSIVE);
    await markAuthorized(id, WEBHOOK);
    expect((await requestRow(id)).status).toBe("awaiting_approval");
    expect(cancels()).toEqual([]);
    expect(await stateOf(live.id)).toBe("reserved");
  });

  it("two from one buyer: the lapsed one's Pay is abandoned, the other's hold is untouched and it can pay", async () => {
    const { live } = await offeringVideo();
    const buyerEmail = "sam@dailylaughs.com";
    const first = await requested(live.id, { ...EXCLUSIVE, buyerEmail });
    await setHold(first.id, -1);
    const second = await requested(live.id, { ...EXCLUSIVE, buyerEmail });
    await markAuthorized(first.id, WEBHOOK);
    expect(await requestRow(first.id)).toMatchObject({
      status: "abandoned",
      statusReason: "video_unavailable",
    });
    expectCanceled(first.id);
    const untouched = await requestRow(second.id);
    expect(untouched).toEqual(second);
    await markAuthorized(second.id, WEBHOOK);
    expect((await requestRow(second.id)).status).toBe("awaiting_approval");
  });
});

describe("turning the offer off under a request (01 J12.13; AD-58)", () => {
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

  it.each(offs)(
    "%s: its Pay still authorizes, and the video opens to standard requests only once it is stale",
    async (_, turnOff) => {
      const { actor, live } = await offeringVideo();
      const { id } = await requested(live.id, EXCLUSIVE);
      await turnOff(actor, live.id);

      await markAuthorized(id, WEBHOOK);
      expect((await requestRow(id)).status).toBe("awaiting_approval");
      expect(cancels()).toEqual([]);

      await expectRefused(live.id, {}, "video_reserved");
      await expectRefused(live.id, EXCLUSIVE, "exclusive_unavailable");

      await overdue(id);
      expect(await stateOf(live.id)).toBe("open");
      await expectRefused(live.id, EXCLUSIVE, "exclusive_unavailable");
      expect(
        await createLicenseRequest(checkoutInput(live.id), REQUEST_CTX),
      ).toMatchObject({ ok: true });
    },
  );
});

describe("what the grids, the video page and the license page read (AD-65, AD-70, AD-71)", () => {
  const SOONER = "Sooner Studio Inc.";
  const LATER = "Later Media Ltd.";

  /** An exclusive license to `licenseeName`, ending at `endsAt`. */
  async function exclusiveLicense(
    live: Pick<Video, "id" | "creatorId">,
    licenseeName: string,
    endsAt: Date,
  ) {
    return insertLicense(
      await insertLicenseRequest(live, {
        status: "approved",
        exclusive: true,
        exclusiveMultiplierBps: 30000,
        licenseeName,
      }),
      { exclusive: true, endsAt },
    );
  }

  /**
   * A fresh offering video with two exclusive licenses, the later one to LATER, inserted second so only the sort can pick
   * it: its availability and its dates.
   */
  async function twoExclusiveLicenses() {
    const owner = await offeringVideo();
    const later = new Date(Date.now() + 395 * DAY_MS);
    await exclusiveLicense(
      owner.live,
      SOONER,
      new Date(Date.now() + 30 * DAY_MS),
    );
    await exclusiveLicense(owner.live, LATER, later);
    return {
      ...owner,
      display: { state: "exclusive_active", until: later.toISOString() },
    };
  }

  it("the creator's card and page name the licensee who ends last, with that end", async () => {
    const { actor, live, display } = await twoExclusiveLicenses();
    const named = { ...display, licenseeName: LATER };
    const { videos } = await listCreatorVideos(actor);
    expect(videos.find((v) => v.id === live.id)?.availability).toEqual(named);
    expect(await getVideoAvailability(actor, live.id)).toEqual({
      ...named,
      perpetualRunning: false,
    });
  });

  it("the public grid has the same state and end, and no name, no plan id, no email anywhere in its JSON", async () => {
    const { actor, creator, live, display } = await twoExclusiveLicenses();
    const cards = await listPublicVideos(creator.id);
    expect(cards.find((v) => v.id === live.id)?.availability).toEqual(display);
    const grid = JSON.stringify(cards);
    for (const secret of [LATER, SOONER, "reservationPlanId", "buyer-"]) {
      expect(grid).not.toContain(secret);
    }
    expect(JSON.stringify(await listCreatorVideos(actor))).toContain(LATER);
    expect(JSON.stringify(await listCreatorVideos(actor))).not.toContain(
      "buyer-",
    );
  });

  /** How many statements `read` sends through the pool. */
  async function statementsOf(read: () => Promise<unknown>) {
    const query = vi.spyOn(pool, "query");
    await read();
    const sent = query.mock.calls.length;
    query.mockRestore();
    return sent;
  }

  it("each card reads its own video's state, in one read for the page's ids", async () => {
    const { actor, creator, live } = await offeringVideo();
    const statements = async () => ({
      publicGrid: await statementsOf(() => listPublicVideos(creator.id)),
      creatorGrid: await statementsOf(() => listCreatorVideos(actor)),
    });
    const forOneVideo = await statements();
    expect(forOneVideo.publicGrid).toBeGreaterThan(0);
    expect(forOneVideo.creatorGrid).toBeGreaterThan(0);

    const waiting = await approvableVideo(creator.id);
    await waitingRequest(waiting, {
      exclusive: true,
      exclusiveMultiplierBps: 30000,
    });
    const standard = await approvableVideo(creator.id);
    await runningLicense(standard);
    // The waiting request's emails go through the same pool: they end before the count starts.
    await flushAfter();
    expect(await statements()).toEqual(forOneVideo);

    const want = {
      [live.id]: { state: "open", until: null },
      [waiting.id]: { state: "reserved", until: null },
      [standard.id]: { state: "non_exclusive_only", until: null },
    };
    expect(
      Object.fromEntries(
        (await listPublicVideos(creator.id)).map((v) => [v.id, v.availability]),
      ),
    ).toEqual(want);
    const { videos } = await listCreatorVideos(actor);
    expect(
      Object.fromEntries(videos.map((v) => [v.id, v.availability])),
    ).toEqual(
      Object.fromEntries(
        Object.entries(want).map(([id, display]) => [
          id,
          { ...display, licenseeName: null },
        ]),
      ),
    );
  });

  it("the video page reads a running perpetual license as non_exclusive_only, until it is revoked", async () => {
    const { actor, live } = await offeringVideo();
    const issued = await insertLicense(
      await insertLicenseRequest(live, {
        status: "approved",
        termKey: "perpetual",
      }),
      { endsAt: null },
    );
    expect(await getVideoAvailability(actor, live.id)).toEqual({
      state: "non_exclusive_only",
      until: null,
      licenseeName: null,
      perpetualRunning: true,
    });
    await db
      .update(license)
      .set({ revokedAt: new Date(), revokedReason: "issued_in_error" })
      .where(eq(license.id, issued.id));
    expect(await getVideoAvailability(actor, live.id)).toEqual({
      state: "open",
      until: null,
      licenseeName: null,
      perpetualRunning: false,
    });
  });

  it("the video page has nothing for another creator's video, an unknown id or a malformed one", async () => {
    const { live } = await offeringVideo();
    const other = await offeringVideo();
    for (const id of [live.id, randomUUID(), "not-a-uuid"]) {
      expect(await getVideoAvailability(other.actor, id)).toBeNull();
    }
  });

  it("no licensee reads once the exclusive license is revoked or has ended", async () => {
    const { actor, live } = await offeringVideo();
    const issued = await exclusiveLicense(
      live,
      LATER,
      new Date(Date.now() + 30 * DAY_MS),
    );
    await db
      .update(license)
      .set({ revokedAt: new Date(), revokedReason: "issued_in_error" })
      .where(eq(license.id, issued.id));
    const open = { state: "open", until: null, licenseeName: null };
    expect(await getVideoAvailability(actor, live.id)).toEqual({
      ...open,
      perpetualRunning: false,
    });

    const ended = await offeringVideo();
    const now = Date.now();
    await runningLicense(ended.live, true, {
      startsAt: new Date(now - 40 * DAY_MS),
      endsAt: new Date(now - 10 * DAY_MS),
    });
    expect(
      (await listCreatorVideos(ended.actor)).videos.find(
        (v) => v.id === ended.live.id,
      )?.availability,
    ).toEqual(open);
  });

  it("the license page reads reserved and exclusive_active with an ISO end, and no plan id", async () => {
    const waiting = await offeringVideo();
    await waitingRequest(waiting.live, {
      exclusive: true,
      exclusiveMultiplierBps: 30000,
    });
    const reserved = await readLicensePageData(
      waiting.creator.handle,
      waiting.live.slug,
    );
    expect(reserved?.availability).toEqual({
      state: "reserved",
      until: null,
      canRequestExclusive: false,
      canRequestNonExclusive: false,
    });

    const { creator, live, display } = await twoExclusiveLicenses();
    const licensed = await readLicensePageData(creator.handle, live.slug);
    expect(licensed?.availability).toEqual({
      ...display,
      canRequestExclusive: false,
      canRequestNonExclusive: false,
    });
    expect(JSON.stringify(licensed)).not.toContain("reservationPlanId");
    expect(JSON.stringify(licensed)).not.toContain(LATER);
  });
});
