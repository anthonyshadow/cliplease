import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeCheckoutExtend,
  fakeCheckoutPay,
} from "../../src/app/dev/fake-checkout/[requestId]/actions";
import { POST as postRelease } from "../../src/app/dev/fake-checkout/[requestId]/release/route";
import { db, pool } from "../../src/db/client";
import { licenseRequest, video } from "../../src/db/schema";
import type {
  LicenseRequest,
  NewLicenseRequest,
} from "../../src/db/schema/types";
import type { ExtendHoldResult } from "../../src/lib/licensing/checkout-hold";
import { MINUTE_MS } from "../../src/lib/time";
import { WEBHOOK } from "../../src/server/auth/actor";
import { env } from "../../src/server/env";
import {
  getLicenseAvailability,
  lockVideoForLicensing,
} from "../../src/server/licensing/availability";
import {
  extendCheckoutHold,
  releaseCheckoutHold,
} from "../../src/server/licensing/checkout-hold";
import { getBuyerRequest } from "../../src/server/licensing/request-status";
import {
  createLicenseRequest,
  markAuthorized,
} from "../../src/server/licensing/requests";
import { applyTransition } from "../../src/server/licensing/state-machine";
import { openFakeCheckout } from "../../src/server/payments/fake-checkout";
import { NOT_FOUND, redirectTo } from "../helpers/actions";
import {
  pendingCheckoutRequest,
  waitingRequest,
} from "../helpers/approval-fixtures";
import { auditsOf } from "../helpers/connect-flow";
import { PG_ERROR, waitForLockWaiter } from "../helpers/db";
import {
  insertCreator,
  insertLicenseRequest,
  insertUploadVideo,
  requestRow,
} from "../helpers/factories";
import { AFTER_FAILED, captureLogEvents, recordStderr } from "../helpers/logs";
import {
  checkoutInput,
  EXCLUSIVE,
  offeringVideo,
  PAST_THE_POOL,
  REQUEST_CTX,
  requested,
  requestedPastThePool,
  setHold,
  withoutStarvingPool,
} from "../helpers/request-flow";
import {
  cancels,
  finishScriptedTest,
  installScriptedPayments,
} from "../helpers/scripted-suite";

// The unpaid hold (P19f; owner answers Q-170, Q-175; AD-74) against the test database: its migration, T1's two times,
// extending it (its value, every refusal and their order, the video's lock against T1, T2 and another extend), releasing
// it (that row only), what a lapsed or released row can still do, /r's cancel, and the fake checkout's page, action and
// route. The payments driver is the scripted double.

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

beforeEach(() => {
  installScriptedPayments();
  recordStderr(AFTER_FAILED);
});
afterEach(finishScriptedTest);

const MIGRATION = readFileSync("drizzle/0003_checkout_hold.sql", "utf8");

const ROUNDS = 10;

/** A fresh video's exclusive request in checkout, its hold `seconds` from now. */
async function holdingRequest(seconds: number) {
  const { live } = await offeringVideo();
  const row = await requested(live.id, EXCLUSIVE);
  await setHold(row.id, seconds);
  return { live, id: row.id, row: await requestRow(row.id) };
}

/** Puts the request's session `seconds` from now, on the database's clock. */
async function setSession(id: string, seconds: number) {
  await db
    .update(licenseRequest)
    .set({
      checkoutExpiresAt: sql`now() + make_interval(secs => ${seconds}::double precision)`,
    })
    .where(eq(licenseRequest.id, id));
}

/** Ends the request's session where its hold ends: as far as Extend can reach. */
async function capSession(id: string) {
  await db
    .update(licenseRequest)
    .set({ checkoutExpiresAt: sql`${licenseRequest.checkoutHoldUntil}` })
    .where(eq(licenseRequest.id, id));
}

async function unpublish(videoId: string) {
  await db
    .update(video)
    .set({ status: "unpublished" })
    .where(eq(video.id, videoId));
}

const extendedAudits = (id: string) =>
  auditsOf(id, "license_request.hold_extended");
const releasedAudits = (id: string) =>
  auditsOf(id, "license_request.hold_released");

/**
 * Extend `ms` from now. The other side reads a few rows before it reaches the lock, so Extend started at once always wins:
 * a race's rounds sweep the delay, to reach the lock on both sides of it.
 */
const extendAfter = async (ms: number, id: string) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return extendCheckoutHold(id);
};

