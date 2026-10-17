import { describe, expect, it } from "vitest";
import { countdownState } from "./countdown";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.parse("2026-10-17T18:32:00Z");

describe("countdownState (04 §9.10)", () => {
  it("is neutral above 6 h and ticks every minute", () => {
    expect(countdownState(now + 3 * DAY - 20_000, now)).toEqual({
      label: "Expires in 2 d 23 h",
      tone: "neutral",
      nextTickMs: MIN,
    });
    expect(countdownState(now + 6 * HOUR + 1, now).tone).toBe("neutral");
  });

  it("is awaiting at 6 h or less", () => {
    expect(countdownState(now + 6 * HOUR, now).tone).toBe("awaiting");
    expect(countdownState(now + 5 * HOUR + 12 * MIN, now)).toEqual({
      label: "Expires in 5 h 12 min",
      tone: "awaiting",
      nextTickMs: MIN,
    });
  });

  it("ticks every 10 s under 1 h", () => {
    expect(countdownState(now + 42 * MIN, now)).toEqual({
      label: "Expires in 42 min",
      tone: "awaiting",
      nextTickMs: 10_000,
    });
  });

  it("stops at zero and never goes negative", () => {
    const zero = {
      label: "Expires in 0 min",
      tone: "awaiting",
      nextTickMs: null,
    };
    expect(countdownState(now, now)).toEqual(zero);
    expect(countdownState(now - 5 * MIN, now)).toEqual(zero);
  });
});
