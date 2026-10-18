import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { GET as setUpPayouts } from "../../../src/app/api/stripe/onboarding/route";
import { db } from "../../../src/db/client";
import { auditEvent, creatorProfile } from "../../../src/db/schema";
import { refreshPayoutsStatus } from "../../../src/server/creators/profile";
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
import { resetDb } from "../../helpers/db";
import { insertCreator } from "../../helpers/factories";

// Payout setup with the fake driver (02 §5.8, 07 D35, D95, D139). The registry memoizes one driver per currency, so a
// spy on paymentsDriver("cad")'s methods sees every call the code makes through the registry for CAD.
vi.mock("next/headers", () => import("../../helpers/next-headers"));

afterAll(resetDb);
beforeEach(() => mockNextHeaders(null));
afterEach(() => vi.restoreAllMocks());

const cad = () => paymentsDriver("cad");

async function storedAccount(creatorId: string) {
  const [row] = await db
    .select({
      stripeAccountId: creatorProfile.stripeAccountId,
      payoutsStatus: creatorProfile.payoutsStatus,
      syncedAt: creatorProfile.payoutsStatusSyncedAt,
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
    expect((await storedAccount(creator.id)).stripeAccountId).toBe(accountId);
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
    "records %s as one audit row and still saves the account",
    async (_, outcome, recorded) => {
      vi.spyOn(cad(), "enableNegativeBalanceDebits").mockImplementation(
        outcome,
      );
      const creator = await insertCreator();
      const accountId = `acct_fake_${creator.id}`;

      expect(await ensureConnectedAccount(creator.id)).toBe(accountId);
      expect((await storedAccount(creator.id)).stripeAccountId).toBe(accountId);
      expect(
        await auditsOf(creator.id, "connect.negative_balance_debits_failed"),
      ).toEqual([{ data: { accountId, ...recorded } }]);
    },
  );

  it("treats the recorded 'unsupported' fallback as no failure", async () => {
    vi.spyOn(cad(), "enableNegativeBalanceDebits").mockResolvedValue({
      ok: false,
      kind: "permanent",
      code: "unsupported",
    });
    const creator = await insertCreator();
    await ensureConnectedAccount(creator.id);
    expect(
      await auditsOf(creator.id, "connect.negative_balance_debits_failed"),
    ).toEqual([]);
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

  it("sends a signed-out visitor to sign-in (302) and a user without a profile to /onboarding (302)", async () => {
    const signedOut = await setUpPayouts(new Request(ONBOARDING_URL));
    expect(signedOut.status).toBe(302);
    expect(signedOut.headers.get("location")).toBe(
      "http://localhost:3000/sign-in?next=%2Fdashboard%2Fsettings",
    );

    mockNextHeaders(await signInWithOtp(newCreatorEmail()));
    const noProfile = await setUpPayouts(new Request(ONBOARDING_URL));
    expect(noProfile.status).toBe(302);
    expect(noProfile.headers.get("location")).toBe(
      "http://localhost:3000/onboarding",
    );
  });
});