/** Extend's answer, which must be ok. */
async function extended(id: string) {
  const result = await extendCheckoutHold(id);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result;
}

/** Extend refuses `id` for `reason`: the row is as it was, and nothing is audited. */
async function expectRefused(
  id: string,
  reason: Extract<ExtendHoldResult, { ok: false }>["reason"],
) {
  const before = await requestRow(id);
  expect(await extendCheckoutHold(id)).toMatchObject({ ok: false, reason });
  expect(await requestRow(id)).toEqual(before);
  expect(await extendedAudits(id)).toEqual([]);
}

/** The row's times as a refusal or an ok carries them, its `now` left to the caller. */
const timesOf = (row: LicenseRequest) => ({
  holdUntil: row.checkoutHoldUntil.toISOString(),
  sessionEndsAt: row.checkoutExpiresAt.toISOString(),
});

describe("0003_checkout_hold", () => {
  it("applies to a table that already has rows", async () => {
    const creator = await insertCreator();
    const row = await insertLicenseRequest(await insertUploadVideo(creator));
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "alter table license_request drop column checkout_hold_until",
      );
      for (const statement of MIGRATION.split("--> statement-breakpoint")) {
        await client.query(statement);
      }
      const { rows } = await client.query<{ same: boolean }>(
        "select checkout_hold_until = checkout_expires_at as same from license_request where id = $1",
        [row.id],
      );
      expect(rows).toEqual([{ same: true }]);
      await expect(
        client.query(
          "update license_request set checkout_hold_until = null where id = $1",
          [row.id],
        ),
      ).rejects.toMatchObject({ code: PG_ERROR.notNull });
      await client.query("rollback");
    } finally {
      // Closed, not pooled: after a failure its transaction may still be open.
      client.release(true);
    }
  });

  it("adds no CHECK and no index", () => {
    expect(MIGRATION).not.toMatch(/\b(check|index)\b/i);
  });
});

describe("T1's two times (owner answer Q-170)", () => {
  it("holds for 10 minutes inside a session of 60", async () => {
    const { live } = await offeringVideo();
    const row = await requested(live.id);
    expect(row.checkoutHoldUntil.getTime() - row.createdAt.getTime()).toBe(
      10 * MINUTE_MS,
    );
    expect(row.checkoutExpiresAt.getTime() - row.createdAt.getTime()).toBe(
      60 * MINUTE_MS,
    );
  });
});

describe("extendCheckoutHold's value", () => {
  it("adds 10 minutes to a hold with 30 s left, audited once as the buyer; its times are the row's", async () => {
    const { id, row } = await holdingRequest(30);
    const result = await extended(id);
    const after = await requestRow(id);
    expect(after.checkoutHoldUntil.getTime()).toBe(
      row.checkoutHoldUntil.getTime() + 10 * MINUTE_MS,
    );
    expect(after.checkoutExpiresAt).toEqual(row.checkoutExpiresAt);
    expect(after.status).toBe("checkout_pending");
    expect(result).toMatchObject(timesOf(after));
    expect(new Date(result.now).toISOString()).toBe(result.now);
    expect(await extendedAudits(id)).toEqual([
      { data: { holdUntil: result.holdUntil }, actorType: "buyer" },
    ]);
  });

  it("gives 10 minutes from now to a hold that lapsed 2 minutes ago", async () => {
    const { id } = await holdingRequest(-120);
    const result = await extended(id);
    const left = Date.parse(result.holdUntil) - Date.parse(result.now);
    expect(left).toBeLessThanOrEqual(10 * MINUTE_MS);
    expect(left).toBeGreaterThan(10 * MINUTE_MS - 5_000);
    expect(await requestRow(id)).toMatchObject({
      status: "checkout_pending",
      checkoutHoldUntil: new Date(result.holdUntil),
    });
  });

  it("stops at the session's end", async () => {
    const { id } = await holdingRequest(30);
    await setSession(id, 300);
    const result = await extended(id);
    const after = await requestRow(id);
    expect(after.checkoutHoldUntil).toEqual(after.checkoutExpiresAt);
    expect(result.holdUntil).toBe(result.sessionEndsAt);
  });
});

