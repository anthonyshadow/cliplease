import { describe, expect, it } from "vitest";
import {
  CURRENCY_ACCOUNT_COUNTRY,
  CurrencyNotEnabledError,
  createPaymentsRegistry,
  paymentsDriver,
} from "./registry";

// Injected env: env.ts itself refuses PAYMENTS_DRIVER=fake outside development and test, so the refusal can only be
// tested here.
const testEnv: Parameters<typeof createPaymentsRegistry>[0] = {
  APP_ENV: "test",
  PAYMENTS_DRIVER: "fake",
  ENABLED_CURRENCIES: ["cad"],
  APP_URL: "http://fake.test",
};

describe("paymentsDriver registry (07 D95)", () => {
  it("gives each currency its own memoized driver", () => {
    const registry = createPaymentsRegistry({
      ...testEnv,
      ENABLED_CURRENCIES: ["cad", "usd"],
    });
    expect(registry("cad")).toBe(registry("cad"));
    expect(registry("cad").currency).toBe("cad");
    expect(registry("usd").currency).toBe("usd");
    expect(registry("usd")).not.toBe(registry("cad"));
  });

  it("refuses a currency outside ENABLED_CURRENCIES", () => {
    const registry = createPaymentsRegistry(testEnv);
    expect(() => registry("usd")).toThrow(CurrencyNotEnabledError);
  });

  it("refuses the fake driver outside development and test", () => {
    for (const APP_ENV of ["preview", "production"] as const) {
      const registry = createPaymentsRegistry({ ...testEnv, APP_ENV });
      expect(() => registry("cad")).toThrow(/development or test/);
    }
  });

  it("has no Stripe driver before P24", () => {
    const registry = createPaymentsRegistry({
      ...testEnv,
      PAYMENTS_DRIVER: "stripe",
    });
    expect(() => registry("cad")).toThrow("Stripe driver arrives in P24");
  });

  it("uses the app's env: the fake CAD driver in test", () => {
    expect(paymentsDriver("cad").name).toBe("fake");
    expect(paymentsDriver("cad").currency).toBe("cad");
    expect(paymentsDriver("cad")).toBe(paymentsDriver("cad"));
    expect(CURRENCY_ACCOUNT_COUNTRY).toEqual({ cad: "CA", usd: "US" });
  });
});

describe("the fake driver (07 D35)", () => {
  const fake = createPaymentsRegistry(testEnv)("cad");

  it("turns payouts on without Stripe", async () => {
    await expect(
      fake.createConnectedAccount({
        id: "c1",
        email: "maya@example.com",
        displayName: "Maya R.",
      }),
    ).resolves.toBe("acct_fake_c1");
    // The injected APP_URL, not the process env's.
    await expect(fake.createOnboardingLink("acct_fake_c1")).resolves.toBe(
      "http://fake.test/dashboard/settings?payouts=returned",
    );
    await expect(fake.fetchPayoutsStatus("acct_fake_c1")).resolves.toEqual({
      status: "active",
      payoutsActive: true,
      needsInfo: false,
    });
  });

  it("rejects what later prompts add, and every webhook", async () => {
    await expect(fake.getAuthorization("pi_1")).rejects.toThrow(
      "fake driver: getAuthorization arrives in P16",
    );
    await expect(
      fake.createTransfer({
        requestId: "r1",
        chargeId: "ch_1",
        destinationAccountId: "acct_fake_c1",
        amountCents: 100,
        idempotencyKey: "k",
      }),
    ).rejects.toThrow("arrives in P19b");
    await expect(
      fake.refund({
        requestId: "r1",
        paymentIntentId: "pi_1",
        idempotencyKey: "k",
      }),
    ).rejects.toThrow("arrives in P21b");
    await expect(fake.parseWebhook("{}", "sig")).rejects.toThrow();
  });
});
