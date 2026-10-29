import { describe, expect, it } from "vitest";
import { rateCardFixture } from "../../../tests/helpers/rate-card-fixtures";
import { effectiveOptions } from "../../server/pricing/rate-card";
import type { RateOptionKey, UseKey } from "../domain/values";
import { formatDelta } from "../format";
import { fromPriceCents } from "../pricing/from-price";
import {
  chosenMultipliers,
  defaultSelection,
  licenseDeltaCents,
  offeredOptions,
  quoteFor,
  repairSelection,
  type Selection,
  scopeLabel,
  territoryInSentence,
  territoryToChoose,
  withOption,
} from "./selection";

const FEE = 1000;
const FEES = { platformFeeBps: FEE, platformFeeMinCents: 200 };
const card = (
  multipliers: Partial<Record<RateOptionKey, number>> = {},
  off: RateOptionKey[] = [],
) =>
  rateCardFixture((o) => ({
    ...(multipliers[o.key] ? { multiplierBps: multipliers[o.key] } : {}),
    ...(off.includes(o.key) ? { enabled: false } : {}),
  }));
const options = (
  c = card(),
  video: { disabledUses?: UseKey[]; basePriceOverrideCents?: number } = {},
) =>
  effectiveOptions(c, {
    disabledUses: video.disabledUses ?? [],
    basePriceOverrideCents: video.basePriceOverrideCents ?? null,
  });

const PAID_YEAR_WORLD: Selection = {
  use: "paid_social",
  term: "y1",
  territory: "worldwide",
  territoryCode: null,
};

describe("quoteFor (07 D79, D82, D97)", () => {
  it("prices Paid social ads · 1 year · Worldwide on the default card", () => {
    expect(quoteFor(options(), PAID_YEAR_WORLD, FEES)).toEqual({
      ok: true,
      quote: {
        currency: "cad",
        licensePriceCents: 157500,
        platformFeeCents: 15750,
        totalCents: 173250,
      },
    });
  });

  it("takes the CA$2.00 fee floor: base CA$10 · Organic · 30 days · One country", () => {
    const quote = quoteFor(
      options(card(), { basePriceOverrideCents: 1000 }),
      {
        use: "organic_social",
        term: "d30",
        territory: "country",
        territoryCode: null,
      },
      FEES,
    );
    expect(quote?.ok && quote.quote).toMatchObject({
      licensePriceCents: 1000,
      platformFeeCents: 200,
      totalCents: 1200,
    });
  });

  it("is null for an option the buyer can't pick (off, or music-disabled)", () => {
    expect(
      quoteFor(options(card({}, ["y1"])), PAID_YEAR_WORLD, FEES),
    ).toBeNull();
    expect(
      quoteFor(
        options(card(), { disabledUses: ["paid_social"] }),
        PAID_YEAR_WORLD,
        FEES,
      ),
    ).toBeNull();
  });
});

describe("licenseDeltaCents (04 §9.3; 05 §4.1): the license price's change", () => {
  it("from Paid social ads · 1 year · Worldwide", () => {
    const delta = (group: "use" | "term" | "territory", key: string) =>
      licenseDeltaCents(options(), PAID_YEAR_WORLD, group, key as never, FEE);
    expect(delta("use", "organic_social")).toBe(-105000);
    expect(delta("use", "broadcast")).toBe(105000);
    expect(delta("term", "d30")).toBe(-78750);
    expect(delta("term", "m6")).toBe(-39375);
    expect(delta("term", "perpetual")).toBe(78750);
    expect(delta("territory", "country")).toBe(-67500);
    expect(delta("territory", "region")).toBe(-40500);
    expect(formatDelta(delta("use", "organic_social") ?? 0, "cad")).toBe(
      "− CA$1,050",
    );
  });

  it("from the first load, Organic social repost · 30 days · One country", () => {
    const first = defaultSelection(options(), FEE);
    expect(first).toEqual({
      use: "organic_social",
      term: "d30",
      territory: "country",
      territoryCode: null,
    });
    if (!first) return;
    const quote = quoteFor(options(), first, FEES);
    expect(quote?.ok && quote.quote.totalCents).toBe(16500);
    const region = licenseDeltaCents(
      options(),
      first,
      "territory",
      "region",
      FEE,
    );
    const worldwide = licenseDeltaCents(
      options(),
      first,
      "territory",
      "worldwide",
      FEE,
    );
    expect([region, worldwide]).toEqual([4500, 11250]);
    expect(formatDelta(region ?? 0, "cad")).toBe("+ CA$45");
    expect(formatDelta(worldwide ?? 0, "cad")).toBe("+ CA$112.50");
    expect(licenseDeltaCents(options(), first, "use", "paid_social", FEE)).toBe(
      30000,
    );
    expect(licenseDeltaCents(options(), first, "term", "y1", FEE)).toBe(15000);
  });

  it("has none for a music-disabled use", () => {
    expect(
      licenseDeltaCents(
        options(card(), { disabledUses: ["paid_social", "broadcast"] }),
        { ...PAID_YEAR_WORLD, use: "organic_social" },
        "use",
        "paid_social",
        FEE,
      ),
    ).toBeNull();
  });
});

