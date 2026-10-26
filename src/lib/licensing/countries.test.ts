import { describe, expect, it } from "vitest";
import { REGION_KEYS } from "../domain/values";
import {
  COUNTRIES,
  countryInSentence,
  countryName,
  countryNamesIn,
  countryOf,
} from "./countries";

describe("COUNTRIES (01 §4.3; research/license.md §2.3; owner answers Q-106 b, Q-107 a)", () => {
  it("lists every ISO 3166-1 code but Antarctica once, with a unique name", () => {
    expect(COUNTRIES).toHaveLength(248);
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(248);
    expect(codes.every((code) => /^[A-Z]{2}$/.test(code))).toBe(true);
    expect(new Set(COUNTRIES.map((c) => c.name)).size).toBe(248);
    expect(countryOf("AQ")).toBeUndefined();
  });

  it("is stored in English alphabetical order, so the server and the browser list it alike", () => {
    const names = COUNTRIES.map((c) => c.name);
    expect(names).toEqual([...names].sort(new Intl.Collator("en").compare));
  });

  it("puts each country in its UN M49 region, North America being the US and Canada", () => {
    const count = (region: string | null) =>
      COUNTRIES.filter((c) => c.region === region).length;
    expect(REGION_KEYS.map(count)).toEqual([2, 52, 51, 78, 62]);
    expect(count(null)).toBe(3);
    const region = (code: string) => countryOf(code)?.region;
    expect([region("US"), region("CA")]).toEqual([
      "north_america",
      "north_america",
    ]);
    expect(region("MX")).toBe("latam_caribbean");
    expect(region("GB")).toBe("europe");
    expect(region("TR")).toBe("middle_east_africa");
    expect([region("JP"), region("AU"), region("TW")]).toEqual([
      "asia_pacific",
      "asia_pacific",
      "asia_pacific",
    ]);
    expect([region("BM"), region("GL"), region("PM")]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("names a code, a stored code it doesn't list as itself, and a sentence's country with 'the'", () => {
    expect(countryName("FR")).toBe("France");
    expect(countryName("ZZ")).toBe("ZZ");
    expect(countryInSentence("US")).toBe("the United States");
    expect(countryInSentence("GB")).toBe("the United Kingdom");
    expect(countryInSentence("FR")).toBe("France");
  });

  it("lists a region's names for Which countries?", () => {
    expect(countryNamesIn("north_america")).toEqual([
      "Canada",
      "United States",
    ]);
    expect(
      REGION_KEYS.flatMap((region) => countryNamesIn(region)),
    ).toHaveLength(245);
  });
});
