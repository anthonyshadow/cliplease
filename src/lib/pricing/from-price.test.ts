import { describe, expect, it } from "vitest";
import { rateCardFixture } from "../../../tests/helpers/rate-card-fixtures";
import { effectiveOptions } from "../../server/pricing/rate-card";
import { fromPriceCents } from "./from-price";

const FEE_BPS = 1000;
const NO_VIDEO = { disabledUses: [], basePriceOverrideCents: null };

describe("fromPriceCents (04 §9.27; 07 D82, D97)", () => {
  it("is the base price on the default card, with music, and the video's own base when it has one", () => {
    expect(
      fromPriceCents(effectiveOptions(rateCardFixture(), NO_VIDEO), FEE_BPS),
    ).toBe(15000);
    expect(
      fromPriceCents(
        effectiveOptions(rateCardFixture(), {
          disabledUses: ["paid_social", "broadcast"],
          basePriceOverrideCents: null,
        }),
        FEE_BPS,
      ),
    ).toBe(15000);
    expect(
      fromPriceCents(
        effectiveOptions(rateCardFixture(), {
          disabledUses: [],
          basePriceOverrideCents: 20000,
        }),
        FEE_BPS,
      ),
    ).toBe(20000);
  });

  it("takes each group's cheapest enabled option, not its first", () => {
    // Organic social (first) at ×3.00, paid social at ×1.50: CA$150 × 1.50.
    const card = rateCardFixture((o) =>
      o.key === "organic_social"
        ? { multiplierBps: 30000 }
        : o.key === "paid_social"
          ? { multiplierBps: 15000 }
          : {},
    );
    expect(fromPriceCents(effectiveOptions(card, NO_VIDEO), FEE_BPS)).toBe(
      22500,
    );
  });

  it("is null when every combination is over the cap, or a group has nothing on", () => {
    const tooDear = effectiveOptions(
      rateCardFixture(() => ({ multiplierBps: 100000 })),
      { disabledUses: [], basePriceOverrideCents: 1_000_000 },
    );
    expect(fromPriceCents(tooDear, FEE_BPS)).toBeNull();
    const noUse = effectiveOptions(
      rateCardFixture((o) =>
        o.dimension === "use" && o.key !== "paid_social"
          ? { enabled: false }
          : {},
      ),
      {
        disabledUses: ["paid_social", "broadcast"],
        basePriceOverrideCents: null,
      },
    );
    expect(fromPriceCents(noUse, FEE_BPS)).toBeNull();
  });
});
