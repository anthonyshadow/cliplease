import { describe, expect, it } from "vitest";
import { payoutCurrencyFact } from "./payout-currency-facts";

describe("payoutCurrencyFact (07 D94, D140)", () => {
  it("names each currency and the bank account its payouts go to", () => {
    expect(payoutCurrencyFact("cad")).toBe(
      "You'll get paid in Canadian dollars (CAD) to a Canadian bank account.",
    );
    expect(payoutCurrencyFact("usd")).toBe(
      "You'll get paid in US dollars (USD) to a US bank account.",
    );
  });
});
