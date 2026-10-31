import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCheckoutPay } from "../../src/app/dev/fake-checkout/[requestId]/actions";
import { db } from "../../src/db/client";
import { emailLog, licenseRequest, user } from "../../src/db/schema";
import type { CreatorProfile, LicenseRequest } from "../../src/db/schema/types";
import { formatEmailDateTime } from "../../src/lib/format";
import { REQUEST_STATUS_COPY } from "../../src/lib/licensing/request-status";
import { HOUR_MS } from "../../src/lib/time";
import { WEBHOOK } from "../../src/server/auth/actor";
import {
  queueEmail,
  recipientHash,
  retryEmailOutbox,
  sendQueuedEmails,
} from "../../src/server/email/send";
import type { EmailDriver } from "../../src/server/email/types";
import { env } from "../../src/server/env";
import { applyTransition } from "../../src/server/licensing/state-machine";
import { findRequestForBuyer } from "../../src/server/tokens/buyer-token";
import { redirectTo } from "../helpers/actions";
import { flushAfter } from "../helpers/after";
import {
  approvableVideo,
  authorizeRequest,
  pendingCheckoutRequest,
} from "../helpers/approval-fixtures";
import { insertCreator } from "../helpers/factories";
import {
  AFTER_FAILED,
  captureLogEvents,
  dropStderr,
  endStderr,
  recordStderr,
} from "../helpers/logs";
import { readLatestEmail } from "../helpers/read-latest-email";

// The email outbox (P17; 02 §5.10; 03 §3.8, I21; 07 D34, D47, D84): the authorized transition queues request-new and
// request-received in its own transaction, they are sent after the response (after() runs at once here), and the
// retry picks up what is left. P19: the declined transition queues request-declined to the buyer the same way; no
// other ending of a waiting request emails anyone in CORE. P19c: an auto-approve request's authorization queues
// request-received only. The console driver writes .data/emails; a test can make it fail.

const driver = vi.hoisted(() => ({
  fail: false,
  keys: [] as string[],
  /** While set, every send waits for it: a send in flight. */
  gate: undefined as Promise<void> | undefined,
}));
vi.mock("@/server/email/drivers/console", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/server/email/drivers/console")>();
  return {
    ...real,
    createConsoleDriver: (
      ...args: Parameters<typeof real.createConsoleDriver>
    ): EmailDriver => {
      const consoleDriver = real.createConsoleDriver(...args);
      return {
        ...consoleDriver,
        async send(message, options) {
          await driver.gate;
          if (driver.fail) throw new Error("smtp down");
          driver.keys.push(options?.idempotencyKey ?? "");
          return consoleDriver.send(message, options);
        },
      };
    },
  };
});
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("../helpers/after")).runAfter,
}));

beforeEach(() => {
  driver.fail = false;
  driver.keys = [];
  driver.gate = undefined;
  recordStderr(AFTER_FAILED);
});
afterEach(async () => {
  try {
    await flushAfter();
    // No after() task failed: afterResponse logs a failure instead of rejecting.
    endStderr();
  } finally {
    dropStderr();
  }
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** A checkout_pending request with a real key, on a fresh creator's published video. */
async function pendingRequest(
  creatorOverrides: Partial<CreatorProfile> = {},
  requestOverrides: Partial<LicenseRequest> = {},
) {
  const creator = await insertCreator(creatorOverrides);
  const live = await approvableVideo(creator.id);
  const { row, token } = await pendingCheckoutRequest(live, requestOverrides);
  const [owner] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, creator.userId));
  if (!owner) throw new Error("no user");
  return { row, token, creator, live, creatorEmail: owner.email };
}

async function waitingRequest(
  creatorOverrides: Partial<CreatorProfile> = {},
  requestOverrides: Partial<LicenseRequest> = {},
) {
  const pending = await pendingRequest(creatorOverrides, requestOverrides);
  const result = await authorizeRequest(pending.row.id);
  return { ...pending, result, ids: result.effects.map((e) => e.emailLogId) };
}

