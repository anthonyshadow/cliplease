import { describe, expect, it } from "vitest";
import { formatDuration } from "../format";
import { CHECKOUT_COPY } from "./checkout-copy";
import {
  CHECKOUT_HOLD_EXTEND_WINDOW_SECONDS,
  CHECKOUT_HOLD_MINUTES,
  checkoutHoldPhase,
} from "./checkout-hold";

const NOW = new Date("2026-11-20T15:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const OPEN_SESSION = at(30 * 60_000);

describe("checkoutHoldPhase (owner answers Q-170, Q-176)", () => {
  it.each([
    [-1000, "lapsed", 0],
    [0, "lapsed", 0],
    [400, "ending", 1],
    [59_001, "ending", 60],
    [60_000, "ending", 60],
    [60_001, "held", 61],
    [600_000, "held", 600],
  ] as const)(
    "the hold %i ms from now is %s with %i s left",
    (offsetMs, phase, secondsLeft) => {
      expect(
        checkoutHoldPhase(
          { holdUntil: at(offsetMs), sessionEndsAt: OPEN_SESSION },
          NOW,
        ),
      ).toMatchObject({ phase, secondsLeft });
    },
  );

  it("ended once now reaches the session's end, with no extend and no negative seconds", () => {
    expect(
      checkoutHoldPhase({ holdUntil: at(-5000), sessionEndsAt: NOW }, NOW),
    ).toEqual({ phase: "ended", secondsLeft: 0, canExtend: false });
    expect(
      checkoutHoldPhase({ holdUntil: at(-5000), sessionEndsAt: at(-1) }, NOW),
    ).toEqual({ phase: "ended", secondsLeft: 0, canExtend: false });
  });

  it("can't extend a hold that has reached the session's end", () => {
    const end = at(30_000);
    expect(
      checkoutHoldPhase({ holdUntil: end, sessionEndsAt: end }, NOW),
    ).toEqual({ phase: "ending", secondsLeft: 30, canExtend: false });
  });

  it("can extend in the last minute and after zero while the session is open", () => {
    expect(
      checkoutHoldPhase(
        { holdUntil: at(30_000), sessionEndsAt: OPEN_SESSION },
        NOW,
      ),
    ).toEqual({ phase: "ending", secondsLeft: 30, canExtend: true });
    expect(
      checkoutHoldPhase(
        { holdUntil: at(-1000), sessionEndsAt: OPEN_SESSION },
        NOW,
      ),
    ).toEqual({ phase: "lapsed", secondsLeft: 0, canExtend: true });
  });

  it("can't extend while the hold is well before its last minute", () => {
    expect(
      checkoutHoldPhase(
        { holdUntil: at(600_000), sessionEndsAt: OPEN_SESSION },
        NOW,
      ).canExtend,
    ).toBe(false);
  });
});

describe("the hold's constants and words", () => {
  it("holds for 10 minutes and offers Extend in the last 60 seconds", () => {
    expect(CHECKOUT_HOLD_MINUTES).toBe(10);
    expect(CHECKOUT_HOLD_EXTEND_WINDOW_SECONDS).toBe(60);
  });

  it("prints the clock as the owner approved it (Q-176)", () => {
    expect(CHECKOUT_COPY.holdClock(formatDuration(572))).toBe(
      "Reserved for you · 9:32",
    );
  });
});
