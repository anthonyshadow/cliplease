import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCompact,
  formatCountdown,
  formatDeadline,
  formatDelta,
  formatDuration,
  formatLicenseDate,
  formatMoney,
  formatPostDate,
  formatRelative,
} from "./format";
import { CURRENCY_DISPLAY, currencyLabel } from "./money/currency";
import { DAY_MS as DAY, HOUR_MS as HOUR, MINUTE_MS as MIN } from "./time";

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const PRINTABLE_ASCII = /^[\x20-\x7E]*$/;

// Machine zones that differ from every zone in the goldens: a formatter that reads the machine's zone fails here (01 G.7).
describe.each(["Pacific/Auckland", "America/Los_Angeles"])(
  "under TZ=%s",
  (machineZone) => {
    const saved = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = machineZone;
    });
    afterAll(() => {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    });

    it("runs in the simulated machine zone", () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(
        machineZone,
      );
    });

    describe("formatMoney (04 §4.4, 07 D98 goldens)", () => {
      it.each([
        [173250, "cad", undefined, "CA$1,732.50"],
        [200, "cad", undefined, "CA$2.00"],
        [15000, "cad", { wholeDollars: true }, "CA$150"],
        [173250, "usd", undefined, "US$1,732.50"],
        [15000, "cad", undefined, "CA$150.00"],
        [99_999_999, "cad", undefined, "CA$999,999.99"],
        // A non-whole amount keeps its cents even with wholeDollars.
        [15050, "cad", { wholeDollars: true }, "CA$150.50"],
      ] as const)("formatMoney(%i, %s, %o) = %s", (cents, cur, opts, want) => {
        expect(formatMoney(cents, cur, opts)).toBe(want);
      });

      it("refuses non-integer minor units", () => {
        expect(() => formatMoney(1.5, "cad")).toThrow(RangeError);
      });
    });

    describe("formatDelta (04 §4.4, 07 D98 goldens)", () => {
      it.each([
        [105000, "+ CA$1,050"],
        [-52500, "− CA$525"],
        [39375, "+ CA$393.75"],
        [-105000, "− CA$1,050"],
      ])("formatDelta(%i, 'cad') = %s", (cents, want) => {
        expect(formatDelta(cents, "cad")).toBe(want);
      });

      it("uses U+2212, never a hyphen-minus", () => {
        expect(formatDelta(-52500, "cad").codePointAt(0)).toBe(0x2212);
        expect(formatDelta(-52500, "cad")).not.toContain("-");
      });
    });

    it("formatCompact: 14.8M views · 888K likes", () => {
      expect(formatCompact(14_800_000, "views")).toBe("14.8M views");
      expect(formatCompact(888_000, "likes")).toBe("888K likes");
    });

    it.each([
      [14, "0:14"],
      [724, "12:04"],
      [3723, "1:02:03"],
    ])("formatDuration(%i) = %s", (sec, want) => {
      expect(formatDuration(sec)).toBe(want);
    });

    it("formatPostDate is the UTC day: 1 Oct 2026", () => {
      expect(formatPostDate(new Date("2026-10-01T12:00:00Z"))).toBe(
        "1 Oct 2026",
      );
      expect(formatPostDate(new Date("2026-10-01T23:30:00Z"))).toBe(
        "1 Oct 2026",
      );
    });

    it("formatLicenseDate is UTC: 19 Nov 2026, 14:32 UTC", () => {
      expect(formatLicenseDate(new Date("2026-11-19T14:32:00Z"))).toBe(
        "19 Nov 2026, 14:32 UTC",
      );
      expect(formatLicenseDate(new Date("2027-11-20T07:34:00Z"))).toBe(
        "20 Nov 2027, 07:34 UTC",
      );
      expect(formatLicenseDate(new Date("2027-11-20T00:05:00Z"))).toBe(
        "20 Nov 2027, 00:05 UTC",
      );
    });

    it("formatDeadline uses the zone it is given: Sun 18 Oct, 3:10 PM EDT", () => {
      const at = new Date("2026-10-18T19:10:00Z");
      expect(formatDeadline(at, "America/New_York")).toBe(
        "Sun 18 Oct, 3:10 PM EDT",
      );
      expect(formatDeadline(at, "America/Toronto")).toBe(
        "Sun 18 Oct, 3:10 PM EDT",
      );
      expect(formatDeadline(at, "Asia/Kolkata")).toBe(
        "Mon 19 Oct, 12:40 AM GMT+5:30",
      );
      expect(formatDeadline(at, "UTC")).toBe("Sun 18 Oct, 7:10 PM UTC");
      expect(formatDeadline(at, "Bogus/Zone")).toBe("Sun 18 Oct, 7:10 PM UTC");
    });

    it.each([
      [2 * DAY + 23 * HOUR + 59 * MIN, "Expires in 2 d 23 h"],
      [5 * HOUR + 12 * MIN, "Expires in 5 h 12 min"],
      [42 * MIN, "Expires in 42 min"],
      [3 * DAY - 20_000, "Expires in 2 d 23 h"],
      [2 * DAY, "Expires in 2 d 0 h"],
      [5 * HOUR, "Expires in 5 h 0 min"],
      [42 * MIN + 30_000, "Expires in 42 min"],
      [30_000, "Expires in 0 min"],
      [0, "Expires in 0 min"],
      [-5 * MIN, "Expires in 0 min"],
    ])("formatCountdown(%i) = %s", (ms, want) => {
      expect(formatCountdown(ms)).toBe(want);
    });

    it.each([
      [20_000, "Synced just now"],
      [59_000, "Synced just now"],
      [-MIN, "Synced just now"],
      [MIN, "Synced 1 min ago"],
      [3 * MIN, "Synced 3 min ago"],
      [59 * MIN, "Synced 59 min ago"],
      [HOUR, "Synced 1 h ago"],
      [23 * HOUR + 59 * MIN, "Synced 23 h ago"],
      [DAY, "Synced 1 day ago"],
      [47 * HOUR, "Synced 1 day ago"],
      [2 * DAY, "Synced 2 days ago"],
      [3 * DAY, "Synced 3 days ago"],
      [41 * DAY, "Synced 41 days ago"],
    ])("formatRelative(now − %i ms, now) = %s", (ms, want) => {
      const now = new Date("2026-10-17T18:32:00Z");
      expect(formatRelative(new Date(now.getTime() - ms), now)).toBe(want);
    });

    it.each([
      [84 * MIB, undefined, "84 MB"],
      [312 * MIB, 840 * MIB, "312 of 840 MB"],
      [1.2 * GIB, 2 * GIB, "1.2 of 2 GB"],
      [2.4 * GIB, undefined, "2.4 GB"],
      [2 * GIB, undefined, "2 GB"],
      [1.1 * MIB, undefined, "1.1 MB"],
    ])("formatBytes(%i, %s) = %s", (n, total, want) => {
      expect(formatBytes(n, total)).toBe(want);
    });
  },
);

