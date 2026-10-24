// What the creator types into the rate card, read with string math: never parseFloat × 10000, where "1.15" would give
// 11499 (P12). Bounds and steps are checked by the Zod schemas in src/lib/validation/pricing.ts, not here.

const BPS_PER_UNIT = 10_000;
const BPS_PER_HUNDREDTH = 100;

// An optional "×" (with or without a space), up to 9 whole digits, then up to 2 decimals after "." or "," (the decimal
// keypad of a French (Canada) phone has only ","; a multiplier, at most ×10.00, never needs a thousands separator).
const MULTIPLIER = /^(?:×\s*)?(\d{1,9})(?:[.,](\d{1,2}))?$/;
// Whole dollars, plain or with thousands commas, with an optional ".0" or ".00".
const WHOLE_DOLLARS = /^(\d{1,9}|\d{1,3}(?:,\d{3}){1,2})(?:\.0{1,2})?$/;

/** "3" / "3.00" / "×1.5" / "1,50" → 30000 / 30000 / 15000 / 15000; more than 2 decimals, or no number, → null. */
export function parseMultiplierBps(text: string): number | null {
  const match = MULTIPLIER.exec(text.trim());
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  return (
    Number(whole) * BPS_PER_UNIT +
    Number(fraction.padEnd(2, "0")) * BPS_PER_HUNDREDTH
  );
}

/** The multiplier field's value: 15000 → "1.50" (the "×" is the field's adornment). */
export function multiplierFieldValue(bps: number): string {
  return (bps / BPS_PER_UNIT).toFixed(2);
}

/** 15000 → "× 1.50": a multiplier in read-only text. */
export function formatMultiplier(bps: number): string {
  return `× ${multiplierFieldValue(bps)}`;
}

/** "150" / "1,500" / "150.00" → 15000 / 150000 / 15000 cents; a part of a dollar ("150.50"), or no number, → null. */
export function parseWholeDollars(text: string): number | null {
  const match = WHOLE_DOLLARS.exec(text.trim());
  if (!match) return null;
  return Number(match[1].replaceAll(",", "")) * 100;
}

/** The base price field's value: 15000 → "150". */
export function wholeDollarsFieldValue(cents: number): string {
  return String(Math.floor(cents / 100));
}