describe("offeredOptions (07 D22, D82)", () => {
  it("drops options the creator turned off and keeps music-disabled uses as disabled tiles", () => {
    const tiles = offeredOptions(
      options(card({}, ["region"]), {
        disabledUses: ["paid_social", "broadcast"],
      }),
      {
        use: "organic_social",
        term: "d30",
        territory: "country",
        territoryCode: null,
      },
      FEE,
    );
    expect(tiles.use).toEqual([
      { key: "organic_social", label: "Organic social repost", enabled: true },
      {
        key: "paid_social",
        label: "Paid social ads",
        enabled: false,
        disabledReason: "music",
      },
      {
        key: "broadcast",
        label: "TV / broadcast",
        enabled: false,
        disabledReason: "music",
      },
    ]);
    expect(tiles.territory.map((t) => t.key)).toEqual(["country", "worldwide"]);
  });

  it("hides a tile that would put the total over the cap: base CA$10,000 with ×10.00 Paid ads hides ×10.00 Perpetual", () => {
    const big = options(card({ paid_social: 100000, perpetual: 100000 }), {
      basePriceOverrideCents: 1_000_000,
    });
    const tiles = offeredOptions(
      big,
      {
        use: "paid_social",
        term: "d30",
        territory: "country",
        territoryCode: null,
      },
      FEE,
    );
    expect(tiles.term.map((t) => t.key)).toEqual(["d30", "m6", "y1"]);
  });
});

describe("defaultSelection (01 J7.1)", () => {
  it("never picks a music-disabled use: Organic off on the card and Paid ads music-disabled → TV / broadcast", () => {
    expect(
      defaultSelection(
        options(card({}, ["organic_social"]), {
          disabledUses: ["paid_social"],
        }),
        FEE,
      )?.use,
    ).toBe("broadcast");
  });

  it("takes the first combination under the cap when the first one isn't", () => {
    expect(
      defaultSelection(
        options(card({ organic_social: 100000, d30: 100000 }), {
          basePriceOverrideCents: 1_000_000,
        }),
        FEE,
      ),
    ).toEqual({
      use: "organic_social",
      term: "m6",
      territory: "country",
      territoryCode: null,
    });
  });

  it("is null when nothing fits, exactly when the From price is", () => {
    const tens = Object.fromEntries(
      (
        [
          "organic_social",
          "paid_social",
          "broadcast",
          "d30",
          "m6",
          "y1",
          "perpetual",
          "country",
          "region",
          "worldwide",
        ] as const
      ).map((k) => [k, 100000]),
    );
    const none = options(card(tens), { basePriceOverrideCents: 1_000_000 });
    expect(defaultSelection(none, FEE)).toBeNull();
    expect(fromPriceCents(none, FEE)).toBeNull();
    expect(defaultSelection(options(), FEE)).not.toBeNull();
    expect(fromPriceCents(options(), FEE)).not.toBeNull();
  });
});

describe("chosenMultipliers", () => {
  it("gives the three multipliers a request snapshots, or null for an option the buyer can't pick", () => {
    expect(chosenMultipliers(options(), PAID_YEAR_WORLD)).toEqual({
      useBps: 30000,
      termBps: 20000,
      territoryBps: 17500,
    });
    expect(
      chosenMultipliers(options(card({}, ["paid_social"])), PAID_YEAR_WORLD),
    ).toBeNull();
  });
});

