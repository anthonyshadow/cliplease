import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as setUpPayouts } from "../../../src/app/api/stripe/onboarding/route";
import { db } from "../../../src/db/client";
import { auditEvent, creatorProfile } from "../../../src/db/schema";
import { HOUR_MS } from "../../../src/lib/time";
import {
  PAYOUTS_FORCED_READ_MAX_AGE_MS,
  payoutsStatusForPage,
  refreshPayoutsStatus,
} from "../../../src/server/creators/profile";
import { env } from "../../../src/server/env";
import { ensureConnectedAccount } from "../../../src/server/payments/connect";
import {
  CurrencyNotEnabledError,
  paymentsDriver,
} from "../../../src/server/payments/registry";
import {
  mockNextHeaders,
  newCreatorEmail,
  signInWithOtp,
  userByEmail,
} from "../../helpers/auth";
import { auditsOf as auditsWithActorOf } from "../../helpers/connect-flow";
import { insertCreator } from "../../helpers/factories";
import { captureLogEvents } from "../../helpers/logs";

// Payout setup with the fake driver (02 §5.8, 07 D35, D95, D139). The registry memoizes one driver per currency, so a
// spy on paymentsDriver("cad")'s methods sees every call the code makes through the registry for CAD.
vi.mock("next/headers", () => import("../../helpers/next-headers"));

beforeEach(() => mockNextHeaders(null));
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const cad = () => paymentsDriver("cad");

async function storedAccount(creatorId: string) {
  const [row] = await db
    .select({
      stripeAccountId: creatorProfile.stripeAccountId,
      payoutsStatus: creatorProfile.payoutsStatus,
      syncedAt: creatorProfile.payoutsStatusSyncedAt,
      debitsEnabledAt: creatorProfile.negativeBalanceDebitsEnabledAt,
    })
    .from(creatorProfile)
    .where(eq(creatorProfile.id, creatorId));
  return row;
}

async function auditsOf(creatorId: string, action: string) {
  return db
    .select({ data: auditEvent.data })
    .from(auditEvent)
    .where(
      and(eq(auditEvent.entityId, creatorId), eq(auditEvent.action, action)),
    );
}

const ONBOARDING_URL = "http://localhost:3000/api/stripe/onboarding";

/** A GET of the setup route as a browser sends it from `fetchSite` (its Sec-Fetch-Site header). */
const onboardingRequest = (fetchSite: string) =>
  new Request(ONBOARDING_URL, { headers: { "sec-fetch-site": fetchSite } });

/** A fake driver status reading. */
const reading = (status: "pending" | "active") => ({
  status,
  payoutsActive: status === "active",
  needsInfo: false,
});

/** A creator whose account is stored already, with the payouts fields in `overrides`. */
async function creatorWithAccount(
  overrides: Parameters<typeof insertCreator>[0] = {},
) {
  const accountId = `acct_test_${randomUUID()}`;
  const creator = await insertCreator({
    stripeAccountId: accountId,
    ...overrides,
  });
  return { creator, accountId };
}

