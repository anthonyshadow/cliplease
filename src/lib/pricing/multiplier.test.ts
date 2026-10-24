import { describe, expect, it } from "vitest";
import {
  formatMultiplier,
  multiplierFieldValue,
  parseMultiplierBps,
  parseWholeDollars,
  wholeDollarsFieldValue,
} from "./multiplier";

describe("parseMultiplierBps (string math)", () => {
  it.each([
    ["3", 30000],
    ["3.00", 30000],
    ["×1.5", 15000],
    ["× 1.50", 15000],
    ["1.15", 11500],
    ["1.05", 10500],
    ["10", 100000],
    [" 2.25 ", 22500],
    ["0.95", 9500],
    ["1,5", 15000],
    ["1,50", 15000],
    ["× 1,75", 17500],
  ])("%j → %i", (text, bps) => {
    expect(parseMultiplierBps(text)).toBe(bps);
  });

  it.each(["", " ", "1.234", "1,234", "abc", ".5", "1.", "-1", "x1.5", "1.5×"])(
    "%j → null",
    (text) => {
      expect(parseMultiplierBps(text)).toBeNull();
    },
  );

  it("reads back what it writes, for every step from ×1.00 to ×10.00", () => {
    for (let bps = 10000; bps <= 100000; bps += 500) {
      expect(parseMultiplierBps(multiplierFieldValue(bps))).toBe(bps);
      expect(parseMultiplierBps(formatMultiplier(bps))).toBe(bps);
    }
  });
});

describe("the multiplier's text", () => {
  it("formats read-only text with the sign and a space", () => {
    expect(formatMultiplier(15000)).toBe("× 1.50");
    expect(formatMultiplier(100000)).toBe("× 10.00");
  });

  it("gives the field its bare value", () => {
    expect(multiplierFieldValue(10000)).toBe("1.00");
    expect(multiplierFieldValue(17500)).toBe("1.75");
  });
});

describe("parseWholeDollars", () => {
  it.each([
    ["150", 15000],
    ["10", 1000],
    ["10000", 1_000_000],
    ["10,000", 1_000_000],
    ["150.00", 15000],
    ["150.0", 15000],
    [" 9 ", 900],
  ])("%j → %i cents", (text, cents) => {
    expect(parseWholeDollars(text)).toBe(cents);
  });

  it.each([
    "150.50",
    "150.5",
    "",
    "abc",
    "1,50",
    "1,0000",
    "CA$150",
    "-5",
    "1e3",
  ])("%j → null", (text) => {
    expect(parseWholeDollars(text)).toBeNull();
  });

  it("gives the base field its value", () => {
    expect(wholeDollarsFieldValue(15000)).toBe("150");
    expect(wholeDollarsFieldValue(1_000_000)).toBe("10000");
  });
});