describe("extendCheckoutHold's refusals", () => {
  it("not_pending: a paid row, an abandoned row, an unknown id", async () => {
    const paid = await offeringVideo();
    const { row: waiting } = await waitingRequest(paid.live);
    await expectRefused(waiting.id, "not_pending");

    const ended = await offeringVideo();
    const abandoned = await insertLicenseRequest(ended.live, {
      status: "abandoned",
      statusReason: "checkout_expired",
    });
    await expectRefused(abandoned.id, "not_pending");

    expect(await extendCheckoutHold(randomUUID())).toEqual({
      ok: false,
      reason: "not_pending",
    });
  });

  it("session_ended: the session and the hold both past", async () => {
    const { id } = await holdingRequest(-120);
    await setSession(id, -60);
    await expectRefused(id, "session_ended");
    expect(await extendCheckoutHold(id)).toEqual({
      ok: false,
      reason: "session_ended",
    });
  });

  it("too_early with 70 s left, with the current times; 63 s is allowed (the client's rounding)", async () => {
    const early = await holdingRequest(70);
    await expectRefused(early.id, "too_early");
    const refused = await extendCheckoutHold(early.id);
    expect(refused).toMatchObject({
      ok: false,
      reason: "too_early",
      ...timesOf(early.row),
    });

    const close = await holdingRequest(63);
    expect((await extendCheckoutHold(close.id)).ok).toBe(true);
  });

  it("at_limit: the hold already at the session's end, with its times", async () => {
    const { id } = await holdingRequest(30);
    await capSession(id);
    const row = await requestRow(id);
    await expectRefused(id, "at_limit");
    expect(await extendCheckoutHold(id)).toMatchObject({
      ok: false,
      reason: "at_limit",
      ...timesOf(row),
    });
  });

  it("video_unavailable: the video was unpublished", async () => {
    const { live, id } = await holdingRequest(30);
    await unpublish(live.id);
    await expectRefused(id, "video_unavailable");
  });

  it("taken, both ways: a lapsed exclusive after a new standard, a lapsed standard after a new exclusive", async () => {
    const exclusive = await holdingRequest(-1);
    await requested(exclusive.live.id);
    await expectRefused(exclusive.id, "taken");

    const { live } = await offeringVideo();
    const standard = await requested(live.id);
    await setHold(standard.id, -1);
    await requested(live.id, EXCLUSIVE);
    await expectRefused(standard.id, "taken");
  });
});

// The buyer sees a different thing for each, so each must win over every reason after it, with all of them true at once.
describe("extendCheckoutHold's refusal order", () => {
  /** An exclusive request with its hold `seconds` from now, on an unpublished video a new standard request has taken. */
  async function takenAndUnpublished(seconds: number) {
    const { live, id } = await holdingRequest(-1);
    await requested(live.id);
    await setHold(id, seconds);
    await unpublish(live.id);
    return id;
  }

  it("not_pending first: a paid row, past its session, on an unpublished video", async () => {
    const { live } = await offeringVideo();
    const { row } = await waitingRequest(live);
    await setSession(row.id, -60);
    await unpublish(live.id);
    await expectRefused(row.id, "not_pending");
  });

  it.each([
    ["session_ended", -120],
    ["too_early", 300],
    ["at_limit", 30],
  ] as const)(
    "%s before what follows: a hold %i s from now, at its session's end, on an unpublished video that was taken",
    async (reason, seconds) => {
      const id = await takenAndUnpublished(seconds);
      await capSession(id);
      await expectRefused(id, reason);
    },
  );

  it("video_unavailable before taken: a lapsed hold on an unpublished video that was taken", async () => {
    await expectRefused(await takenAndUnpublished(-1), "video_unavailable");
  });
});

describe("extending after the hold is over (owner answer Q-170)", () => {
  it("works after a lapse while the video is free", async () => {
    const { live, id } = await holdingRequest(-30);
    expect((await getLicenseAvailability(db, live.id)).state).toBe("open");
    await extended(id);
    expect((await getLicenseAvailability(db, live.id)).state).toBe("reserved");
  });

  it("works after a release", async () => {
    const { live, id } = await holdingRequest(600);
    await releaseCheckoutHold(id, "page_closed");
    expect((await getLicenseAvailability(db, live.id)).state).toBe("open");
    await extended(id);
    expect((await getLicenseAvailability(db, live.id)).state).toBe("reserved");
  });

  it("works for a standard beside another standard's running hold: standards don't block each other", async () => {
    const { live } = await offeringVideo();
    const lapsed = await requested(live.id);
    await setHold(lapsed.id, -1);
    await requested(live.id);
    await extended(lapsed.id);
  });

  it("is at_limit once it has reached the session's end", async () => {
    const { id } = await holdingRequest(30);
    await setSession(id, 40);
    const capped = await extended(id);
    expect(capped.holdUntil).toBe(capped.sessionEndsAt);
    expect(await extendCheckoutHold(id)).toMatchObject({
      ok: false,
      reason: "at_limit",
      holdUntil: capped.holdUntil,
    });
    expect(await extendedAudits(id)).toHaveLength(1);
  });
});

