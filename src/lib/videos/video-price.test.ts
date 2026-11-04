import { describe, expect, it } from "vitest";
import { effectiveOptions } from "@/server/pricing/rate-card";
import {
  NO_VIDEO,
  rateCardFixture,
} from "../../../tests/helpers/rate-card-fixtures";
import { MUSIC_DISABLED_USES, type MusicUseKey } from "./rights";
import { musicSwitches, VIDEO_PRICE_COPY } from "./video-price";

const optionsOf = (
  disabledUses: readonly MusicUseKey[],
  cardOff: readonly MusicUseKey[] = [],
) =>
  effectiveOptions(
    rateCardFixture((o) =>
      cardOff.some((key) => key === o.key) ? { enabled: false } : {},
    ),
    { ...NO_VIDEO, disabledUses },
  );

describe("musicSwitches (07 D82; owner answer Q-158)", () => {
  it("gives both off for music Yes as attested", () => {
    expect(musicSwitches(optionsOf(MUSIC_DISABLED_USES), true)).toEqual([
      { key: "paid_social", on: false },
      { key: "broadcast", on: false },
    ]);
  });

  it("gives a use turned back on as on", () => {
    expect(musicSwitches(optionsOf(["broadcast"]), true)).toEqual([
      { key: "paid_social", on: true },
      { key: "broadcast", on: false },
    ]);
  });

  it.each([false, null])(
    "gives both off while the stored answer is %s",
    (stored) => {
      expect(musicSwitches(optionsOf([]), stored)).toEqual([
        { key: "paid_social", on: false },
        { key: "broadcast", on: false },
      ]);
    },
  );

  it("leaves out a use off on the rate card", () => {
    expect(
      musicSwitches(optionsOf(MUSIC_DISABLED_USES, ["broadcast"]), true),
    ).toEqual([{ key: "paid_social", on: false }]);
  });
});

describe("VIDEO_PRICE_COPY (04 §9.29, §11.10)", () => {
  it("names each Switch by its use and the rate card by its base", () => {
    expect(MUSIC_DISABLED_USES.map(VIDEO_PRICE_COPY.allowAnyway)).toEqual([
      "Allow Paid social ads anyway",
      "Allow TV / broadcast anyway",
    ]);
    expect(VIDEO_PRICE_COPY.useRateCard("CA$150")).toBe(
      "Use my rate card (CA$150)",
    );
  });
});
