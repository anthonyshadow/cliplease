import { describe, expect, it } from "vitest";
import {
  RATE_OPTION_KEYS,
  REGION_KEYS,
  TERM_KEYS,
  TERRITORY_KEYS,
  USE_KEYS,
} from "../domain/values";
import {
  REGIONS,
  rateOptionLabel,
  TERM_OPTIONS,
  TERRITORY_OPTIONS,
  USE_OPTIONS,
} from "./options";

describe("buyer labels (research/license.md §2, 07 D04)", () => {
  it("label every key of values.ts, and nothing else", () => {
    expect(Object.keys(USE_OPTIONS)).toEqual([...USE_KEYS]);
    expect(Object.keys(TERM_OPTIONS)).toEqual([...TERM_KEYS]);
    expect(Object.keys(TERRITORY_OPTIONS)).toEqual([...TERRITORY_KEYS]);
    expect(Object.keys(REGIONS)).toEqual([...REGION_KEYS]);
  });

  it("are the research labels", () => {
    expect(RATE_OPTION_KEYS.map(rateOptionLabel)).toEqual([
      "Organic social repost",
      "Paid social ads",
      "TV / broadcast",
      "30 days",
      "6 months",
      "1 year",
      "Perpetual",
      "One country",
      "One region",
      "Worldwide",
    ]);
    expect(Object.values(REGIONS).map((r) => r.label)).toEqual([
      "North America (US & Canada)",
      "Latin America & Caribbean",
      "Europe",
      "Middle East & Africa",
      "Asia-Pacific",
    ]);
  });
});