describe("extending under the video's lock (07 D110)", () => {
  it("two extends at once with 30 s left: one ok, one too_early, the hold moved once", async () => {
    const { id, row } = await holdingRequest(30);
    const results = await Promise.all([
      extendCheckoutHold(id),
      extendCheckoutHold(id),
    ]);
    const after = await requestRow(id);
    expect(after.checkoutHoldUntil.getTime()).toBe(
      row.checkoutHoldUntil.getTime() + 10 * MINUTE_MS,
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ ok: false, reason: "too_early" }),
    ]);
    expect(await extendedAudits(id)).toHaveLength(1);
  });

  it("waits for the lock before it writes", async () => {
    const { live, id, row } = await holdingRequest(30);
    let attempt: Promise<ExtendHoldResult> | undefined;
    await db.transaction(async (tx) => {
      await lockVideoForLicensing(tx, live.id);
      attempt = extendCheckoutHold(id);
      await waitForLockWaiter("select %for update");
      expect(await requestRow(id)).toEqual(row);
    });
    expect((await attempt)?.ok).toBe(true);
  });

  it.each([
    ["a refusal", 70, { ok: false, reason: "too_early" }],
    ["an ok", 30, { ok: true }],
  ] as const)(
    "%s after a wait for the lock carries the time it answered, not the time it started",
    async (_, seconds, expected) => {
      const { live, id } = await holdingRequest(seconds);
      let attempt: Promise<ExtendHoldResult> | undefined;
      let beforeCommit = Number.POSITIVE_INFINITY;
      await db.transaction(async (tx) => {
        await lockVideoForLicensing(tx, live.id);
        attempt = extendCheckoutHold(id);
        await waitForLockWaiter("select %for update");
        const { rows } = await tx.execute<{ ms: string }>(
          sql`select floor(extract(epoch from clock_timestamp()) * 1000)::text as ms`,
        );
        beforeCommit = Number(rows[0]?.ms);
      });
      const answer = await attempt;
      expect(answer).toMatchObject(expected);
      if (!answer || !("now" in answer)) throw new Error("no times");
      // To the millisecond: now() would read before the holder's clock by the whole wait.
      expect(Date.parse(answer.now)).toBeGreaterThanOrEqual(beforeCommit);
    },
  );

  it("a row that ends while its write waits on it answers not_pending, unmoved, and audits nothing", async () => {
    const { id, row } = await holdingRequest(30);
    let attempt: Promise<ExtendHoldResult> | undefined;
    await db.transaction(async (tx) => {
      // An expired session takes the request's row alone, never the video's: Extend passes its checks and waits to write.
      await applyTransition(
        tx,
        id,
        "checkout_expired",
        { abandonedAt: new Date(), statusReason: "checkout_expired" },
        WEBHOOK,
      );
      attempt = extendCheckoutHold(id);
      await waitForLockWaiter("update %");
    });
    expect(await attempt).toEqual({ ok: false, reason: "not_pending" });
    expect(await requestRow(id)).toMatchObject({
      status: "abandoned",
      checkoutHoldUntil: row.checkoutHoldUntil,
    });
    expect(await extendedAudits(id)).toEqual([]);
  });

  it(`${PAST_THE_POOL} lapsed standards extending at once: all ok, and the pool isn't starved`, async () => {
    const { live } = await offeringVideo();
    const rows = await requestedPastThePool(live.id);
    for (const { id } of rows) await setHold(id, -1);
    const results = await withoutStarvingPool(rows, ({ id }) =>
      extendCheckoutHold(id),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(PAST_THE_POOL);
  });

  it(`against a new request, ${ROUNDS} rounds: the extend holds and T1 is refused, or T1 wins and the extend is taken`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { live, id } = await holdingRequest(-1);
      const [extend, created] = await Promise.all([
        extendAfter(round, id),
        createLicenseRequest(checkoutInput(live.id, EXCLUSIVE), REQUEST_CTX),
      ]);
      if (extend.ok) {
        expect(created).toEqual({ ok: false, reason: "video_reserved" });
      } else {
        expect(extend).toEqual({ ok: false, reason: "taken" });
        expect(created.ok).toBe(true);
      }
    }
  });

  it(`against another request's Pay, ${ROUNDS} rounds: the extend holds and the Pay is abandoned, or the Pay wins and the extend is taken`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const cancelsBefore = cancels().length;
      const { live, id: extending } = await holdingRequest(-1);
      const paying = await requested(live.id, EXCLUSIVE);
      await setHold(paying.id, -1);
      const [extend] = await Promise.all([
        extendAfter(round, extending),
        markAuthorized(paying.id, WEBHOOK),
      ]);
      const paid = await requestRow(paying.id);
      if (extend.ok) {
        expect(paid).toMatchObject({
          status: "abandoned",
          statusReason: "video_unavailable",
        });
        expect(cancels().length - cancelsBefore).toBe(1);
      } else {
        expect(extend).toEqual({ ok: false, reason: "taken" });
        expect(paid.status).toBe("awaiting_approval");
        expect(cancels().length - cancelsBefore).toBe(0);
      }
    }
  });
});

