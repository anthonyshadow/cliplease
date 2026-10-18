import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CURRENCIES, RATE_OPTION_KEYS } from "../domain/values";
import {
  BASE_PRICE_MAX_CENTS,
  BASE_PRICE_MIN_CENTS,
  DEFAULT_BASE_PRICE_CENTS,
  DEFAULT_OPTIONS,
  defaultRateOptions,
  MAX_TOTAL_CENTS,
  MULTIPLIER_MAX_BPS,
  MULTIPLIER_MIN_BPS,
  MULTIPLIER_STEP_BPS,
} from "./presets";

// The CHECK literals the money maps must equal (07 D97), read from the migration, so a divergence fails here first.
const migration = readFileSync("drizzle/0000_init.sql", "utf8");
function checkRange(name: string): [number, number] {
  const match = new RegExp(
    `"${name}" CHECK \\([^)]*?between (\\d+) and (\\d+)`,
  ).exec(migration);
  if (!match) throw new Error(`CHECK ${name} not found`);
  return [Number(match[1]), Number(match[2])];
}

describe("presets (02 §5.5, brief §5, 07 D97)", () => {
  it("are the brief §5 presets", () => {
    expect(DEFAULT_OPTIONS).toEqual({
      use: { organic_social: 10000, paid_social: 30000, broadcast: 50000 },
      term: { d30: 10000, m6: 15000, y1: 20000, perpetual: 30000 },
      territory: { country: 10000, region: 13000, worldwide: 17500 },
    });
    for (const currency of CURRENCIES) {
      expect(DEFAULT_BASE_PRICE_CENTS[currency]).toBe(15000);
    }
  });

  it("give 10 enabled default options in 03 §8.1's order", () => {
    const rows = defaultRateOptions();
    expect(rows.map((r) => r.optionKey)).toEqual([...RATE_OPTION_KEYS]);
    expect(rows.map((r) => `${r.dimension}:${r.sortOrder}`)).toEqual([
      "use:0",
      "use:1",
      "use:2",
      "term:0",
      "term:1",
      "term:2",
      "term:3",
      "territory:0",
      "territory:1",
      "territory:2",
    ]);
    for (const row of rows) {
      expect(row.enabled).toBe(true);
      expect(row.multiplierBps).toBe(
        (DEFAULT_OPTIONS[row.dimension] as Record<string, number>)[
          row.optionKey
        ],
      );
    }
  });

  it("keep every multiplier in bounds and on a 500 bps step", () => {
    for (const row of defaultRateOptions()) {
      expect(row.multiplierBps).toBeGreaterThanOrEqual(MULTIPLIER_MIN_BPS);
      expect(row.multiplierBps).toBeLessThanOrEqual(MULTIPLIER_MAX_BPS);
      expect(row.multiplierBps % MULTIPLIER_STEP_BPS).toBe(0);
    }
    expect(checkRange("rate_option_multiplier_range")).toEqual([
      MULTIPLIER_MIN_BPS,
      MULTIPLIER_MAX_BPS,
    ]);
  });

  it("cover every currency, with the CHECK literals of 0000_init", () => {
    const [baseMin, baseMax] = checkRange("rate_card_base_price_range");
    const [, totalMax] = checkRange("license_request_total");
    for (const currency of CURRENCIES) {
      expect(BASE_PRICE_MIN_CENTS[currency]).toBe(baseMin);
      expect(BASE_PRICE_MAX_CENTS[currency]).toBe(baseMax);
      expect(MAX_TOTAL_CENTS[currency]).toBe(totalMax);
      expect(DEFAULT_BASE_PRICE_CENTS[currency]).toBeGreaterThanOrEqual(
        baseMin,
      );
      expect(DEFAULT_BASE_PRICE_CENTS[currency] % 100).toBe(0);
    }
    expect(checkRange("video_price_override_range")).toEqual([
      baseMin,
      baseMax,
    ]);
  });
});
