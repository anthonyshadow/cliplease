import { describe, expect, it } from "vitest";
import { normalizeTimeZone } from "./time-zone";

describe("normalizeTimeZone (07 D84)", () => {
  it.each(["America/Toronto", "Asia/Kolkata", "UTC", "Etc/GMT+5"])(
    "keeps %s as given",
    (zone) => {
      expect(normalizeTimeZone(zone)).toBe(zone);
    },
  );

  it("trims", () => {
    expect(normalizeTimeZone("  America/Toronto ")).toBe("America/Toronto");
  });

  it.each([
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["an unknown zone", "Bogus/Zone"],
    ["a 65-character string", `A/${"b".repeat(63)}`],
    ["a path", "../etc"],
    ["a space inside", "America/New York"],
  ])("falls back to UTC for %s", (_case, input) => {
    expect(normalizeTimeZone(input)).toBe("UTC");
  });
});
