import { describe, expect, it } from "vitest";
import { GENERIC_ERROR_MESSAGE } from "../result";
import {
  basePriceCentsSchema,
  defaultRateCardInput,
  MultiplierBpsSchema,
  rateCardFieldErrors,
  rateCardInputSchema,
} from "./pricing";

const firstMessage = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (result.success ? null : result.error?.issues[0]?.message);

const defaults = () => defaultRateCardInput("cad").options;

describe("basePriceCentsSchema (01 J4.2, 07 D21, D97)", () => {
  const schema = basePriceCentsSchema("cad");

  it.each([1000, 15000, 1_000_000])("accepts %i", (cents) => {
    expect(schema.safeParse(cents).success).toBe(true);
  });

  it.each([
    [999, "Minimum is CA$10."],
    [0, "Minimum is CA$10."],
    [1_000_100, "Maximum is CA$10,000."],
    [15050, "Use whole dollars."],
    [150.5, "Use whole dollars."],
    [Number.NaN, "Use whole dollars."],
    ["15000", "Use whole dollars."],
  ])("refuses %j: %s", (value, message) => {
    expect(firstMessage(schema.safeParse(value))).toBe(message);
  });

  it("speaks the creator's currency", () => {
    expect(firstMessage(basePriceCentsSchema("usd").safeParse(999))).toBe(
      "Minimum is US$10.",
    );
  });
});

describe("MultiplierBpsSchema (01 J4.3, 07 D21)", () => {
  it.each([10000, 10500, 30000, 100000])("accepts %i", (bps) => {
    expect(MultiplierBpsSchema.safeParse(bps).success).toBe(true);
  });

  it.each([
    [9500, "Minimum is ×1.00."],
    [100500, "Maximum is ×10.00."],
    [10250, "Use steps of 0.05."],
    [15000.5, "Use steps of 0.05."],
    [null, "Use steps of 0.05."],
  ])("refuses %j: %s", (value, message) => {
    expect(firstMessage(MultiplierBpsSchema.safeParse(value))).toBe(message);
  });
});

describe("rateCardInputSchema", () => {
  const schema = rateCardInputSchema("cad");

  it("accepts the J4.1 card", () => {
    expect(
      schema.safeParse({ basePriceCents: 15000, options: defaults() }).success,
    ).toBe(true);
  });

  it.each([
    ["use", "Keep at least one use."],
    ["term", "Keep at least one term."],
    ["territory", "Keep at least one territory."],
  ] as const)("keeps one %s on: %s", (dimension, message) => {
    const options = defaults().map((o) =>
      o.dimension === dimension ? { ...o, enabled: false } : o,
    );
    const result = schema.safeParse({ basePriceCents: 15000, options });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(rateCardFieldErrors(result.error, { options })).toEqual({
        [dimension]: message,
      });
    }
  });

  it("names each failing field by its first issue", () => {
    const options = defaults().map((o) => {
      if (o.key === "paid_social") return { ...o, multiplierBps: 10250 };
      if (o.dimension === "term") return { ...o, enabled: false };
      return o;
    });
    const input = { basePriceCents: 999, options };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(rateCardFieldErrors(result.error, input)).toEqual({
        basePriceCents: "Minimum is CA$10.",
        paid_social: "Use steps of 0.05.",
        term: "Keep at least one term.",
      });
    }
  });

  it("reads any input, crafted or not", () => {
    const result = schema.safeParse("nonsense");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(rateCardFieldErrors(result.error, "nonsense")).toEqual({
        options: expect.any(String),
      });
    }
  });

  it("names a group with nothing on even when a field doesn't read as a number", () => {
    const options = defaults().map((o) =>
      o.dimension === "term" ? { ...o, enabled: false } : o,
    );
    const input = { basePriceCents: Number.NaN, options };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(rateCardFieldErrors(result.error, input)).toEqual({
        basePriceCents: "Use whole dollars.",
        term: "Keep at least one term.",
      });
    }
  });

  it.each([
    ["a missing option", defaults().slice(1)],
    ["a repeated option", [...defaults().slice(1), defaults()[1]]],
    [
      "an option in the wrong group",
      defaults().map((o) =>
        o.key === "d30" ? { ...o, dimension: "use" as const } : o,
      ),
    ],
  ])("refuses %s", (_name, options) => {
    const result = schema.safeParse({ basePriceCents: 15000, options });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(rateCardFieldErrors(result.error, { options })).toEqual({
        options: GENERIC_ERROR_MESSAGE,
      });
    }
  });
});
