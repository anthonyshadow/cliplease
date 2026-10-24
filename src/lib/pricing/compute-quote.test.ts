import { describe, expect, it } from "vitest";
import type { Currency } from "../domain/values";
import {
  computeQuote,
  licensePriceCents,
  platformFeeCents,
  type QuoteInput,
} from "./compute-quote";

// 02 §5.5, 03 §3.7.1, 07 D79, D97, D99: base, use, term, territory, feeBps, min → license / fee / total (minor units).
function quote(
  [base, use, term, territory, feeBps, min]: readonly number[],
  currency: Currency = "cad",
) {
  const input: QuoteInput = {
    currency,
    basePriceCents: base,
    useBps: use,
    termBps: term,
    territoryBps: territory,
    platformFeeBps: feeBps,
    platformFeeMinCents: min,
  };
  return computeQuote(input);
}

function amounts(inputs: readonly number[], currency?: Currency) {
  const result = quote(inputs, currency);
  if (!result.ok) throw new Error(`expected a quote, got ${result.reason}`);
  const { licensePriceCents, platformFeeCents, totalCents } = result.quote;
  return [licensePriceCents, platformFeeCents, totalCents];
}

describe("computeQuote goldens (CAD)", () => {
  it.each([
    [
      "demo: Paid social ads · 1 year · Worldwide",
      [15000, 30000, 20000, 17500, 1000, 200],
      [157500, 15750, 173250],
    ],
    [
      "CA$10.00 pays the CA$2.00 floor",
      [1000, 10000, 10000, 10000, 1000, 200],
      [1000, 200, 1200],
    ],
    [
      "CA$19.95 still under the floor",
      [1000, 10500, 19000, 10000, 1000, 200],
      [1995, 200, 2195],
    ],
    [
      "CA$20.00: 10 % equals the floor",
      [1000, 20000, 10000, 10000, 1000, 200],
      [2000, 200, 2200],
    ],
    [
      "rounds every step half up",
      [12345, 13000, 15000, 13000, 1000, 200],
      [31295, 3130, 34425],
    ],
    [
      "Organic · 30 days · One country",
      [15000, 10000, 10000, 10000, 1000, 200],
      [15000, 1500, 16500],
    ],
    [
      "Organic · 6 months · One region",
      [15000, 10000, 15000, 13000, 1000, 200],
      [29250, 2925, 32175],
    ],
    [
      "TV · Perpetual · Worldwide",
      [15000, 50000, 30000, 17500, 1000, 200],
      [393750, 39375, 433125],
    ],
    [
      "the tie rounds up; the floor bites below CA$20.00",
      [1001, 15000, 10000, 10000, 1000, 200],
      [1502, 200, 1702],
    ],
    [
      "with no floor the flat 10 % holds",
      [1001, 15000, 10000, 10000, 1000, 0],
      [1502, 150, 1652],
    ],
  ] as const)("%s", (_name, inputs, expected) => {
    expect(amounts(inputs)).toEqual(expected);
  });

  it("gives the same numbers in USD, in USD", () => {
    const result = quote([15000, 30000, 20000, 17500, 1000, 200], "usd");
    expect(result).toEqual({
      ok: true,
      quote: {
        currency: "usd",
        licensePriceCents: 157500,
        platformFeeCents: 15750,
        totalCents: 173250,
      },
    });
  });

  it("carries the input's currency", () => {
    const result = quote([15000, 30000, 20000, 17500, 1000, 200]);
    expect(result.ok && result.quote.currency).toBe("cad");
  });
});

describe("MAX_TOTAL_CENTS on the total (07 D22, D97)", () => {
  it("allows a total of exactly CA$999,999.99 and refuses one cent more", () => {
    expect(amounts([90909090, 10000, 10000, 10000, 1000, 200])).toEqual([
      90909090, 9090909, 99999999,
    ]);
    expect(quote([90909091, 10000, 10000, 10000, 1000, 200])).toEqual({
      ok: false,
      reason: "over_max",
    });
  });

  it("holds at the bounds a creator can reach (base × ×10 × ×10 × ×1)", () => {
    expect(amounts([909000, 100000, 100000, 10000, 1000, 200])[2]).toBe(
      99990000,
    );
    expect(quote([909100, 100000, 100000, 10000, 1000, 200])).toEqual({
      ok: false,
      reason: "over_max",
    });
  });
});

describe("invalid input", () => {
  it.each([
    ["a fractional base", [1.5, 10000, 10000, 10000, 1000, 200]],
    ["a negative base", [-1, 10000, 10000, 10000, 1000, 200]],
    ["a zero multiplier", [15000, 0, 10000, 10000, 1000, 200]],
    ["NaN", [15000, 10000, Number.NaN, 10000, 1000, 200]],
    ["an unsafe integer", [2 ** 53, 10000, 10000, 10000, 1000, 200]],
    ["a fee over 100 %", [15000, 10000, 10000, 10000, 10001, 200]],
    ["a negative fee", [15000, 10000, 10000, 10000, -1, 200]],
    ["a floor over CA$100.00", [15000, 10000, 10000, 10000, 1000, 10001]],
    ["a fractional floor", [15000, 10000, 10000, 10000, 1000, 2.5]],
  ] as const)("refuses %s", (_name, inputs) => {
    expect(quote(inputs)).toEqual({ ok: false, reason: "invalid_input" });
  });
});

describe("the two steps", () => {
  it("licensePriceCents is the product over 10^12, half up", () => {
    expect(licensePriceCents(15000, 30000, 20000, 17500)).toBe(157500);
    expect(licensePriceCents(1001, 15000, 10000, 10000)).toBe(1502);
    // 1504.5 → 1505 (half to even would give 1504); 1051.05 → 1051 (rounding up would give 1052).
    expect(licensePriceCents(1003, 15000, 10000, 10000)).toBe(1505);
    expect(licensePriceCents(1001, 10500, 10000, 10000)).toBe(1051);
  });

  it("platformFeeCents rounds half up and keeps the floor", () => {
    expect(platformFeeCents(2005, 1000, 200)).toBe(201);
    expect(platformFeeCents(1995, 1000, 200)).toBe(200);
    expect(platformFeeCents(157500, 1000, 200)).toBe(15750);
    expect(platformFeeCents(15, 1000, 0)).toBe(2);
  });
});
