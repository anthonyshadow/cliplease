import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CURRENCIES,
  type Currency,
  EXCLUSIVE_TERM_KEYS,
  type ExclusiveTermKey,
  LICENSE_REQUEST_STATUSES,
  PAYMENT_ACTIONS,
  RENEWABLE_TERM_KEYS,
  type RenewableTermKey,
  TERM_KEYS,
  USER_ROLES,
} from "./values";

describe("values.ts tuples", () => {
  it("renews every exclusive length and never Perpetual (07 §10.2, D133)", () => {
    expect(RENEWABLE_TERM_KEYS).toEqual(EXCLUSIVE_TERM_KEYS);
    expect(EXCLUSIVE_TERM_KEYS).toEqual(["d30", "m6", "y1"]);
    expect(RENEWABLE_TERM_KEYS).not.toContain("perpetual");
    for (const key of EXCLUSIVE_TERM_KEYS) expect(TERM_KEYS).toContain(key);
    expectTypeOf<RenewableTermKey>().toEqualTypeOf<"d30" | "m6" | "y1">();
    expectTypeOf<ExclusiveTermKey>().toEqualTypeOf<RenewableTermKey>();
  });

  it("ends the request statuses and payment actions with the renewal values, which ship in 0000 (07 D116)", () => {
    expect(LICENSE_REQUEST_STATUSES.slice(-3)).toEqual([
      "renewal_pending",
      "renewal_canceled",
      "renewal_failed",
    ]);
    expect(PAYMENT_ACTIONS.slice(-2)).toEqual([
      "renewal_charge",
      "renewal_checkout",
    ]);
  });

  it("lists CAD and USD (07 §8.2, D94)", () => {
    expect(CURRENCIES).toEqual(["cad", "usd"]);
    expectTypeOf<Currency>().toEqualTypeOf<"cad" | "usd">();
  });

  it("has no buyer role (07 D126)", () => {
    expect(USER_ROLES).toEqual(["creator", "admin"]);
  });
});
