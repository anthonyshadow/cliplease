import { describe, expect, it } from "vitest";
import { defaultRateOptions } from "@/lib/pricing/presets";
import {
  effectiveOptions,
  type RateCardDTO,
  type RateCardOption,
} from "./rate-card";

const card = (
  change: (o: RateCardOption) => Partial<RateCardOption> = () => ({}),
): RateCardDTO => ({
  currency: "cad",
  basePriceCents: 15000,
  options: defaultRateOptions().map((o) => {
    const option: RateCardOption = {
      dimension: o.dimension,
      key: o.optionKey,
      enabled: true,
      multiplierBps: o.multiplierBps,
      sortOrder: o.sortOrder,
    };
    return { ...option, ...change(option) };
  }),
});

const NO_VIDEO = { disabledUses: [], basePriceOverrideCents: null };

describe("effectiveOptions (02 §5.5, 07 D82)", () => {
  it("gives the card's options with their buyer labels, on the card's base", () => {
    const options = effectiveOptions(card(), NO_VIDEO);
    expect(options.currency).toBe("cad");
    expect(options.basePriceCents).toBe(15000);
    expect(options.basePriceSource).toBe("rate_card");
    expect(options.use).toEqual([
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
    expect(options.term.map((o) => o.label)).toEqual([
      "30 days",
      "6 months",
      "1 year",
      "Perpetual",
    ]);
    expect(options.territory.map((o) => [o.key, o.bps])).toEqual([
      ["country", 10000],
      ["region", 13000],
      ["worldwide", 17500],
    ]);
  });

  it("uses the video's base override", () => {
    const options = effectiveOptions(card(), {
      disabledUses: [],
      basePriceOverrideCents: 20000,
    });
    expect(options.basePriceCents).toBe(20000);
    expect(options.basePriceSource).toBe("video");
  });

  it("turns off the music-disabled uses with the reason 'music'", () => {
    const options = effectiveOptions(card(), {
      disabledUses: ["paid_social", "broadcast"],
      basePriceOverrideCents: null,
    });
    expect(
      options.use.map((o) => [o.key, o.enabled, o.disabledReason]),
    ).toEqual([
      ["organic_social", true, undefined],
      ["paid_social", false, "music"],
      ["broadcast", false, "music"],
    ]);
  });

  it("says 'creator' for a use off in the card, even when music also applies", () => {
    const options = effectiveOptions(
      card((o) => (o.key === "broadcast" ? { enabled: false } : {})),
      {
        disabledUses: ["paid_social", "broadcast"],
        basePriceOverrideCents: null,
      },
    );
    expect(options.use.find((o) => o.key === "broadcast")).toMatchObject({
      enabled: false,
      disabledReason: "creator",
    });
    expect(options.use.find((o) => o.key === "paid_social")).toMatchObject({
      enabled: false,
      disabledReason: "music",
    });
  });

  it("follows the card alone for terms and territories", () => {
    const options = effectiveOptions(
      card((o) => (o.key === "perpetual" ? { enabled: false } : {})),
      NO_VIDEO,
    );
    expect(options.term.find((o) => o.key === "perpetual")).toEqual({
      key: "perpetual",
      label: "Perpetual",
      bps: 30000,
      enabled: false,
    });
  });
});
