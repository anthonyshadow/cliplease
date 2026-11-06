import { describe, expect, it } from "vitest";
import {
  NO_VIDEO,
  rateCardFixture,
} from "../../../tests/helpers/rate-card-fixtures";
import {
  type EffectiveOptions,
  effectiveOptions,
  type VideoPricing,
} from "../../server/pricing/rate-card";
import type { RateDimension, RateOptionKey } from "../domain/values";
import { formatDelta } from "../format";
import { fromPriceCents } from "../pricing/from-price";
import { MAX_TOTAL_CENTS } from "../pricing/presets";
import {
  chosenMultipliers,
  defaultSelection,
  licenseDeltaCents,
  licenseLineLabel,
  licenseTypeOptions,
  offeredOptions,
  quoteFor,
  repairSelection,
  type Selection,
  scopeLabel,
  selectLicenseType,
  type TileKeys,
  termMovedMessage,
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
const options = (c = card(), video: Partial<VideoPricing> = {}) =>
  effectiveOptions(c, { ...NO_VIDEO, ...video });

const PAID_YEAR_WORLD: Selection = {
  use: "paid_social",
  term: "y1",
  territory: "worldwide",
  territoryCode: null,
  exclusive: false,
};
const PAID_PERPETUAL_WORLD: Selection = {
  ...PAID_YEAR_WORLD,
  term: "perpetual",
};
const EXCLUSIVE_YEAR: Selection = { ...PAID_YEAR_WORLD, exclusive: true };
const AVAILABLE = { canRequestExclusive: true };
const UNAVAILABLE = { canRequestExclusive: false };

const offeringCard = (off: RateOptionKey[], exclusiveMultiplierBps = 30000) =>
  rateCardFixture((o) => (off.includes(o.key) ? { enabled: false } : {}), {
    exclusiveEnabled: true,
    exclusiveMultiplierBps,
  });
/** The default card with the exclusive offer on at ×3.00 and `off` turned off (07 D109). */
const offering = (...off: RateOptionKey[]) => options(offeringCard(off));
/** CA$10,000 at a ×10.00 premium: Paid social ads · 1 year · Worldwide fits as Standard, not as Exclusive (07 D22). */
const overCapWhenExclusive = (...off: RateOptionKey[]) =>
  options(offeringCard(off, 100000), { basePriceOverrideCents: 1_000_000 });
/** A tile's delta as it prints, or null when it has none. */
const deltaOf = <G extends RateDimension | "type">(
  o: EffectiveOptions,
  selection: Selection,
  group: G,
  key: TileKeys[G],
) => {
  const cents = licenseDeltaCents(o, selection, group, key, FEE);
  return cents === null ? null : formatDelta(cents, "cad");
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

  it("stays the standard price with the exclusive offer on at ×10.00 (07 D109)", () => {
    const offering = rateCardFixture(undefined, {
      exclusiveEnabled: true,
      exclusiveMultiplierBps: 100000,
    });
    expect(quoteFor(options(offering), PAID_YEAR_WORLD, FEES)).toEqual({
      ok: true,
      quote: {
        currency: "cad",
        licensePriceCents: 157500,
        platformFeeCents: 15750,
        totalCents: 173250,
      },
    });
  });

  it("prices Exclusive with the premium at ×3.00: 472500 / 47250 / 519750", () => {
    expect(quoteFor(offering(), EXCLUSIVE_YEAR, FEES)).toEqual({
      ok: true,
      quote: {
        currency: "cad",
        licensePriceCents: 472500,
        platformFeeCents: 47250,
        totalCents: 519750,
      },
    });
  });

  it("prices Exclusive with a video's own ×2.00 premium: 315000 / 31500 / 346500", () => {
    expect(
      quoteFor(
        options(offeringCard([]), {
          exclusiveEnabled: true,
          exclusiveMultiplierBps: 20000,
        }),
        EXCLUSIVE_YEAR,
        FEES,
      ),
    ).toEqual({
      ok: true,
      quote: {
        currency: "cad",
        licensePriceCents: 315000,
        platformFeeCents: 31500,
        totalCents: 346500,
      },
    });
  });

  it("prices it from a video's own CA$300 base (07 D82): 315000 / 31500 / 346500", () => {
    expect(
      quoteFor(
        options(card(), { basePriceOverrideCents: 30000 }),
        PAID_YEAR_WORLD,
        FEES,
      ),
    ).toEqual({
      ok: true,
      quote: {
        currency: "cad",
        licensePriceCents: 315000,
        platformFeeCents: 31500,
        totalCents: 346500,
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
        exclusive: false,
      },
      FEES,
    );
    expect(quote?.ok && quote.quote).toMatchObject({
      licensePriceCents: 1000,
      platformFeeCents: 200,
      totalCents: 1200,
    });
  });

  it("is null for an exclusive term an exclusive license can't last (07 D112)", () => {
    expect(
      quoteFor(offering(), { ...PAID_PERPETUAL_WORLD, exclusive: true }, FEES),
    ).toBeNull();
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
      exclusive: false,
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
        exclusive: false,
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

  it("offers a re-enabled Paid social ads as an ordinary tile while TV / broadcast stays music-disabled (01 J7.4, J5.14)", () => {
    const tiles = offeredOptions(
      options(card(), { disabledUses: ["broadcast"] }),
      PAID_YEAR_WORLD,
      FEE,
    );
    expect(tiles.use).toEqual([
      { key: "organic_social", label: "Organic social repost", enabled: true },
      { key: "paid_social", label: "Paid social ads", enabled: true },
      {
        key: "broadcast",
        label: "TV / broadcast",
        enabled: false,
        disabledReason: "music",
      },
    ]);
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
        exclusive: false,
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
      exclusive: false,
    });
  });

  it("never pre-selects Exclusive, even when it is offered", () => {
    expect(defaultSelection(offering(), FEE)?.exclusive).toBe(false);
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
    expect(repairSelection(options(), PAID_YEAR_WORLD, AVAILABLE, FEE)).toEqual(
      {
        selection: PAID_YEAR_WORLD,
        gone: [],
      },
    );
  });

  it("moves a group whose option the creator turned off, or the music rule took, to its first offered option", () => {
    const moved = { ...PAID_YEAR_WORLD, use: "organic_social" };
    expect(
      repairSelection(
        options(card({}, ["paid_social"])),
        PAID_YEAR_WORLD,
        AVAILABLE,
        FEE,
      ),
    ).toEqual({ selection: moved, gone: ["use"] });
    expect(
      repairSelection(
        options(card(), { disabledUses: ["paid_social"] }),
        PAID_YEAR_WORLD,
        AVAILABLE,
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
    expect(
      repairSelection(options(card({}, ["region"])), region, AVAILABLE, FEE),
    ).toEqual({
      selection: { ...region, territory: "country", territoryCode: null },
      gone: ["territory"],
    });
  });

  it("falls back to the first load's choice when the choice no longer fits under the cap", () => {
    const big = options(card({ paid_social: 100000, y1: 100000 }), {
      basePriceOverrideCents: 1_000_000,
    });
    const repaired = repairSelection(big, PAID_YEAR_WORLD, AVAILABLE, FEE);
    expect(repaired.selection).toEqual(defaultSelection(big, FEE));
    expect(repaired.gone).toEqual(["use", "term", "territory"]);
  });

  it("keeps the buyer's country through that fallback when the first load's choice keeps their territory", () => {
    const big = options(card({ paid_social: 100000, y1: 100000 }), {
      basePriceOverrideCents: 1_000_000,
    });
    const france: Selection = {
      ...PAID_YEAR_WORLD,
      territory: "country",
      territoryCode: "FR",
    };
    const first = defaultSelection(big, FEE);
    expect(first?.territory).toBe("country");
    expect(repairSelection(big, france, AVAILABLE, FEE)).toEqual({
      selection: { ...first, territoryCode: "FR" },
      gone: ["use", "term"],
    });
  });
});

describe("repairSelection with Exclusive (07 D110)", () => {
  it("drops an Exclusive the video can't take any more, keeping the other choices", () => {
    expect(
      repairSelection(offering(), EXCLUSIVE_YEAR, UNAVAILABLE, FEE),
    ).toEqual({ selection: PAID_YEAR_WORLD, gone: ["exclusive"] });
  });

  it("does the same when the creator turned the offer off", () => {
    const offerOff = options();
    expect(offerOff.exclusive.offered).toBe(false);
    expect(repairSelection(offerOff, EXCLUSIVE_YEAR, UNAVAILABLE, FEE)).toEqual(
      { selection: PAID_YEAR_WORLD, gone: ["exclusive"] },
    );
  });

  it("drops an Exclusive whose premium is over the cap now", () => {
    expect(
      repairSelection(overCapWhenExclusive(), EXCLUSIVE_YEAR, AVAILABLE, FEE),
    ).toEqual({ selection: PAID_YEAR_WORLD, gone: ["exclusive"] });
  });

  it("moves a term that is gone to the first exclusive term on, and stays exclusive", () => {
    expect(
      repairSelection(offering("y1"), EXCLUSIVE_YEAR, AVAILABLE, FEE),
    ).toEqual({
      selection: { ...EXCLUSIVE_YEAR, term: "d30" },
      gone: ["term"],
    });
    expect(
      repairSelection(offering("d30", "y1"), EXCLUSIVE_YEAR, AVAILABLE, FEE),
    ).toEqual({
      selection: { ...EXCLUSIVE_YEAR, term: "m6" },
      gone: ["term"],
    });
  });

  it("drops Exclusive when the only term left is Perpetual", () => {
    expect(
      repairSelection(
        offering("d30", "m6", "y1"),
        EXCLUSIVE_YEAR,
        AVAILABLE,
        FEE,
      ),
    ).toEqual({
      selection: PAID_PERPETUAL_WORLD,
      gone: ["term", "exclusive"],
    });
  });

  it("falls back to the first load's choice when Standard doesn't fit either", () => {
    const big = options(
      rateCardFixture(
        (o) =>
          o.key === "paid_social" || o.key === "y1"
            ? { multiplierBps: 100000 }
            : {},
        { exclusiveEnabled: true },
      ),
      { basePriceOverrideCents: 1_000_000 },
    );
    const repaired = repairSelection(big, EXCLUSIVE_YEAR, AVAILABLE, FEE);
    expect(repaired.selection).toEqual(defaultSelection(big, FEE));
    expect(repaired.gone).toEqual(["use", "term", "territory", "exclusive"]);
  });

  it("leaves an Exclusive that is available and fits", () => {
    expect(repairSelection(offering(), EXCLUSIVE_YEAR, AVAILABLE, FEE)).toEqual(
      { selection: EXCLUSIVE_YEAR, gone: [] },
    );
  });
});

describe("licenseDeltaCents with the License type group (04 §9.35)", () => {
  it("prices Exclusive from Standard and Standard from Exclusive", () => {
    expect(deltaOf(offering(), PAID_YEAR_WORLD, "type", "exclusive")).toBe(
      "+ CA$3,150",
    );
    expect(deltaOf(offering(), EXCLUSIVE_YEAR, "type", "standard")).toBe(
      "− CA$3,150",
    );
  });

  it("carries the premium through the Term deltas, and Perpetual has none", () => {
    expect(deltaOf(offering(), EXCLUSIVE_YEAR, "term", "d30")).toBe(
      "− CA$2,362.50",
    );
    expect(deltaOf(offering(), EXCLUSIVE_YEAR, "term", "m6")).toBe(
      "− CA$1,181.25",
    );
    expect(deltaOf(offering(), EXCLUSIVE_YEAR, "term", "perpetual")).toBeNull();
  });

  it("includes the term move in Exclusive's delta from Perpetual", () => {
    expect(deltaOf(offering(), PAID_PERPETUAL_WORLD, "type", "exclusive")).toBe(
      "+ CA$2,362.50",
    );
    expect(
      deltaOf(offering("y1"), PAID_PERPETUAL_WORLD, "type", "exclusive"),
    ).toBe("+ CA$1,181.25");
  });
});

describe("offeredOptions with Exclusive (07 D22, D112)", () => {
  it("disables Perpetual with its reason", () => {
    expect(offeredOptions(offering(), EXCLUSIVE_YEAR, FEE).term).toEqual([
      { key: "d30", label: "30 days", enabled: true },
      { key: "m6", label: "6 months", enabled: true },
      { key: "y1", label: "1 year", enabled: true },
      {
        key: "perpetual",
        label: "Perpetual",
        enabled: false,
        disabledReason: "exclusive_term",
      },
    ]);
  });

  it("limits the Term group only: every Use and Territory tile stays enabled", () => {
    const { use, territory } = offeredOptions(offering(), EXCLUSIVE_YEAR, FEE);
    expect(use.map((t) => t.key)).toEqual([
      "organic_social",
      "paid_social",
      "broadcast",
    ]);
    expect(territory.map((t) => t.key)).toEqual([
      "country",
      "region",
      "worldwide",
    ]);
    for (const tile of [...use, ...territory]) {
      expect(tile.enabled).toBe(true);
      expect(tile).not.toHaveProperty("disabledReason");
    }
  });

  it("leaves a Perpetual turned off on the card absent, not disabled", () => {
    expect(
      offeredOptions(offering("perpetual"), EXCLUSIVE_YEAR, FEE).term.map(
        (t) => t.key,
      ),
    ).toEqual(["d30", "m6", "y1"]);
  });

  it("hides a term the premium puts over the cap; Perpetual stays disabled whatever the cap says", () => {
    const selection = { ...EXCLUSIVE_YEAR, term: "d30" } as const;
    const { term } = offeredOptions(overCapWhenExclusive(), selection, FEE);
    expect(term.map((t) => [t.key, t.enabled])).toEqual([
      ["d30", true],
      ["m6", true],
      ["perpetual", false],
    ]);
  });

  it("keeps Perpetual an ordinary tile on a standard selection", () => {
    expect(
      offeredOptions(offering(), PAID_YEAR_WORLD, FEE).term.at(-1),
    ).toEqual({ key: "perpetual", label: "Perpetual", enabled: true });
  });
});

describe("selectLicenseType (OQ-57; 04 §9.35)", () => {
  it("moves Perpetual to 1 year and says so: 472500 / 47250 / 519750", () => {
    const { selection, movedTermKey } = selectLicenseType(
      offering(),
      PAID_PERPETUAL_WORLD,
      true,
    );
    expect(selection).toEqual(EXCLUSIVE_YEAR);
    expect(movedTermKey).toBe("y1");
    expect(quoteFor(offering(), selection, FEES)).toEqual({
      ok: true,
      quote: {
        currency: "cad",
        licensePriceCents: 472500,
        platformFeeCents: 47250,
        totalCents: 519750,
      },
    });
  });

  it("keeps an exclusive term", () => {
    expect(
      selectLicenseType(offering(), { ...PAID_YEAR_WORLD, term: "m6" }, true),
    ).toEqual({
      selection: { ...EXCLUSIVE_YEAR, term: "m6" },
      movedTermKey: null,
    });
  });

  it("keeps 1 year back on Standard, and Perpetual is a plain tile again", () => {
    const { selection, movedTermKey } = selectLicenseType(
      offering(),
      EXCLUSIVE_YEAR,
      false,
    );
    expect(selection).toEqual(PAID_YEAR_WORLD);
    expect(movedTermKey).toBeNull();
    const perpetual = offeredOptions(offering(), selection, FEE).term.find(
      (t) => t.key === "perpetual",
    );
    expect(perpetual).not.toHaveProperty("disabledReason");
  });

  it("never moves the term on Standard: Perpetual stays, and Standard's delta is 0", () => {
    expect(selectLicenseType(offering(), PAID_PERPETUAL_WORLD, false)).toEqual({
      selection: PAID_PERPETUAL_WORLD,
      movedTermKey: null,
    });
    expect(
      licenseDeltaCents(
        offering(),
        PAID_PERPETUAL_WORLD,
        "type",
        "standard",
        FEE,
      ),
    ).toBe(0);
  });

  it("lands on the longest exclusive term on", () => {
    const moved = selectLicenseType(offering("y1"), PAID_PERPETUAL_WORLD, true);
    expect(moved.movedTermKey).toBe("m6");
    expect(moved.selection.term).toBe("m6");
    const quote = quoteFor(offering("y1"), moved.selection, FEES);
    expect(quote?.ok && quote.quote.licensePriceCents).toBe(354375);
    expect(
      selectLicenseType(offering("y1", "m6"), PAID_PERPETUAL_WORLD, true)
        .movedTermKey,
    ).toBe("d30");
  });

  it("counts a 1 year that is on but over the cap as the longest", () => {
    expect(
      selectLicenseType(overCapWhenExclusive(), PAID_PERPETUAL_WORLD, true)
        .movedTermKey,
    ).toBe("y1");
  });
});

describe("termMovedMessage (04 §11.2; owner answer Q-168)", () => {
  it("says which term the live region moved to", () => {
    expect(termMovedMessage("1 year")).toBe(
      "Term changed to 1 year. Exclusive licenses last up to 1 year.",
    );
    expect(termMovedMessage("6 months")).toBe(
      "Term changed to 6 months. Exclusive licenses last up to 1 year.",
    );
  });
});

describe("licenseTypeOptions (07 D22, D110)", () => {
  const STANDARD = { key: "standard", enabled: true };
  const EXCLUSIVE = { key: "exclusive", enabled: true };
  const NOT_AVAILABLE = {
    key: "exclusive",
    enabled: false,
    disabledReason: "availability",
  };

  it("is empty unless the creator offers exclusive licenses", () => {
    expect(
      licenseTypeOptions(options(), PAID_YEAR_WORLD, AVAILABLE, FEE),
    ).toEqual([]);
  });

  it("offers both on a video that can take one", () => {
    expect(
      licenseTypeOptions(offering(), PAID_YEAR_WORLD, AVAILABLE, FEE),
    ).toEqual([STANDARD, EXCLUSIVE]);
  });

  it("disables Exclusive while the video can't take one", () => {
    expect(
      licenseTypeOptions(offering(), PAID_YEAR_WORLD, UNAVAILABLE, FEE),
    ).toEqual([STANDARD, NOT_AVAILABLE]);
  });

  it("hides an Exclusive over the cap", () => {
    const big = overCapWhenExclusive();
    const standardTotal = 10_500_000 + 1_050_000;
    const exclusiveTotal = 105_000_000 + 10_500_000;
    expect(standardTotal).toBeLessThanOrEqual(MAX_TOTAL_CENTS.cad);
    expect(exclusiveTotal).toBeGreaterThan(MAX_TOTAL_CENTS.cad);
    const standard = quoteFor(big, PAID_YEAR_WORLD, FEES);
    expect(standard?.ok && standard.quote.totalCents).toBe(standardTotal);
    expect(quoteFor(big, EXCLUSIVE_YEAR, FEES)?.ok).toBe(false);
    expect(licenseTypeOptions(big, PAID_YEAR_WORLD, AVAILABLE, FEE)).toEqual([
      STANDARD,
    ]);
  });

  it("judges the cap after the term move", () => {
    expect(
      licenseTypeOptions(
        overCapWhenExclusive(),
        PAID_PERPETUAL_WORLD,
        AVAILABLE,
        FEE,
      ),
    ).toEqual([STANDARD]);
    expect(
      licenseTypeOptions(
        overCapWhenExclusive("y1"),
        PAID_PERPETUAL_WORLD,
        AVAILABLE,
        FEE,
      ),
    ).toEqual([STANDARD, EXCLUSIVE]);
  });

  it("disables, not hides, an Exclusive both unavailable and over the cap", () => {
    expect(
      licenseTypeOptions(
        overCapWhenExclusive(),
        PAID_YEAR_WORLD,
        UNAVAILABLE,
        FEE,
      ),
    ).toEqual([STANDARD, NOT_AVAILABLE]);
  });
});

describe("licenseLineLabel (07 D113)", () => {
  const line = {
    title: "First snow",
    scopeLabel: "Paid social ads · 1 year · Worldwide",
  };

  it("labels both kinds of license", () => {
    expect(licenseLineLabel({ ...line, exclusive: false })).toBe(
      "First snow · Paid social ads · 1 year · Worldwide",
    );
    expect(licenseLineLabel({ ...line, exclusive: true })).toBe(
      "Exclusive license · First snow · Paid social ads · 1 year · Worldwide",
    );
  });
});

describe("withOption and territoryToChoose", () => {
  const country: Selection = {
    use: "organic_social",
    term: "d30",
    territory: "country",
    territoryCode: "FR",
    exclusive: false,
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
