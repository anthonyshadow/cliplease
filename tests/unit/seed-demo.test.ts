import { describe, expect, it } from "vitest";
import {
  type DemoChecks,
  demoRefusal,
  mayaPayoutColumns,
  seedRefusal,
} from "../../scripts/seed";
import { MOCK_SOCIAL_SCENARIOS } from "../../src/server/env";

// The seed's pure checks (03 §8.1, 07 D51, D53): what refuses a run before anything is written.

const ready: DemoChecks = {
  currencies: ["cad"],
  mockEnabled: true,
  scenario: "default",
};

describe("seedRefusal", () => {
  it("refuses APP_ENV=production, with or without --demo", () => {
    expect(seedRefusal("production")).toMatch(/APP_ENV=production/);
  });

  it.each(["development", "test", "preview", undefined])(
    "lets APP_ENV=%s run",
    (appEnv) => {
      expect(seedRefusal(appEnv)).toBeNull();
    },
  );
});

describe("demoRefusal", () => {
  it("lets the demo run with cad, the mock and the default scenario", () => {
    expect(demoRefusal(ready)).toBeNull();
    expect(demoRefusal({ ...ready, currencies: ["cad", "usd"] })).toBeNull();
  });

  it("needs cad, Maya's payout currency", () => {
    expect(demoRefusal({ ...ready, currencies: ["usd"] })).toBe(
      "--demo needs ENABLED_CURRENCIES to contain cad (Maya's payout currency, 07 D94).",
    );
  });

  it("needs the mock provider", () => {
    expect(demoRefusal({ ...ready, mockEnabled: false })).toBe(
      "--demo needs ENABLED_SOCIAL_PROVIDERS to contain mock.",
    );
  });

  it.each(MOCK_SOCIAL_SCENARIOS.filter((s) => s !== "default"))(
    "refuses the %s scenario",
    (scenario) => {
      expect(demoRefusal({ ...ready, scenario })).toBe(
        `--demo needs MOCK_SOCIAL_SCENARIO=default, not ${scenario}.`,
      );
    },
  );

  it("names the currency first when several checks fail", () => {
    expect(
      demoRefusal({ currencies: [], mockEnabled: false, scenario: "empty" }),
    ).toMatch(/ENABLED_CURRENCIES/);
  });
});

describe("mayaPayoutColumns", () => {
  it("gives the fake driver's account id and active payouts", () => {
    expect(mayaPayoutColumns("fake")).toEqual({
      stripeAccountId: "acct_fake_00000000-0000-4000-8000-000000000001",
      payoutsStatus: "active",
    });
  });

  it("leaves payouts not started with Stripe", () => {
    expect(mayaPayoutColumns("stripe")).toEqual({
      stripeAccountId: null,
      payoutsStatus: "not_started",
    });
  });
});