const rowsOf = (requestId: string) =>
  db
    .select()
    .from(emailLog)
    .where(eq(emailLog.entityId, requestId))
    .orderBy(emailLog.template);

const rowOf = async (requestId: string, template: string) => {
  const row = (await rowsOf(requestId)).find((r) => r.template === template);
  if (!row) throw new Error(`no ${template} row`);
  return row;
};

describe("queueing (07 D34; 02 §5.10 step 1)", () => {
  it("the authorized transition queues request-new and request-received in its transaction, keyed per request", async () => {
    const { row, creator, live, creatorEmail, result, ids } =
      await waitingRequest();
    const rows = await rowsOf(row.id);
    expect(rows).toHaveLength(2);
    expect(result.effects).toEqual(
      rows.map((r) => ({ kind: "email", emailLogId: r.id })),
    );
    expect(new Set(ids)).toEqual(new Set(rows.map((r) => r.id)));
    const common = {
      status: "queued",
      attempts: 0,
      provider: "console",
      entityType: "license_request",
      entityId: row.id,
      sentAt: null,
      error: null,
    };
    expect(rows).toEqual([
      expect.objectContaining({
        ...common,
        template: "request-new",
        idempotencyKey: `request-new/${row.id}`,
        recipientHash: sha256(creatorEmail.toLowerCase()),
        subject: `New request: Acme Studio wants to license “${live.title}”`,
      }),
      expect.objectContaining({
        ...common,
        template: "request-received",
        idempotencyKey: `request-received/${row.id}`,
        recipientHash: sha256(row.buyerEmail.toLowerCase()),
        subject: `Request sent to @${creator.handle}`,
      }),
    ]);
    for (const r of rows) {
      expect(r.subject).not.toMatch(/http|t=|\/r\//);
    }
  });

  it("an auto-approve request's authorized transition queues request-received only: request-new waits for a fallback (07 D81)", async () => {
    const { row, result } = await waitingRequest({}, { autoApprove: true });
    const rows = await rowsOf(row.id);
    expect(rows.map((r) => r.idempotencyKey)).toEqual([
      `request-received/${row.id}`,
    ]);
    expect(result.effects).toEqual(
      rows.map((r) => ({ kind: "email", emailLogId: r.id })),
    );
  });

  it("keeps no row when the transition's transaction rolls back", async () => {
    const { row } = await pendingRequest();
    await expect(
      db.transaction(async (tx) => {
        await applyTransition(
          tx,
          row.id,
          "authorized",
          {
            stripePaymentIntentId: `pi_fake_${row.id}`,
            authorizedAt: new Date(),
            expiresAt: new Date(Date.now() + HOUR_MS),
          },
          WEBHOOK,
        );
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(await rowsOf(row.id)).toEqual([]);
  });

  it("a replayed event adds no row, and a key already queued inserts nothing", async () => {
    const { row } = await waitingRequest();
    const replay = await authorizeRequest(row.id);
    expect(replay).toMatchObject({ changed: false, effects: [] });
    const again = await db.transaction((tx) =>
      queueEmail(tx, {
        template: "request-received",
        entityType: "license_request",
        entityId: row.id,
        idempotencyKey: `request-received/${row.id}`,
        to: row.buyerEmail,
        subject: "Request sent to @someone",
      }),
    );
    expect(again).toBeNull();
    expect(await rowsOf(row.id)).toHaveLength(2);
  });

  it("an abandoned checkout queues nothing (07 D27)", async () => {
    const { row } = await pendingRequest();
    const result = await db.transaction((tx) =>
      applyTransition(
        tx,
        row.id,
        "checkout_expired",
        { abandonedAt: new Date(), statusReason: "checkout_expired" },
        WEBHOOK,
      ),
    );
    expect(result).toMatchObject({ changed: true, effects: [] });
    expect(await rowsOf(row.id)).toEqual([]);
  });

  it("recipient_hash is the sha256 of the lowercased, trimmed address", () => {
    expect(recipientHash(" Ana.Buyer@Studio.COM ")).toBe(
      sha256("ana.buyer@studio.com"),
    );
  });
});

describe("sending (02 §5.10 step 2)", () => {
  it("sends both to the right people, once each: sent, one attempt, and the buyer's link opens the request", async () => {
    const { row, creator, creatorEmail, result, ids } = await waitingRequest();
    const since = Date.now();
    await sendQueuedEmails(ids);
    for (const r of await rowsOf(row.id)) {
      expect(r).toMatchObject({
        status: "sent",
        attempts: 1,
        error: null,
        provider: "console",
        providerMessageId: null,
        sentAt: expect.any(Date),
      });
    }
    const { expiresAt } = result.row;
    if (!expiresAt) throw new Error("not authorized");

    const toCreator = await readLatestEmail({
      to: creatorEmail,
      template: "request-new",
      since,
    });
    expect(toCreator.subject).toMatch(/^New request: Acme Studio wants/);
    expect(toCreator.text).toContain(
      `You get CA$150.00. Answer by ${formatEmailDateTime(expiresAt, "UTC")}. If you don't answer, the hold is released.`,
    );
    expect(toCreator.text).toContain(
      `Set up payouts to approve before ${formatEmailDateTime(expiresAt, "UTC")}.`,
    );
    expect(toCreator.text).toContain(
      `${env.APP_URL}/dashboard/requests/${row.id}`,
    );
    for (const part of [toCreator.text, toCreator.html, toCreator.subject]) {
      expect(part.toLowerCase()).not.toContain(row.buyerEmail.toLowerCase());
    }

    const toBuyer = await readLatestEmail({
      to: row.buyerEmail,
      template: "request-received",
      since,
    });
    expect(toBuyer.text).toContain(
      `Your card has a hold of CA$165.00, not a charge. @${creator.handle} has until ${formatEmailDateTime(expiresAt, "America/Toronto")} to approve.`,
    );
    const link = new RegExp(
      `${env.APP_URL}/r/${row.id}\\?t=([A-Za-z0-9_-]{43})`,
    ).exec(toBuyer.text);
    expect(link).not.toBeNull();
    expect((await findRequestForBuyer(row.id, link?.[1] ?? ""))?.id).toBe(
      row.id,
    );
    expect(driver.keys.sort()).toEqual(
      [`request-new/${row.id}`, `request-received/${row.id}`].sort(),
    );
  });

  it("Pay sends both after the response, through markAuthorized's effects", async () => {
    const { row, token } = await pendingRequest();
    await expect(fakeCheckoutPay(row.id)).rejects.toMatchObject(
      redirectTo(`/r/${row.id}?t=${token}&session_id=cs_fake_${row.id}`),
    );
    await flushAfter();
    const rows = await rowsOf(row.id);
    expect(rows.map((r) => [r.template, r.status, r.attempts])).toEqual([
      ["request-new", "sent", 1],
      ["request-received", "sent", 1],
    ]);
  });

  it("two senders at once send each row once (03 I21)", async () => {
    const { row, ids } = await waitingRequest();
    await Promise.all([sendQueuedEmails(ids), sendQueuedEmails(ids)]);
    expect(driver.keys.sort()).toEqual(
      [`request-new/${row.id}`, `request-received/${row.id}`].sort(),
    );
    for (const r of await rowsOf(row.id)) {
      expect(r).toMatchObject({ status: "sent", attempts: 1 });
    }
  });

  it("a sender never takes a row another sender is still sending (03 I21)", async () => {
    const { row, ids } = await waitingRequest();
    driver.fail = true;
    const quiet = captureLogEvents("email.send_failed");
    await sendQueuedEmails(ids);
    quiet();
    driver.fail = false;
    // One failed row left to retry: request-new.
    await db
      .update(emailLog)
      .set({ status: "sent" })
      .where(eq(emailLog.idempotencyKey, `request-received/${row.id}`));
    const { promise, resolve: open } = Promise.withResolvers<void>();
    driver.gate = promise;
    const first = retryEmailOutbox({ limit: 100 });
    await vi.waitFor(async () => {
      expect((await rowOf(row.id, "request-new")).attempts).toBe(2);
    });
    // While it is being sent, another retry passes it by and finishes without waiting for the send.
    let secondDone = false;
    const second = retryEmailOutbox({ limit: 100 }).then((sent) => {
      secondDone = true;
      return sent;
    });
    await vi.waitFor(() => expect(secondDone).toBe(true));
    expect(await second).toBe(0);
    open();
    expect(await first).toBe(1);
    expect(driver.keys).toEqual([`request-new/${row.id}`]);
    expect(await rowOf(row.id, "request-new")).toMatchObject({
      status: "sent",
      attempts: 2,
    });
  });

  it("a row whose sender died mid-send is sent again once its lease is over", async () => {
    const { row } = await waitingRequest();
    // A claim that never finished: attempts taken, queued, claimed 3 minutes ago.
    await db
      .update(emailLog)
      .set({ attempts: 1, updatedAt: sql`now() - interval '3 minutes'` })
      .where(eq(emailLog.entityId, row.id));
    expect(await retryEmailOutbox({ limit: 100 })).toBeGreaterThanOrEqual(2);
    for (const r of await rowsOf(row.id)) {
      expect(r).toMatchObject({ status: "sent", attempts: 2 });
    }
  });

  it("a failing driver leaves the row failed; the retry tries until 3 attempts, then stops", async () => {
    const { row, ids } = await waitingRequest();
    driver.fail = true;
    const read = captureLogEvents("email.send_failed");
    await sendQueuedEmails(ids);
    const { written, events } = read();
    expect(written).not.toContain(row.buyerEmail);
    expect(events).toContainEqual(
      expect.objectContaining({
        template: "request-received",
        error: "send:Error",
      }),
    );
    const attempts = async () =>
      (await rowsOf(row.id)).map((r) => [r.status, r.attempts, r.error]);
    expect(await attempts()).toEqual([
      ["failed", 1, "send:Error"],
      ["failed", 1, "send:Error"],
    ]);
    const quiet = captureLogEvents("email.send_failed");
    await retryEmailOutbox({ limit: 100 });
    expect(await attempts()).toEqual([
      ["failed", 2, "send:Error"],
      ["failed", 2, "send:Error"],
    ]);
    await retryEmailOutbox({ limit: 100 });
    driver.fail = false;
    await retryEmailOutbox({ limit: 100 });
    quiet();
    expect(await attempts()).toEqual([
      ["failed", 3, "send:Error"],
      ["failed", 3, "send:Error"],
    ]);
    expect(driver.keys).toEqual([]);
  });

  it("the retry sends a failed row once the driver is back, and counts it", async () => {
    const { row, ids } = await waitingRequest();
    driver.fail = true;
    const quiet = captureLogEvents("email.send_failed");
    await sendQueuedEmails(ids);
    quiet();
    driver.fail = false;
    expect(await retryEmailOutbox({ limit: 100 })).toBeGreaterThanOrEqual(2);
    for (const r of await rowsOf(row.id)) {
      expect(r).toMatchObject({ status: "sent", attempts: 2, error: null });
    }
  });

  it("the retry starts no row once a cron's stopAt has passed", async () => {
    const { row, ids } = await waitingRequest();
    driver.fail = true;
    const quiet = captureLogEvents("email.send_failed");
    await sendQueuedEmails(ids);
    quiet();
    driver.fail = false;
    expect(await retryEmailOutbox({ limit: 100, stopAt: Date.now() })).toBe(0);
    for (const r of await rowsOf(row.id)) {
      expect(r).toMatchObject({ status: "failed", attempts: 1 });
    }
    expect(driver.keys).toEqual([]);
    expect(
      await retryEmailOutbox({ limit: 100, stopAt: Date.now() + 60_000 }),
    ).toBeGreaterThanOrEqual(2);
    for (const r of await rowsOf(row.id)) {
      expect(r).toMatchObject({ status: "sent", attempts: 2 });
    }
  });

  it("the retry sends queued rows only once they are 2 minutes old", async () => {
    const { row } = await waitingRequest();
    await retryEmailOutbox({ limit: 100 });
    expect((await rowsOf(row.id)).map((r) => r.status)).toEqual([
      "queued",
      "queued",
    ]);
    await db
      .update(emailLog)
      .set({
        createdAt: sql`now() - interval '3 minutes'`,
        updatedAt: sql`now() - interval '3 minutes'`,
      })
      .where(eq(emailLog.entityId, row.id));
    await retryEmailOutbox({ limit: 100 });
    expect((await rowsOf(row.id)).map((r) => r.status)).toEqual([
      "sent",
      "sent",
    ]);
  });

  it("a recipient that changed since queueing is not sent, and never retried", async () => {
    const { row, ids } = await waitingRequest();
    await db
      .update(licenseRequest)
      .set({ buyerEmail: `moved-${randomUUID()}@example.com` })
      .where(eq(licenseRequest.id, row.id));
    const quiet = captureLogEvents("email.send_failed");
    await sendQueuedEmails(ids);
    quiet();
    expect(await rowOf(row.id, "request-received")).toMatchObject({
      status: "failed",
      error: "recipient_mismatch",
      attempts: 3,
    });
    expect(await rowOf(row.id, "request-new")).toMatchObject({
      status: "sent",
    });
  });

  it("a buyer key that can't be opened fails only the buyer's email, and nothing throws", async () => {
    const { row, ids } = await waitingRequest(
      {},
      { buyerTokenEnc: "v1.test.iv.tag.buyer" },
    );
    const quiet = captureLogEvents("email.send_failed");
    await expect(sendQueuedEmails(ids)).resolves.toBeUndefined();
    quiet();
    expect(await rowOf(row.id, "request-received")).toMatchObject({
      status: "failed",
      error: "token_unreadable",
      attempts: 1,
    });
    expect(await rowOf(row.id, "request-new")).toMatchObject({
      status: "sent",
    });
  });

  it("request-new leaves out the payouts line once payouts are active (07 D74)", async () => {
    const { row, creatorEmail, ids } = await waitingRequest({
      payoutsStatus: "active",
      stripeAccountId: `acct_${randomUUID().slice(0, 8)}`,
    });
    const since = Date.now();
    await sendQueuedEmails(ids);
    const email = await readLatestEmail({
      to: creatorEmail,
      template: "request-new",
      since,
    });
    expect(email.text).toContain("Review request");
    expect(email.text).not.toContain("Set up payouts");
    expect(await rowOf(row.id, "request-new")).toMatchObject({
      status: "sent",
    });
  });
});

describe("request-declined (P19; 05 §8; 07 D25, D28, D34; 01 J8.4)", () => {
  const DECLINED_SUBJECT = "Not approved: you weren't charged";

  /** The decline's ending in its own transaction, as finishCanceled commits it once Stripe has released the hold. */
  const decline = (
    id: string,
    statusReason: "creator" | "video_disabled" = "creator",
  ) =>
    db.transaction((tx) =>
      applyTransition(
        tx,
        id,
        "declined",
        { declinedAt: new Date(), statusReason },
        WEBHOOK,
      ),
    );

  const templatesOf = async (requestId: string) =>
    (await rowsOf(requestId)).map((r) => r.template);

  it("the declined transition queues request-declined to the buyer in its transaction, and nothing for the creator", async () => {
    const { row } = await waitingRequest();
    const result = await decline(row.id);
    const declined = await rowOf(row.id, "request-declined");
    expect(result.effects).toEqual([
      { kind: "email", emailLogId: declined.id },
    ]);
    expect(declined).toMatchObject({
      idempotencyKey: `request-declined/${row.id}`,
      entityType: "license_request",
      entityId: row.id,
      recipientHash: sha256(row.buyerEmail.toLowerCase()),
      subject: DECLINED_SUBJECT,
      status: "queued",
      attempts: 0,
      provider: "console",
      sentAt: null,
      error: null,
    });
    expect(await templatesOf(row.id)).toEqual([
      "request-declined",
      "request-new",
      "request-received",
    ]);
  });

  it("sends it once, with /r's Not approved body and the buyer's link, which opens the request", async () => {
    const { row, creator, live } = await waitingRequest();
    const { effects } = await decline(row.id);
    const since = Date.now();
    await sendQueuedEmails(effects.map((e) => e.emailLogId));
    expect(await rowOf(row.id, "request-declined")).toMatchObject({
      status: "sent",
      attempts: 1,
      error: null,
      sentAt: expect.any(Date),
    });
    const sent = await readLatestEmail({
      to: row.buyerEmail,
      template: "request-declined",
      since,
    });
    expect(sent.subject).toBe(DECLINED_SUBJECT);
    expect(sent.text).toContain(
      REQUEST_STATUS_COPY.declinedBody(creator.handle),
    );
    expect(sent.text).toContain(live.title);
    const link = new RegExp(
      `${env.APP_URL}/r/${row.id}\\?t=([A-Za-z0-9_-]{43})`,
    ).exec(sent.text);
    expect(link).not.toBeNull();
    expect((await findRequestForBuyer(row.id, link?.[1] ?? ""))?.id).toBe(
      row.id,
    );
    expect(driver.keys).toEqual([`request-declined/${row.id}`]);
  });

  it("says the video is gone when that is why it was declined (video_disabled)", async () => {
    const { row } = await waitingRequest();
    const { effects } = await decline(row.id, "video_disabled");
    const since = Date.now();
    await sendQueuedEmails(effects.map((e) => e.emailLogId));
    const sent = await readLatestEmail({
      to: row.buyerEmail,
      template: "request-declined",
      since,
    });
    expect(sent.subject).toBe(DECLINED_SUBJECT);
    expect(sent.text).toContain(REQUEST_STATUS_COPY.videoDisabledBody);
    expect(sent.text).not.toContain("didn't approve");
  });

  it.each([
    { event: "expired", statusReason: "deadline" },
    { event: "expired", statusReason: "hold_released" },
    { event: "capture_failed", statusReason: "capture_error:card_declined" },
  ] as const)(
    "$event ($statusReason) queues nothing in CORE",
    async ({ event, statusReason }) => {
      const { row } = await waitingRequest();
      const at = new Date();
      const result = await db.transaction((tx) =>
        applyTransition(
          tx,
          row.id,
          event,
          event === "expired"
            ? { expiredAt: at, statusReason }
            : { captureFailedAt: at, statusReason },
          WEBHOOK,
        ),
      );
      expect(result).toMatchObject({ changed: true, to: event, effects: [] });
      expect(await templatesOf(row.id)).toEqual([
        "request-new",
        "request-received",
      ]);
    },
  );

  it("keeps no row when the decline's transaction rolls back", async () => {
    const { row } = await waitingRequest();
    await expect(
      db.transaction(async (tx) => {
        await applyTransition(
          tx,
          row.id,
          "declined",
          { declinedAt: new Date(), statusReason: "creator" },
          WEBHOOK,
        );
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(await templatesOf(row.id)).toEqual([
      "request-new",
      "request-received",
    ]);
  });

  it("a second decline adds no row", async () => {
    const { row } = await waitingRequest();
    await decline(row.id);
    expect(await decline(row.id)).toMatchObject({
      changed: false,
      effects: [],
    });
    expect(await templatesOf(row.id)).toEqual([
      "request-declined",
      "request-new",
      "request-received",
    ]);
  });
});