describe("currency.ts (07 D98)", () => {
  it("currencyLabel", () => {
    expect(currencyLabel("cad")).toBe("Canadian dollars (CAD)");
    expect(currencyLabel("usd")).toBe("US dollars (USD)");
  });

  it("CURRENCY_DISPLAY prefixes are never a bare $", () => {
    expect(CURRENCY_DISPLAY.cad.prefix).toBe("CA$");
    expect(CURRENCY_DISPLAY.usd.prefix).toBe("US$");
  });
});

describe("ASCII output (no NBSP, no U+202F)", () => {
  it("every formatter but formatDelta's minus prints printable ASCII", () => {
    const at = new Date("2026-10-18T19:10:00Z");
    const outputs = [
      formatMoney(173250, "cad"),
      formatMoney(173250, "usd"),
      formatMoney(15000, "cad", { wholeDollars: true }),
      formatDelta(105000, "cad"),
      formatCompact(14_800_000, "views"),
      formatDuration(3723),
      formatPostDate(at),
      formatLicenseDate(at),
      ...["America/New_York", "Europe/London", "Asia/Kolkata", "UTC"].map(
        (tz) => formatDeadline(at, tz),
      ),
      formatCountdown(5 * HOUR + 12 * MIN),
      formatRelative(at, at),
      formatBytes(1.2 * GIB, 2 * GIB),
    ];
    for (const s of outputs) expect(s).toMatch(PRINTABLE_ASCII);
    expect(formatDelta(-52500, "cad").slice(1)).toMatch(PRINTABLE_ASCII);
  });
});
