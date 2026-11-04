import { describe, expect, it } from "vitest";
import { GENERIC_ERROR_MESSAGE } from "../result";
import {
  basePriceCentsSchema,
  defaultRateCardInput,
  ExclusiveMultiplierBpsSchema,
  MultiplierBpsSchema,
  rateCardFieldErrors,
  rateCardInputSchema,
  VideoExclusiveOfferInputSchema,
  VideoUseToggleInputSchema,
  videoBasePriceInputSchema,
} from "./pricing";

const firstMessage = (result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}) => (result.success ? null : result.error?.issues[0]?.message);

const defaults = () => defaultRateCardInput("cad").options;

/** The default card with this base and these options. */
const cardWith = <O>(basePriceCents: number, options: O) => ({
  ...defaultRateCardInput("cad"),
  basePriceCents,
  options,
});

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
    expect(schema.safeParse(cardWith(15000, defaults())).success).toBe(true);
  });

  it.each([
    ["use", "Keep at least one use."],
    ["term", "Keep at least one term."],
    ["territory", "Keep at least one territory."],
  ] as const)("keeps one %s on: %s", (dimension, message) => {
    const options = defaults().map((o) =>
      o.dimension === dimension ? { ...o, enabled: false } : o,
    );
    const result = schema.safeParse(cardWith(15000, options));
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
    const input = cardWith(999, options);
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
    const input = cardWith(Number.NaN, options);
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
    const result = schema.safeParse(cardWith(15000, options));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(rateCardFieldErrors(result.error, { options })).toEqual({
        options: GENERIC_ERROR_MESSAGE,
      });
    }
  });

  it("refuses a card without the exclusive switch", () => {
    const { exclusiveEnabled: _dropped, ...input } =
      defaultRateCardInput("cad");
    expect(schema.safeParse(input).success).toBe(false);
  });

  it.each([
    [9500, "Minimum is ×1.00."],
    [100500, "Maximum is ×10.00."],
    [30250, "Use steps of 0.05."],
  ])(
    "names the exclusive premium for %i: %s",
    (exclusiveMultiplierBps, message) => {
      const input = { ...defaultRateCardInput("cad"), exclusiveMultiplierBps };
      const result = schema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(rateCardFieldErrors(result.error, input)).toEqual({
          exclusiveMultiplierBps: message,
        });
      }
    },
  );

  it("names a group with nothing on even when the premium doesn't read as a number", () => {
    const input = {
      ...defaultRateCardInput("cad"),
      exclusiveMultiplierBps: Number.NaN,
      options: defaults().map((o) =>
        o.dimension === "term" ? { ...o, enabled: false } : o,
      ),
    };
    const result = schema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(rateCardFieldErrors(result.error, input)).toEqual({
        exclusiveMultiplierBps: "Use steps of 0.05.",
        term: "Keep at least one term.",
      });
    }
  });
});

describe("defaultRateCardInput (07 D109, owner answer Q-165)", () => {
  it("is exclusive off at ×3.00, and passes its own schema", () => {
    const input = defaultRateCardInput("cad");
    expect(input.exclusiveEnabled).toBe(false);
    expect(input.exclusiveMultiplierBps).toBe(30000);
    expect(rateCardInputSchema("cad").safeParse(input).success).toBe(true);
  });
});

describe("ExclusiveMultiplierBpsSchema (07 D109)", () => {
  it("is every multiplier's schema", () => {
    expect(ExclusiveMultiplierBpsSchema).toBe(MultiplierBpsSchema);
  });

  it.each([10000, 30000, 100000])("accepts %i", (bps) => {
    expect(ExclusiveMultiplierBpsSchema.safeParse(bps).success).toBe(true);
  });
});

describe("VideoExclusiveOfferInputSchema (07 D109, D127)", () => {
  const VIDEO_ID = "6f1c9a1e-2b3d-4c5e-8f70-112233445566";
  const parse = (mode: string, multiplierBps: number | null) =>
    VideoExclusiveOfferInputSchema.safeParse({
      videoId: VIDEO_ID,
      mode,
      multiplierBps,
    });

  it.each([
    ["on", null],
    ["on", 30000],
    ["off", null],
    ["rate_card", null],
  ])("accepts %s with %s", (mode, multiplierBps) => {
    expect(parse(mode, multiplierBps).success).toBe(true);
  });

  it.each(["off", "rate_card"])(
    "refuses a premium with %s, as the generic error on no field",
    (mode) => {
      const result = parse(mode, 40000);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0]?.path).toEqual([]);
        expect(result.error.issues[0]?.message).toBe(GENERIC_ERROR_MESSAGE);
      }
    },
  );

  it("refuses a mode it doesn't know", () => {
    expect(parse("maybe", null).success).toBe(false);
  });

  it("names the premium when it is out of bounds", () => {
    const result = parse("on", 100500);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["multiplierBps"]);
      expect(result.error.issues[0]?.message).toBe("Maximum is ×10.00.");
    }
  });
});

describe("videoBasePriceInputSchema (07 D82, D97)", () => {
  const schema = videoBasePriceInputSchema("cad");
  const VIDEO_ID = "6f1c9a1e-2b3d-4c5e-8f70-112233445566";
  const issueOf = (basePriceCents: unknown) => {
    const result = schema.safeParse({ videoId: VIDEO_ID, basePriceCents });
    return result.success
      ? null
      : {
          path: result.error.issues[0]?.path,
          message: result.error.issues[0]?.message,
        };
  };

  it.each([null, 1000, 30000, 1_000_000])("accepts %s", (basePriceCents) => {
    expect(
      schema.safeParse({ videoId: VIDEO_ID, basePriceCents }).success,
    ).toBe(true);
  });

  it.each([
    [999, "Minimum is CA$10."],
    [1_000_100, "Maximum is CA$10,000."],
    [15050, "Use whole dollars."],
    [Number.NaN, "Use whole dollars."],
  ])("refuses %s on basePriceCents with %s", (cents, message) => {
    expect(issueOf(cents)).toEqual({ path: ["basePriceCents"], message });
  });

  it("refuses a video id that isn't a uuid", () => {
    const result = schema.safeParse({ videoId: "abc", basePriceCents: null });
    expect(result.success ? null : result.error.issues[0]?.path).toEqual([
      "videoId",
    ]);
  });
});

describe("VideoUseToggleInputSchema (07 D82)", () => {
  const VIDEO_ID = "6f1c9a1e-2b3d-4c5e-8f70-112233445566";

  it.each([
    ["paid_social", true],
    ["paid_social", false],
    ["broadcast", true],
    ["broadcast", false],
  ])("accepts %s %s", (useKey, enabled) => {
    expect(
      VideoUseToggleInputSchema.safeParse({
        videoId: VIDEO_ID,
        useKey,
        enabled,
      }).success,
    ).toBe(true);
  });

  it.each([
    [{ useKey: "organic_social", enabled: true }],
    [{ useKey: "x", enabled: true }],
    [{ useKey: "paid_social", enabled: "on" }],
  ])("refuses %o", (input) => {
    expect(
      VideoUseToggleInputSchema.safeParse({ videoId: VIDEO_ID, ...input })
        .success,
    ).toBe(false);
  });
});