describe("ensureConnectedAccount", () => {
  it("stores acct_fake_<creatorId> once through the CAD driver, and a second call keeps it", async () => {
    const create = vi.spyOn(cad(), "createConnectedAccount");
    const creator = await insertCreator();
    const accountId = `acct_fake_${creator.id}`;

    expect(await ensureConnectedAccount(creator.id)).toBe(accountId);
    expect(await ensureConnectedAccount(creator.id)).toBe(accountId);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      id: creator.id,
      email: expect.stringMatching(/@example\.com$/),
      displayName: creator.displayName,
    });
    const stored = await storedAccount(creator.id);
    expect(stored.stripeAccountId).toBe(accountId);
    expect(stored.debitsEnabledAt).toBeInstanceOf(Date);
    expect(
      await auditsOf(creator.id, "creator_profile.payouts_account_created"),
    ).toEqual([{ data: { accountId } }]);
    // The real fake turns on negative-balance debits: no failure row (07 D139).
    expect(
      await auditsOf(creator.id, "connect.negative_balance_debits_failed"),
    ).toEqual([]);
  });

  it("uses the creator's payout currency: a USD row is refused while only CAD is enabled, and nothing is stored", async () => {
    const create = vi.spyOn(cad(), "createConnectedAccount");
    const creator = await insertCreator({ payoutCurrency: "usd" });
    await expect(ensureConnectedAccount(creator.id)).rejects.toBeInstanceOf(
      CurrencyNotEnabledError,
    );
    expect(create).not.toHaveBeenCalled();
    expect((await storedAccount(creator.id)).stripeAccountId).toBeNull();

    const withAccount = await insertCreator({
      payoutCurrency: "usd",
      stripeAccountId: `acct_test_${creator.id}`,
    });
    await expect(
      refreshPayoutsStatus(withAccount.id, { maxAgeMs: 0 }),
    ).rejects.toBeInstanceOf(CurrencyNotEnabledError);
    // A configuration error is never hidden behind the stored status, even for a page.
    await expect(
      payoutsStatusForPage(withAccount.id, { maxAgeMs: 0 }),
    ).rejects.toBeInstanceOf(CurrencyNotEnabledError);
    expect((await storedAccount(withAccount.id)).syncedAt).toBeNull();
  });

  it("allows negative-balance debits once the id is committed, outside any transaction (07 D139)", async () => {
    const creator = await insertCreator();
    const seenStored: Array<string | null> = [];
    const enable = vi
      .spyOn(cad(), "enableNegativeBalanceDebits")
      .mockImplementation(async () => {
        // A separate pooled connection sees only committed rows.
        seenStored.push((await storedAccount(creator.id)).stripeAccountId);
        return { ok: true };
      });

    await ensureConnectedAccount(creator.id);
    await ensureConnectedAccount(creator.id);
    const accountId = `acct_fake_${creator.id}`;
    expect(enable).toHaveBeenCalledTimes(1);
    expect(enable).toHaveBeenCalledWith(accountId);
    expect(seenStored).toEqual([accountId]);
    expect(
      await auditsOf(creator.id, "connect.negative_balance_debits_failed"),
    ).toEqual([]);
  });

  it.each([
    [
      "a transient failure",
      () =>
        Promise.resolve({
          ok: false,
          kind: "transient",
          code: "rate_limited",
        } as const),
      { kind: "transient", code: "rate_limited" },
    ],
    [
      "a throw",
      () => Promise.reject(new TypeError("network down")),
      { kind: "transient", code: "TypeError" },
    ],
  ])(
    "records %s as one audit row, still saves the account, and the next call tries again",
    async (_, outcome, recorded) => {
      const enable = vi
        .spyOn(cad(), "enableNegativeBalanceDebits")
        .mockImplementation(outcome);
      const creator = await insertCreator();
      const accountId = `acct_fake_${creator.id}`;

      expect(await ensureConnectedAccount(creator.id)).toBe(accountId);
      expect(await storedAccount(creator.id)).toMatchObject({
        stripeAccountId: accountId,
        debitsEnabledAt: null,
      });
      const failed = [{ data: { accountId, ...recorded } }];
      expect(
        await auditsOf(creator.id, "connect.negative_balance_debits_failed"),
      ).toEqual(failed);

      enable.mockResolvedValue({ ok: true });
      expect(await ensureConnectedAccount(creator.id)).toBe(accountId);
      expect(enable).toHaveBeenCalledTimes(2);
      expect(enable).toHaveBeenLastCalledWith(accountId);
      expect((await storedAccount(creator.id)).debitsEnabledAt).toBeInstanceOf(
        Date,
      );
      expect(
        await auditsOf(creator.id, "connect.negative_balance_debits_failed"),
      ).toEqual(failed);
    },
  );

  it("treats the recorded 'unsupported' fallback as no failure: no row, nothing stamped", async () => {
    const enable = vi
      .spyOn(cad(), "enableNegativeBalanceDebits")
      .mockResolvedValue({
        ok: false,
        kind: "permanent",
        code: "unsupported",
      });
    const creator = await insertCreator();
    await ensureConnectedAccount(creator.id);
    await ensureConnectedAccount(creator.id);
    // Each try is a call with no Stripe effect (07 D139's fallback).
    expect(enable).toHaveBeenCalledTimes(2);
    expect((await storedAccount(creator.id)).debitsEnabledAt).toBeNull();
    expect(
      await auditsOf(creator.id, "connect.negative_balance_debits_failed"),
    ).toEqual([]);
  });

  it("stores one id when two calls race: one audit row, both return the kept id, and only its call allows debits", async () => {
    const creator = await insertCreator();
    // Both calls have read "no account" before either stores one.
    let arrived = 0;
    const barrier = Promise.withResolvers<void>();
    vi.spyOn(cad(), "createConnectedAccount").mockImplementation(async () => {
      arrived += 1;
      const accountId = `acct_fake_race_${arrived}_${creator.id}`;
      if (arrived === 2) barrier.resolve();
      await barrier.promise;
      return accountId;
    });
    const enable = vi.spyOn(cad(), "enableNegativeBalanceDebits");

    const [first, second] = await Promise.all([
      ensureConnectedAccount(creator.id),
      ensureConnectedAccount(creator.id),
    ]);
    expect(arrived).toBe(2);
    expect(second).toBe(first);
    expect([1, 2].map((n) => `acct_fake_race_${n}_${creator.id}`)).toContain(
      first,
    );
    const stored = await storedAccount(creator.id);
    expect(stored.stripeAccountId).toBe(first);
    expect(stored.debitsEnabledAt).toBeInstanceOf(Date);
    expect(
      await auditsOf(creator.id, "creator_profile.payouts_account_created"),
    ).toEqual([{ data: { accountId: first } }]);
    expect(enable.mock.calls).toEqual([[first]]);
  });
});

