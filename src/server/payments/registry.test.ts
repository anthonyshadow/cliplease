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

const REQUEST = "6f4c8d7e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

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
    // Back to where the creator started (owner answer Q-94 a), keeping its own query.
    await expect(
      fake.createOnboardingLink("acct_fake_c1", {
        returnTo: "/dashboard/videos/v1?step=review",
      }),
    ).resolves.toBe(
      "http://fake.test/dashboard/videos/v1?step=review&payouts=returned",
    );
    await expect(fake.fetchPayoutsStatus("acct_fake_c1")).resolves.toEqual({
      status: "active",
      payoutsActive: true,
      needsInfo: false,
    });
  });

  it("opens a checkout for its own currency only, at the dev page, with no key or email in the URL (07 D35, D95)", async () => {
    const input = {
      currency: "cad" as const,
      requestId: REQUEST,
      buyerToken: "t".repeat(43),
      buyerEmail: "sam@dailylaughs.com",
      licensePriceCents: 157500,
      platformFeeCents: 15750,
      licenseLabel: "First snow · Paid social ads · 1 year · Worldwide",
      checkoutExpiresAt: new Date(),
    };
    await expect(fake.createCheckout(input)).resolves.toEqual({
      sessionId: `cs_fake_${REQUEST}`,
      url: `http://fake.test/dev/fake-checkout/${REQUEST}`,
    });
    await expect(
      fake.createCheckout({ ...input, currency: "usd" }),
    ).rejects.toThrow("a usd checkout on the cad account");
  });

  it("captures and cancels a fake PaymentIntent, and refuses any other id before reading anything", async () => {
    await expect(fake.capture(`pi_fake_${REQUEST}`, "k")).resolves.toEqual({
      ok: true,
    });
    await expect(
      fake.cancel(`pi_fake_${REQUEST}`, "abandoned", "k"),
    ).resolves.toEqual({ ok: true });
    for (const id of ["pi_1", `cs_fake_${REQUEST}`, "pi_fake_x"]) {
      await expect(fake.getAuthorization(id)).rejects.toThrow(
        "unknown pi_fake id",
      );
      await expect(fake.capture(id, "k")).rejects.toThrow("unknown pi_fake id");
    }
    await expect(fake.retrieveCheckout(`pi_fake_${REQUEST}`)).rejects.toThrow(
      "unknown cs_fake id",
    );
  });

  it("rejects what later prompts add, and every webhook", async () => {
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
