import { describe, expect, it } from "vitest";
import { TERM_KEYS, type TermKey } from "../domain/values";
import {
  exclusiveColumnsOf,
  exclusiveModeOf,
  FOLLOWS_RATE_CARD,
  isExclusiveTermKey,
  resolveExclusiveOffer,
} from "./exclusive";

const CARD_OFF = { exclusiveEnabled: false, exclusiveMultiplierBps: 30000 };
const CARD_ON = { exclusiveEnabled: true, exclusiveMultiplierBps: 30000 };
const ALL_TERMS: readonly TermKey[] = TERM_KEYS;

describe("resolveExclusiveOffer (02 §5.5, 07 D109)", () => {
  it.each([
    {
      name: "offers nothing on the default card",
      card: CARD_OFF,
      video: FOLLOWS_RATE_CARD,
      want: { offered: false, multiplierBps: 30000, source: "rate_card" },
    },
    {
      name: "follows the card's switch",
      card: CARD_ON,
      video: FOLLOWS_RATE_CARD,
      want: { offered: true, multiplierBps: 30000, source: "rate_card" },
    },
    {
      name: "lets the video say no to a card that offers it",
      card: CARD_ON,
      video: { exclusiveEnabled: false, exclusiveMultiplierBps: null },
      want: { offered: false, multiplierBps: 30000, source: "video" },
    },
    {
      name: "lets the video offer it on a card that doesn't, at the card's premium",
      card: CARD_OFF,
      video: { exclusiveEnabled: true, exclusiveMultiplierBps: null },
      want: { offered: true, multiplierBps: 30000, source: "video" },
    },
    {
      name: "takes the video's own premium",
      card: CARD_OFF,
      video: { exclusiveEnabled: true, exclusiveMultiplierBps: 40000 },
      want: { offered: true, multiplierBps: 40000, source: "video" },
    },
    {
      name: "takes the card's premium when the video has none",
      card: { exclusiveEnabled: true, exclusiveMultiplierBps: 25000 },
      video: FOLLOWS_RATE_CARD,
      want: { offered: true, multiplierBps: 25000, source: "rate_card" },
    },
  ])("$name", ({ card, video, want }) => {
    expect(resolveExclusiveOffer(card, video, ALL_TERMS)).toEqual(want);
  });

  it("offers nothing with only Perpetual on, even with the video's switch on", () => {
    expect(
      resolveExclusiveOffer(CARD_ON, FOLLOWS_RATE_CARD, ["perpetual"]).offered,
    ).toBe(false);
    expect(
      resolveExclusiveOffer(
        CARD_ON,
        { exclusiveEnabled: true, exclusiveMultiplierBps: null },
        ["perpetual"],
      ).offered,
    ).toBe(false);
  });

  it("offers it with 6 months alone", () => {
    expect(
      resolveExclusiveOffer(CARD_ON, FOLLOWS_RATE_CARD, ["m6"]).offered,
    ).toBe(true);
  });
});

describe("isExclusiveTermKey", () => {
  it.each([
    ["d30", true],
    ["m6", true],
    ["y1", true],
    ["perpetual", false],
  ] as const)("%s → %s", (key, exclusive) => {
    expect(isExclusiveTermKey(key)).toBe(exclusive);
  });
});

describe("the video's mode and its columns (07 D109, D127)", () => {
  it.each([
    [null, "rate_card"],
    [true, "on"],
    [false, "off"],
  ] as const)("exclusive_enabled %s is %s", (enabled, mode) => {
    expect(exclusiveModeOf(enabled)).toBe(mode);
  });

  it("stores 'on' with its premium, or none for the card's", () => {
    expect(exclusiveColumnsOf("on", 40000)).toEqual({
      exclusiveEnabled: true,
      exclusiveMultiplierBps: 40000,
    });
    expect(exclusiveColumnsOf("on", null)).toEqual({
      exclusiveEnabled: true,
      exclusiveMultiplierBps: null,
    });
  });

  it("stores 'off' and 'rate_card' without a premium, whatever is passed", () => {
    expect(exclusiveColumnsOf("off", 40000)).toEqual({
      exclusiveEnabled: false,
      exclusiveMultiplierBps: null,
    });
    expect(exclusiveColumnsOf("rate_card", 40000)).toEqual(FOLLOWS_RATE_CARD);
    expect(exclusiveColumnsOf("rate_card", null)).toEqual({
      exclusiveEnabled: null,
      exclusiveMultiplierBps: null,
    });
  });

  it("reads back the mode it stored", () => {
    for (const mode of ["rate_card", "on", "off"] as const) {
      expect(
        exclusiveModeOf(exclusiveColumnsOf(mode, null).exclusiveEnabled),
      ).toBe(mode);
    }
  });
});