describe("repairSelection (01 J7.10: an option gone after a refresh)", () => {
  it("keeps a choice that is still offered and fits", () => {
    expect(repairSelection(options(), PAID_YEAR_WORLD, FEE)).toEqual({
      selection: PAID_YEAR_WORLD,
      gone: [],
    });
  });

  it("moves a group whose option the creator turned off, or the music rule took, to its first offered option", () => {
    const moved = { ...PAID_YEAR_WORLD, use: "organic_social" };
    expect(
      repairSelection(options(card({}, ["paid_social"])), PAID_YEAR_WORLD, FEE),
    ).toEqual({ selection: moved, gone: ["use"] });
    expect(
      repairSelection(
        options(card(), { disabledUses: ["paid_social"] }),
        PAID_YEAR_WORLD,
        FEE,
      ),
    ).toEqual({ selection: moved, gone: ["use"] });
  });

  it("drops the code with the territory it belonged to", () => {
    const region: Selection = {
      ...PAID_YEAR_WORLD,
      territory: "region",
      territoryCode: "europe",
    };
    expect(repairSelection(options(card({}, ["region"])), region, FEE)).toEqual(
      {
        selection: { ...region, territory: "country", territoryCode: null },
        gone: ["territory"],
      },
    );
  });

  it("falls back to the first load's choice when the choice no longer fits under the cap", () => {
    const big = options(card({ paid_social: 100000, y1: 100000 }), {
      basePriceOverrideCents: 1_000_000,
    });
    const repaired = repairSelection(big, PAID_YEAR_WORLD, FEE);
    expect(repaired.selection).toEqual(defaultSelection(big, FEE));
    expect(repaired.gone).toEqual(["use", "term", "territory"]);
  });
});

describe("withOption and territoryToChoose", () => {
  const country: Selection = {
    use: "organic_social",
    term: "d30",
    territory: "country",
    territoryCode: "FR",
  };

  it("drops the code when the territory changes, and keeps it otherwise", () => {
    expect(withOption(country, "territory", "region").territoryCode).toBeNull();
    expect(withOption(country, "territory", "country").territoryCode).toBe(
      "FR",
    );
    expect(withOption(country, "use", "paid_social")).toEqual({
      ...country,
      use: "paid_social",
    });
  });

  it("asks for a country or region until one is chosen; Worldwide never does", () => {
    expect(territoryToChoose({ ...country, territoryCode: null })).toBe(
      "country",
    );
    expect(
      territoryToChoose({
        ...country,
        territory: "region",
        territoryCode: null,
      }),
    ).toBe("region");
    expect(territoryToChoose(country)).toBeNull();
    expect(
      territoryToChoose({
        ...country,
        territory: "worldwide",
        territoryCode: null,
      }),
    ).toBeNull();
  });
});

describe("scopeLabel and territoryInSentence", () => {
  const scope = {
    useKey: "paid_social",
    termKey: "y1",
    territoryKey: "worldwide",
    territoryCode: null,
  } as const;

  it("labels a license's scope from stored keys", () => {
    expect(scopeLabel(scope)).toBe("Paid social ads · 1 year · Worldwide");
    expect(
      scopeLabel({ ...scope, territoryKey: "country", territoryCode: "FR" }),
    ).toBe("Paid social ads · 1 year · France");
    expect(
      scopeLabel({
        ...scope,
        territoryKey: "region",
        territoryCode: "north_america",
      }),
    ).toBe("Paid social ads · 1 year · North America (US & Canada)");
    expect(
      scopeLabel({ ...scope, territoryKey: "country", territoryCode: null }),
    ).toBe("Paid social ads · 1 year · One country");
    expect(
      scopeLabel({ ...scope, territoryKey: "country", territoryCode: "ZZ" }),
    ).toBe("Paid social ads · 1 year · ZZ");
  });

  it("names the territory for a sentence, with 'the' where English needs it", () => {
    expect(territoryInSentence("country", "US")).toBe("the United States");
    expect(territoryInSentence("country", "FR")).toBe("France");
    expect(territoryInSentence("region", "middle_east_africa")).toBe(
      "the Middle East & Africa",
    );
    expect(territoryInSentence("region", "europe")).toBe("Europe");
    expect(territoryInSentence("country", null)).toBe("one country");
    expect(territoryInSentence("region", null)).toBe("one region");
    expect(territoryInSentence("worldwide", null)).toBe("any country");
  });
});