describe("releaseCheckoutHold (owner answer Q-175)", () => {
  it("lets go of that row only, audited once, and a second call changes nothing", async () => {
    const { live } = await offeringVideo();
    const mine = await requested(live.id);
    const other = await requested(live.id);

    await releaseCheckoutHold(mine.id, "page_closed");
    const released = await requestRow(mine.id);
    expect(released.checkoutHoldUntil.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    expect(released.status).toBe("checkout_pending");
    expect(released.checkoutExpiresAt).toEqual(mine.checkoutExpiresAt);
    expect(await requestRow(other.id)).toEqual(other);
    expect(await releasedAudits(mine.id)).toEqual([
      { data: { via: "page_closed" }, actorType: "buyer" },
    ]);
    expect(await releasedAudits(other.id)).toEqual([]);

    await releaseCheckoutHold(mine.id, "canceled");
    expect(await requestRow(mine.id)).toEqual(released);
    expect(await releasedAudits(mine.id)).toHaveLength(1);
  });

  it("changes nothing on a paid row or one already lapsed", async () => {
    const paid = await offeringVideo();
    const { row: waiting } = await waitingRequest(paid.live);
    await releaseCheckoutHold(waiting.id, "page_closed");
    expect(await requestRow(waiting.id)).toEqual(waiting);
    expect(await releasedAudits(waiting.id)).toEqual([]);

    const { id, row } = await holdingRequest(-1);
    await releaseCheckoutHold(id, "page_closed");
    expect(await requestRow(id)).toEqual(row);
    expect(await releasedAudits(id)).toEqual([]);
  });
});

describe("a hold that is over holds nothing, and can still be paid (owner answer Q-170)", () => {
  it("a lapsed row: the video is open, a new exclusive is taken", async () => {
    const { live } = await holdingRequest(-1);
    expect((await getLicenseAvailability(db, live.id)).state).toBe("open");
    await requested(live.id, EXCLUSIVE);
  });

  it("a released row likewise, at once", async () => {
    const { live, id } = await holdingRequest(600);
    await releaseCheckoutHold(id, "canceled");
    expect((await getLicenseAvailability(db, live.id)).state).toBe("open");
    await requested(live.id, EXCLUSIVE);
  });

  it("a lapsed row whose video is free can be paid", async () => {
    const { id } = await holdingRequest(-1);
    await markAuthorized(id, WEBHOOK);
    expect((await requestRow(id)).status).toBe("awaiting_approval");
    expect(cancels()).toEqual([]);
  });

  it("a lapsed row whose video was taken is abandoned, one cancel", async () => {
    const { live, id } = await holdingRequest(-1);
    await requested(live.id, EXCLUSIVE);
    await markAuthorized(id, WEBHOOK);
    expect(await requestRow(id)).toMatchObject({
      status: "abandoned",
      statusReason: "video_unavailable",
    });
    expect(cancels()).toEqual([
      {
        key: `pi-cancel:${id}:video_unavailable:1`,
        reason: "abandoned",
        status: "abandoned",
      },
    ]);
  });

  it("a resubmit of a lapsed row returns its stored Checkout", async () => {
    const { live } = await offeringVideo();
    const once = checkoutInput(live.id, EXCLUSIVE);
    const first = await createLicenseRequest(once, REQUEST_CTX);
    if (!first.ok) throw new Error(`refused: ${first.reason}`);
    const [row] = await db
      .select({ id: licenseRequest.id })
      .from(licenseRequest)
      .where(eq(licenseRequest.videoId, live.id));
    await setHold(row?.id ?? "", -1);
    expect(await createLicenseRequest(once, REQUEST_CTX)).toEqual(first);
  });
});

describe("/r canceled (owner answer Q-175)", () => {
  /** A request in checkout with a real key. */
  async function paying() {
    const { live } = await offeringVideo();
    return pendingCheckoutRequest(live);
  }

  it("releases with the request's own key, as canceled", async () => {
    const { row, token } = await paying();
    const status = await getBuyerRequest(row.id, token, undefined, true);
    expect(status).toMatchObject({ id: row.id, status: "checkout_pending" });
    expect(await releasedAudits(row.id)).toEqual([
      { data: { via: "canceled" }, actorType: "buyer" },
    ]);
    expect((await requestRow(row.id)).checkoutHoldUntil.getTime()).toBeLessThan(
      row.checkoutHoldUntil.getTime(),
    );
  });

  it("changes nothing with a wrong key, and answers null", async () => {
    const { row } = await paying();
    expect(
      await getBuyerRequest(row.id, "A".repeat(43), undefined, true),
    ).toBeNull();
    expect(await requestRow(row.id)).toEqual(row);
    expect(await releasedAudits(row.id)).toEqual([]);
  });

  it("changes nothing without the marker", async () => {
    const { row, token } = await paying();
    await getBuyerRequest(row.id, token);
    await getBuyerRequest(row.id, token, undefined, false);
    expect(await requestRow(row.id)).toEqual(row);
    expect(await releasedAudits(row.id)).toEqual([]);
  });

  it("still answers when the release throws, and logs it", async () => {
    const { row, token } = await paying();
    vi.spyOn(db, "transaction").mockRejectedValueOnce(
      new Error("database down"),
    );
    const logs = captureLogEvents("license_request.hold_release_failed");
    const status = await getBuyerRequest(row.id, token, undefined, true);
    const { events } = logs();
    expect(status).toMatchObject({ id: row.id, status: "checkout_pending" });
    expect(events).toEqual([
      expect.objectContaining({ level: "warn", requestId: row.id }),
    ]);
    expect(await requestRow(row.id)).toEqual(row);
  });
});

describe("the fake checkout (owner answers Q-118 a, Q-175; AD-73)", () => {
  /** A fresh video's request in checkout, with a real key sealed on the row. */
  async function paying(overrides: Partial<NewLicenseRequest> = {}) {
    const owner = await offeringVideo();
    const paid = await pendingCheckoutRequest(owner.live, overrides);
    return { ...owner, ...paid };
  }

  /** The database's clock, read as openFakeCheckout reads it. */
  async function databaseNow(id: string): Promise<number> {
    const [row] = await db
      .select({
        now: sql<Date>`now()`.mapWith(licenseRequest.checkoutExpiresAt),
      })
      .from(licenseRequest)
      .where(eq(licenseRequest.id, id));
    if (!row) throw new Error("databaseNow: unknown request");
    return row.now.getTime();
  }

  /** The route, as the page's beacon calls it. */
  const release = (requestId: string) =>
    postRelease(
      new Request(`http://localhost/dev/fake-checkout/${requestId}/release`, {
        method: "POST",
      }),
      { params: Promise.resolve({ requestId }) },
    );

  /** Runs `check` with the fake checkout's guard off. */
  async function withGuardOff(check: () => Promise<void>) {
    const before = env.APP_ENV;
    env.APP_ENV = "preview";
    try {
      await check();
    } finally {
      env.APP_ENV = before;
    }
  }

  describe("openFakeCheckout", () => {
    it("gives the page the hold's times on the database's clock, and the way back to the license page", async () => {
      const { live, row } = await paying();
      const before = await databaseNow(row.id);
      // The app's clock far from the database's: only the database's can fall between the two reads.
      vi.useFakeTimers({
        now: Date.parse("2031-03-04T05:06:07.000Z"),
        toFake: ["Date"],
      });
      const checkout = await openFakeCheckout(row.id).finally(() =>
        vi.useRealTimers(),
      );
      const after = await databaseNow(row.id);
      expect(checkout).toMatchObject({
        exclusive: false,
        holdUntil: row.checkoutHoldUntil,
        sessionEndsAt: row.checkoutExpiresAt,
      });
      expect(checkout?.now.getTime()).toBeGreaterThanOrEqual(before);
      expect(checkout?.now.getTime()).toBeLessThanOrEqual(after);
      expect(checkout?.licensePath).toMatch(
        new RegExp(`^/@[^/]+/${live.slug}$`),
      );
    });

    it("labels an exclusive request's line item with the rule of 07 D113", async () => {
      const { live, row } = await paying({ exclusive: true });
      const checkout = await openFakeCheckout(row.id);
      expect(checkout?.exclusive).toBe(true);
      expect(checkout?.label).toBe(
        `Exclusive license · ${live.title} · ${checkout?.scope}`,
      );
    });
  });

  describe("fakeCheckoutPay", () => {
    it("doesn't read the hold: a lapsed row is paid, and T2 decides", async () => {
      const { row, token } = await paying();
      await setHold(row.id, -1);
      await expect(fakeCheckoutPay(row.id)).rejects.toMatchObject(
        redirectTo(`/r/${row.id}?t=${token}&session_id=cs_fake_${row.id}`),
      );
      expect((await requestRow(row.id)).status).toBe("awaiting_approval");
      expect(cancels()).toEqual([]);
    });
  });

  describe("fakeCheckoutExtend", () => {
    it("extends a lapsed row, and answers with the row's times", async () => {
      const { row } = await paying();
      await setHold(row.id, -1);
      const answer = await fakeCheckoutExtend(row.id);
      const after = await requestRow(row.id);
      expect(answer).toEqual({
        ok: true,
        data: { ok: true, ...timesOf(after), now: expect.any(String) },
      });
      expect(after.checkoutHoldUntil.getTime()).toBeGreaterThan(Date.now());
      expect(await extendedAudits(row.id)).toHaveLength(1);
    });

    it("carries a refusal in its data", async () => {
      const { row } = await paying();
      expect(await fakeCheckoutExtend(row.id)).toMatchObject({
        ok: true,
        data: { ok: false, reason: "too_early" },
      });
    });

    it("is not found for an unknown id", async () => {
      await expect(fakeCheckoutExtend(randomUUID())).rejects.toMatchObject(
        NOT_FOUND,
      );
    });

    it("is not found with the guard off, and changes nothing", async () => {
      const { row } = await paying();
      await setHold(row.id, -1);
      const before = await requestRow(row.id);
      await withGuardOff(async () => {
        await expect(fakeCheckoutExtend(row.id)).rejects.toMatchObject(
          NOT_FOUND,
        );
      });
      expect(await requestRow(row.id)).toEqual(before);
      expect(await extendedAudits(row.id)).toEqual([]);
    });
  });

  describe("POST release", () => {
    it("answers 204 and lets go of the hold as page_closed; again changes nothing", async () => {
      const { live, row } = await paying({ exclusive: true });
      expect((await getLicenseAvailability(db, live.id)).state).toBe(
        "reserved",
      );
      const first = await release(row.id);
      expect(first.status).toBe(204);
      const released = await requestRow(row.id);
      expect(released.status).toBe("checkout_pending");
      expect(released.checkoutHoldUntil.getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
      expect((await getLicenseAvailability(db, live.id)).state).toBe("open");
      expect(await releasedAudits(row.id)).toEqual([
        { data: { via: "page_closed" }, actorType: "buyer" },
      ]);

      expect((await release(row.id)).status).toBe(204);
      expect(await requestRow(row.id)).toEqual(released);
      expect(await releasedAudits(row.id)).toHaveLength(1);
    });

    it("answers 404 for an unknown or malformed id", async () => {
      expect((await release(randomUUID())).status).toBe(404);
      expect((await release("not-a-uuid")).status).toBe(404);
    });

    it("answers 404 with the guard off, and changes nothing", async () => {
      const { row } = await paying();
      await withGuardOff(async () => {
        expect((await release(row.id)).status).toBe(404);
      });
      expect(await requestRow(row.id)).toEqual(row);
      expect(await releasedAudits(row.id)).toEqual([]);
    });
  });
});
