import { describe, expect, it } from "vitest";
import {
  APPROVAL_WINDOW_HOURS,
  type ApprovalWindowHours,
} from "@/lib/domain/values";
import { DAY_MS, HOUR_MS, MINUTE_MS } from "@/lib/time";
import {
  approvalWindowOf,
  computeExpiresAt,
  DEFAULT_APPROVAL_WINDOW_HOURS,
  HOLD_SAFETY_MARGIN_HOURS,
  HOLD_TOO_SHORT_MS,
} from "./expires-at";

const auth = new Date("2026-10-27T10:00:00Z");
const plus = (ms: number) => new Date(auth.getTime() + ms);

const expiresAt = (
  captureBefore: Date | null,
  approvalWindowHours: ApprovalWindowHours = 72,
) =>
  computeExpiresAt({ authorizedAt: auth, captureBefore, approvalWindowHours });

describe("computeExpiresAt (07 D81)", () => {
  it.each([
    { hold: "7 d", captureBefore: plus(7 * DAY_MS), want: 72 * HOUR_MS },
    { hold: "3 d", captureBefore: plus(3 * DAY_MS), want: 66 * HOUR_MS },
    { hold: "unknown", captureBefore: null, want: 72 * HOUR_MS },
    {
      hold: "6.5 h",
      captureBefore: plus(6.5 * HOUR_MS),
      want: 30 * MINUTE_MS,
    },
  ])("a $hold hold with the 72 h window", ({ captureBefore, want }) => {
    expect(expiresAt(captureBefore)).toEqual(plus(want));
  });

  it.each(APPROVAL_WINDOW_HOURS)(
    "a 7-day hold gives the whole %i h window",
    (window) => {
      expect(expiresAt(plus(7 * DAY_MS), window)).toEqual(
        plus(window * HOUR_MS),
      );
    },
  );

  it("caps the 120 h window by Stripe's 4 d 18 h default hold", () => {
    expect(expiresAt(null, 120)).toEqual(plus(108 * HOUR_MS));
  });

  it("caps the 120 h window 6 h before a 4 d 18 h hold, and keeps the 24 h window when the hold is unknown", () => {
    expect(expiresAt(plus(4 * DAY_MS + 18 * HOUR_MS), 120)).toEqual(
      plus(108 * HOUR_MS),
    );
    expect(expiresAt(null, 24)).toEqual(plus(24 * HOUR_MS));
  });

  it("is never later than 6 hours before the hold ends", () => {
    for (const window of APPROVAL_WINDOW_HOURS) {
      for (let h = 0; h <= 8 * 24; h += 7) {
        const captureBefore = plus(h * HOUR_MS);
        expect(expiresAt(captureBefore, window).getTime()).toBeLessThanOrEqual(
          captureBefore.getTime() - HOLD_SAFETY_MARGIN_HOURS * HOUR_MS,
        );
      }
    }
  });

  it("keeps the constants 07 §2.3 and §7.2 set", () => {
    expect(HOLD_SAFETY_MARGIN_HOURS).toBe(6);
    expect(HOLD_TOO_SHORT_MS).toBe(HOUR_MS);
    expect(APPROVAL_WINDOW_HOURS).toContain(DEFAULT_APPROVAL_WINDOW_HOURS);
  });
});

describe("approvalWindowOf", () => {
  it.each(APPROVAL_WINDOW_HOURS)("keeps %i", (h) => {
    expect(approvalWindowOf(h)).toBe(h);
  });

  it.each([0, 36, 168])("refuses %i", (h) => {
    expect(() => approvalWindowOf(h)).toThrow(`${h} h`);
  });
});
