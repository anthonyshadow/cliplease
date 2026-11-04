import { describe, expect, it } from "vitest";
import {
  examplePriceCents,
  exclusiveExamplePriceCents,
  rateChoices,
} from "./choices";
import { defaultRateOptions } from "./presets";

const defaults = () =>
  defaultRateOptions().map((o) => ({
    key: o.optionKey,
    multiplierBps: o.multiplierBps,
    enabled: o.enabled,
  }));

describe("rateChoices", () => {
  it("groups the options in the card's order, with their buyer labels", () => {
    const { use, term, territory } = rateChoices(defaults());
    expect(use).toEqual([
      {
        key: "organic_social",
        label: "Organic social repost",
        bps: 10000,
        enabled: true,
      },
      {
        key: "paid_social",
        label: "Paid social ads",
        bps: 30000,
        enabled: true,
      },
      { key: "broadcast", label: "TV / broadcast", bps: 50000, enabled: true },
    ]);
    expect(term.map((c) => c.key)).toEqual(["d30", "m6", "y1", "perpetual"]);
    expect(territory.map((c) => c.key)).toEqual([
      "country",
      "region",
      "worldwide",
    ]);
  });
});

describe("examplePriceCents (04 §9.29)", () => {
  const choices = rateChoices(defaults());

  it("pairs an option with the first of each other group, at a CA$150 base (P12's acceptance prices)", () => {
    expect(examplePriceCents(15000, choices, "use", 30000)).toBe(45000);
    expect(examplePriceCents(15000, choices, "term", 20000)).toBe(30000);
    expect(examplePriceCents(15000, choices, "territory", 17500)).toBe(26250);
  });

  it("skips the options switched off", () => {
    const offs = new Set(["d30", "m6"]);
    const some = rateChoices(
      defaults().map((o) => (offs.has(o.key) ? { ...o, enabled: false } : o)),
    );
    expect(examplePriceCents(15000, some, "use", 30000)).toBe(90000);
  });

  it("gives none while another group has nothing on", () => {
    const noTerms = rateChoices(
      defaults().map((o) =>
        ["d30", "m6", "y1", "perpetual"].includes(o.key)
          ? { ...o, enabled: false }
          : o,
      ),
    );
    expect(examplePriceCents(15000, noTerms, "use", 30000)).toBeNull();
    expect(examplePriceCents(15000, noTerms, "term", 20000)).toBe(30000);
  });
});

describe("exclusiveExamplePriceCents (04 §9.29, 05 §6.9)", () => {
  const without = (...keys: string[]) =>
    rateChoices(
      defaults().map((o) =>
        keys.includes(o.key) ? { ...o, enabled: false } : o,
      ),
    );

  it("pairs the premium with the first of each group, at a CA$150 base", () => {
    expect(exclusiveExamplePriceCents(15000, without(), 30000)).toBe(45000);
    expect(exclusiveExamplePriceCents(15000, without(), 40000)).toBe(60000);
  });

  it("takes the first 30-day, 6-month or 1-year term on", () => {
    expect(exclusiveExamplePriceCents(15000, without("d30"), 30000)).toBe(
      67500,
    );
  });

  it("gives none with only Perpetual on", () => {
    expect(
      exclusiveExamplePriceCents(15000, without("d30", "m6", "y1"), 30000),
    ).toBeNull();
  });

  it("gives none while a group has nothing on", () => {
    expect(
      exclusiveExamplePriceCents(
        15000,
        without("organic_social", "paid_social", "broadcast"),
        30000,
      ),
    ).toBeNull();
    expect(
      exclusiveExamplePriceCents(
        15000,
        without("country", "region", "worldwide"),
        30000,
      ),
    ).toBeNull();
  });
});