describe("refreshPayoutsStatus", () => {
  it("is not_started without an account, then reads 'active' from the driver and skips it while fresh", async () => {
    const fetchStatus = vi.spyOn(cad(), "fetchPayoutsStatus");
    const creator = await insertCreator();

    expect(await refreshPayoutsStatus(creator.id)).toBe("not_started");
    expect(fetchStatus).not.toHaveBeenCalled();

    const accountId = await ensureConnectedAccount(creator.id);
    expect(await refreshPayoutsStatus(creator.id)).toBe("active");
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(fetchStatus).toHaveBeenCalledWith(accountId);
    const stored = await storedAccount(creator.id);
    expect(stored.payoutsStatus).toBe("active");
    expect(stored.syncedAt).toBeInstanceOf(Date);

    expect(await refreshPayoutsStatus(creator.id)).toBe("active");
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(await refreshPayoutsStatus(creator.id, { maxAgeMs: 0 })).toBe(
      "active",
    );
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("reuses a forced read made in the last 10 s, and reads again after", async () => {
    const fetchStatus = vi.spyOn(cad(), "fetchPayoutsStatus");
    const { creator } = await creatorWithAccount({
      negativeBalanceDebitsEnabledAt: new Date(),
    });
    const forced = { maxAgeMs: PAYOUTS_FORCED_READ_MAX_AGE_MS };

    expect(await refreshPayoutsStatus(creator.id, forced)).toBe("active");
    expect(await refreshPayoutsStatus(creator.id, forced)).toBe("active");
    expect(await payoutsStatusForPage(creator.id, forced)).toBe("active");
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + PAYOUTS_FORCED_READ_MAX_AGE_MS + 1000);
    expect(await refreshPayoutsStatus(creator.id, forced)).toBe("active");
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });

  it("never lets an older reading that finishes late replace a newer one", async () => {
    const { creator } = await creatorWithAccount({
      negativeBalanceDebitsEnabledAt: new Date(),
    });
    const gate = Promise.withResolvers<void>();
    const fetchStatus = vi
      .spyOn(cad(), "fetchPayoutsStatus")
      .mockImplementationOnce(async () => {
        await gate.promise;
        return reading("pending");
      })
      .mockImplementationOnce(async () => reading("active"));

    const older = refreshPayoutsStatus(creator.id, { maxAgeMs: 0 });
    await vi.waitFor(() => expect(fetchStatus).toHaveBeenCalledTimes(1));
    expect(await refreshPayoutsStatus(creator.id, { maxAgeMs: 0 })).toBe(
      "active",
    );
    const { syncedAt } = await storedAccount(creator.id);
    gate.resolve();
    expect(await older).toBe("active");
    expect(await storedAccount(creator.id)).toMatchObject({
      payoutsStatus: "active",
      syncedAt,
    });
  });

  it("for a page, keeps the stored status when the read fails (one warn line, sync time unchanged); refreshPayoutsStatus still throws", async () => {
    const syncedAt = new Date(Date.now() - HOUR_MS);
    const { creator, accountId } = await creatorWithAccount({
      payoutsStatus: "pending",
      payoutsStatusSyncedAt: syncedAt,
    });
    vi.spyOn(cad(), "fetchPayoutsStatus").mockRejectedValue(
      new Error(`Stripe timed out for ${accountId}`),
    );
    const enable = vi.spyOn(cad(), "enableNegativeBalanceDebits");
    const logged = captureLogEvents("payouts.status_refresh_failed");

    const status = await payoutsStatusForPage(creator.id, { maxAgeMs: 0 });
    const { written, events } = logged();
    expect(status).toBe("pending");
    expect(events).toEqual([
      {
        ts: expect.any(String),
        level: "warn",
        event: "payouts.status_refresh_failed",
        creatorId: creator.id,
        error: "Error",
      },
    ]);
    expect(written).not.toContain(accountId);
    expect(await storedAccount(creator.id)).toMatchObject({
      payoutsStatus: "pending",
      syncedAt,
    });
    // No status, no debits call: Stripe is failing.
    expect(enable).not.toHaveBeenCalled();
    await expect(
      refreshPayoutsStatus(creator.id, { maxAgeMs: 0 }),
    ).rejects.toThrow("Stripe timed out");
  });

  it("retries the negative-balance setting on a stale read while it isn't on, as the system", async () => {
    const { creator, accountId } = await creatorWithAccount();
    const enable = vi
      .spyOn(cad(), "enableNegativeBalanceDebits")
      .mockResolvedValueOnce({
        ok: false,
        kind: "transient",
        code: "rate_limited",
      });

    expect(await payoutsStatusForPage(creator.id, { maxAgeMs: 0 })).toBe(
      "active",
    );
    expect((await storedAccount(creator.id)).debitsEnabledAt).toBeNull();
    const failed = [
      {
        data: {
          accountId,
          kind: "transient",
          code: "rate_limited",
          source: "lazy",
        },
      },
    ];
    expect(
      await auditsOf(creator.id, "connect.negative_balance_debits_failed"),
    ).toEqual(failed);

    // A fresh status makes no call; a stale one tries again, and once it's on nothing more is asked.
    await refreshPayoutsStatus(creator.id);
    expect(enable).toHaveBeenCalledTimes(1);
    await refreshPayoutsStatus(creator.id, { maxAgeMs: 0 });
    expect(enable).toHaveBeenCalledTimes(2);
    expect(enable).toHaveBeenLastCalledWith(accountId);
    expect((await storedAccount(creator.id)).debitsEnabledAt).toBeInstanceOf(
      Date,
    );
    await refreshPayoutsStatus(creator.id, { maxAgeMs: 0 });
    expect(enable).toHaveBeenCalledTimes(2);
    expect(
      await auditsOf(creator.id, "connect.negative_balance_debits_failed"),
    ).toEqual(failed);
  });
});

describe("GET /api/stripe/onboarding", () => {
  it("creates the account, turns payouts on and sends the creator back to Settings (303); repeating keeps the account", async () => {
    const email = newCreatorEmail();
    mockNextHeaders(await signInWithOtp(email));
    const owner = await userByEmail(email);
    const creator = await insertCreator({ userId: owner.id });

    const response = await setUpPayouts(new Request(ONBOARDING_URL));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(
      /\/dashboard\/settings\?payouts=returned$/,
    );
    const stored = await storedAccount(creator.id);
    expect(stored).toMatchObject({
      stripeAccountId: `acct_fake_${creator.id}`,
      payoutsStatus: "active",
    });
    expect(
      await auditsOf(creator.id, "connect.negative_balance_debits_failed"),
    ).toEqual([]);

    expect((await setUpPayouts(new Request(ONBOARDING_URL))).status).toBe(303);
    expect((await storedAccount(creator.id)).stripeAccountId).toBe(
      `acct_fake_${creator.id}`,
    );
  });

  it("sends a signed-out visitor to sign-in (302) and a user without a profile to /onboarding (302), on APP_URL", async () => {
    // .env.test's APP_URL (port 3100) is not the request's origin, so these prove the base.
    for (const url of [
      ONBOARDING_URL,
      "http://evil.example/api/stripe/onboarding",
    ]) {
      const signedOut = await setUpPayouts(new Request(url));
      expect(signedOut.status).toBe(302);
      expect(signedOut.headers.get("location")).toBe(
        `${env.APP_URL}/sign-in?next=%2Fdashboard%2Fsettings`,
      );
    }

    mockNextHeaders(await signInWithOtp(newCreatorEmail()));
    const noProfile = await setUpPayouts(new Request(ONBOARDING_URL));
    expect(noProfile.status).toBe(302);
    expect(noProfile.headers.get("location")).toBe(`${env.APP_URL}/onboarding`);
  });

  it("starts a new payout setup only from inside ClipLease; another site's link opens Settings", async () => {
    const email = newCreatorEmail();
    mockNextHeaders(await signInWithOtp(email));
    const owner = await userByEmail(email);
    const creator = await insertCreator({ userId: owner.id });
    const create = vi.spyOn(cad(), "createConnectedAccount");

    for (const fetchSite of ["cross-site", "same-site"]) {
      const response = await setUpPayouts(onboardingRequest(fetchSite));
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        `${env.APP_URL}/dashboard/settings#payouts`,
      );
    }
    expect(create).not.toHaveBeenCalled();
    expect((await storedAccount(creator.id)).stripeAccountId).toBeNull();

    const pressed = await setUpPayouts(onboardingRequest("same-origin"));
    expect(pressed.headers.get("location")).toBe(
      `${env.APP_URL}/dashboard/settings?payouts=returned`,
    );
    expect(create).toHaveBeenCalledTimes(1);
    // Stripe's refresh_url arrives cross-site, and finds the account already stored.
    const fromStripe = await setUpPayouts(onboardingRequest("cross-site"));
    expect(fromStripe.headers.get("location")).toBe(
      `${env.APP_URL}/dashboard/settings?payouts=returned`,
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("tries the negative-balance setting once per press, as the creator, while it fails", async () => {
    const email = newCreatorEmail();
    mockNextHeaders(await signInWithOtp(email));
    const owner = await userByEmail(email);
    const creator = await insertCreator({ userId: owner.id });
    const enable = vi
      .spyOn(cad(), "enableNegativeBalanceDebits")
      .mockResolvedValue({
        ok: false,
        kind: "transient",
        code: "rate_limited",
      });
    const failures = () =>
      auditsWithActorOf(creator.id, "connect.negative_balance_debits_failed");

    // The first press creates the account and tries the setting there; the status re-read doesn't try it again.
    expect((await setUpPayouts(onboardingRequest("same-origin"))).status).toBe(
      303,
    );
    expect(enable).toHaveBeenCalledTimes(1);
    expect(await failures()).toEqual([
      expect.objectContaining({ actorType: "creator" }),
    ]);

    // A later press, past the 10 s reuse, finds the account stored and tries once more, still as the creator.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + PAYOUTS_FORCED_READ_MAX_AGE_MS + 1_000);
    expect((await setUpPayouts(onboardingRequest("same-origin"))).status).toBe(
      303,
    );
    expect(enable).toHaveBeenCalledTimes(2);
    const rows = await failures();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.actorType === "creator")).toBe(true);
    expect((await storedAccount(creator.id)).debitsEnabledAt).toBeNull();
  });

  it("reads the status once for hits within 10 s, and retries the negative-balance setting for a stored account", async () => {
    const email = newCreatorEmail();
    mockNextHeaders(await signInWithOtp(email));
    const owner = await userByEmail(email);
    const { creator, accountId } = await creatorWithAccount({
      userId: owner.id,
    });
    const fetchStatus = vi.spyOn(cad(), "fetchPayoutsStatus");
    const enable = vi.spyOn(cad(), "enableNegativeBalanceDebits");

    expect((await setUpPayouts(onboardingRequest("none"))).status).toBe(303);
    expect((await setUpPayouts(onboardingRequest("none"))).status).toBe(303);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(enable.mock.calls).toEqual([[accountId]]);
    expect(await storedAccount(creator.id)).toMatchObject({
      payoutsStatus: "active",
      debitsEnabledAt: expect.any(Date),
    });
  });

  it("logs a failure by its class only and sends the creator back to Settings with ?payouts=error", async () => {
    const email = newCreatorEmail();
    mockNextHeaders(await signInWithOtp(email));
    const owner = await userByEmail(email);
    await creatorWithAccount({ userId: owner.id });
    vi.spyOn(cad(), "createOnboardingLink").mockRejectedValueOnce(
      new Error("Failed query: insert … params: acct_x"),
    );
    const logged = captureLogEvents("payouts.onboarding_failed");

    const response = await setUpPayouts(onboardingRequest("same-origin"));
    const { written, events } = logged();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `${env.APP_URL}/dashboard/settings?payouts=error`,
    );
    expect(events).toEqual([
      {
        ts: expect.any(String),
        level: "error",
        event: "payouts.onboarding_failed",
        error: "Error",
      },
    ]);
    expect(written).not.toContain("acct_x");
  });
});
