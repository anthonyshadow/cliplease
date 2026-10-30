import type { TermKey } from "@/lib/domain/values";
import { DAY_MS } from "@/lib/time";

// When a license ends (02 §5.7; 03 §3.7.2; 07 D33): UTC only, so the server's zone never moves a date. Pure.

/** Calendar months each month-based term adds. */
const TERM_MONTHS = { m6: 6, y1: 12 } as const;

/**
 * The license's end for `term` starting at `startsAt`: 30 days to the millisecond for d30; 6 or 12 calendar months for
 * m6 and y1, clamped to the target month's last day and keeping the UTC time of day; null for perpetual.
 */
export function computeEndsAt(startsAt: Date, term: TermKey): Date | null {
  switch (term) {
    case "perpetual":
      return null;
    case "d30":
      return new Date(startsAt.getTime() + 30 * DAY_MS);
    case "m6":
    case "y1":
      return addUtcMonths(startsAt, TERM_MONTHS[term]);
  }
}

function addUtcMonths(at: Date, months: number): Date {
  const total = at.getUTCMonth() + months;
  const year = at.getUTCFullYear() + Math.floor(total / 12);
  const month = total % 12;
  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(at.getUTCDate(), lastDay),
      at.getUTCHours(),
      at.getUTCMinutes(),
      at.getUTCSeconds(),
      at.getUTCMilliseconds(),
    ),
  );
}
