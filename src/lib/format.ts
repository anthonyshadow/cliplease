// The one formatting module (04 §4.4, 07 D06, D98). Client-safe and pure.
// Dates are built from en-US formatToParts values with our own literals, so Node and every browser engine
// print the same ASCII string (WebKit's format() inserts " at "; some ICU builds use U+202F before AM/PM).
// Every date formatter names its zone; none reads the machine's zone (01 G.7).
import type { Currency } from "./domain/values";
import { CURRENCY_DISPLAY } from "./money/currency";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "./time";

const MINUS = "−";
const UTC = "UTC";

const cents2 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const oneDecimal = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

function assertMinorUnits(cents: number): void {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`Money must be integer minor units, got ${cents}`);
  }
}

function amountDigits(absCents: number, dropWholeCents: boolean): string {
  if (dropWholeCents && absCents % 100 === 0) {
    return whole.format(absCents / 100);
  }
  return cents2.format(absCents / 100);
}

/** "CA$1,732.50"; `{ wholeDollars: true }` drops ".00" only when the amount is whole ("CA$150"). */
export function formatMoney(
  cents: number,
  currency: Currency,
  opts?: { wholeDollars?: boolean },
): string {
  assertMinorUnits(cents);
  const sign = cents < 0 ? MINUS : "";
  const digits = amountDigits(Math.abs(cents), opts?.wholeDollars === true);
  return `${sign}${CURRENCY_DISPLAY[currency].prefix}${digits}`;
}

/** "+ CA$1,050" · "− CA$525" · "+ CA$393.75": real minus, a space after the sign, ".00" dropped only when whole. */
export function formatDelta(cents: number, currency: Currency): string {
  assertMinorUnits(cents);
  const sign = cents < 0 ? MINUS : "+";
  const digits = amountDigits(Math.abs(cents), true);
  return `${sign} ${CURRENCY_DISPLAY[currency].prefix}${digits}`;
}

/** "14.8M views" · "888K likes"; `noun` is the platform's own metric noun. */
export function formatCompact(n: number, noun: string): string {
  return `${compact.format(n)} ${noun}`;
}

/** m:ss, h:mm:ss from one hour: "0:14" · "12:04" · "1:02:03". Fractions of a second are dropped. */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

type DateParts = Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

function partsOf(format: Intl.DateTimeFormat, d: Date): DateParts {
  const out: DateParts = {};
  for (const p of format.formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = p.value;
  }
  return out;
}

// Built once: a DateTimeFormat costs about ten times more to build than to use.
const utcDayFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: UTC,
  day: "numeric",
  month: "short",
  year: "numeric",
});
const utcTimeFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: UTC,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const DEADLINE_OPTIONS: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
  timeZoneName: "short",
};
const deadlineFormats = new Map<string, Intl.DateTimeFormat>();

/** The deadline format for `tz`, cached per zone; an unknown zone falls back to UTC (and isn't cached). */
function deadlineFormat(tz: string): Intl.DateTimeFormat {
  const cached = deadlineFormats.get(tz);
  if (cached) return cached;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      ...DEADLINE_OPTIONS,
      timeZone: tz,
    });
  } catch {
    return deadlineFormat(UTC);
  }
  deadlineFormats.set(tz, format);
  return format;
}

function utcDay(d: Date): string {
  const p = partsOf(utcDayFormat, d);
  return `${p.day} ${p.month} ${p.year}`;
}

/** Post dates, UTC: "1 Oct 2026" (01 J3). */
export function formatPostDate(d: Date): string {
  return utcDay(d);
}

/** License start/end, always UTC: "19 Nov 2026, 14:32 UTC" (01 G.7). */
export function formatLicenseDate(d: Date): string {
  const t = partsOf(utcTimeFormat, d);
  return `${utcDay(d)}, ${t.hour}:${t.minute} UTC`;
}

/** Pages only, in the viewer's zone with its en-US short label: "Sun 18 Oct, 3:10 PM EDT" (01 G.7, 07 D84). */
export function formatDeadline(d: Date, tz: string): string {
  const p = partsOf(deadlineFormat(tz), d);
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} ${p.dayPeriod} ${p.timeZoneName}`;
}

const HOUR_MIN = HOUR_MS / MINUTE_MS;
const DAY_MIN = DAY_MS / MINUTE_MS;

/** "Expires in 2 d 23 h" · "Expires in 5 h 12 min" · "Expires in 42 min"; whole minutes rounded down; 0 and below read "Expires in 0 min". */
export function formatCountdown(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / MINUTE_MS));
  const d = Math.floor(totalMin / DAY_MIN);
  const h = Math.floor((totalMin % DAY_MIN) / HOUR_MIN);
  const m = totalMin % HOUR_MIN;
  if (d > 0) return `Expires in ${d} d ${h} h`;
  if (h > 0) return `Expires in ${h} h ${m} min`;
  return `Expires in ${m} min`;
}

/** Sync status: "Synced just now" · "Synced 3 min ago" · "Synced 3 days ago". `now` is passed in (no Date.now() here). */
export function formatRelative(d: Date, now: Date): string {
  const min = Math.floor((now.getTime() - d.getTime()) / MINUTE_MS);
  if (min < 1) return "Synced just now";
  if (min < HOUR_MIN) return `Synced ${min} min ago`;
  if (min < DAY_MIN) return `Synced ${Math.floor(min / HOUR_MIN)} h ago`;
  const days = Math.floor(min / DAY_MIN);
  return `Synced ${days} ${days === 1 ? "day" : "days"} ago`;
}

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

function sizeIn(bytes: number, unit: number, oneDecimalBelow: number): string {
  const v = bytes / unit;
  return v < oneDecimalBelow ? oneDecimal.format(v) : whole.format(v);
}

/**
 * Binary units shown as MB / GB (07 D80: 2 GiB reads "2 GB"). "84 MB" · "2.4 GB"; with `total`: "312 of 840 MB" · "1.2 of 2 GB".
 * The unit comes from the larger value; GB keeps one decimal, MB one decimal under 10 MB.
 */
export function formatBytes(n: number, total?: number): string {
  const ref = Math.max(n, total ?? 0);
  const [unit, label, decimalsBelow] =
    ref >= GIB ? [GIB, "GB", Number.POSITIVE_INFINITY] : [MIB, "MB", 10];
  const value = sizeIn(n, unit, decimalsBelow);
  if (total === undefined) return `${value} ${label}`;
  return `${value} of ${sizeIn(total, unit, decimalsBelow)} ${label}`;
}

/** "A" · "A and B" · "A, B and C" (or "or"): the app's lists, with no serial comma. */
export function joinList(
  items: readonly string[],
  conjunction: "and" | "or",
): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}
