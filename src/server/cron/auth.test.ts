import { beforeEach, describe, expect, it, vi } from "vitest";
import { isCronAuthorized } from "./auth";

// The cron bearer (02 §5.11, §9.7). isCronAuthorized reads CRON_SECRET on every call, so each case sets its own.
const mocked = vi.hoisted(() => ({
  env: { CRON_SECRET: undefined as string | undefined },
}));
vi.mock("@/server/env", () => mocked);

const SECRET = "unit-test-cron-secret-0123456789abcdef";
const HEADER = `Bearer ${SECRET}`;

describe("isCronAuthorized (02 §5.11, §9.7)", () => {
  beforeEach(() => {
    mocked.env.CRON_SECRET = SECRET;
  });

  it("accepts exactly `Bearer <CRON_SECRET>`", () => {
    expect(isCronAuthorized(HEADER)).toBe(true);
  });

  it.each<[string, string | null]>([
    ["no header", null],
    ["an empty header", ""],
    ["another scheme", `Basic ${SECRET}`],
    ["a lowercase scheme", `bearer ${SECRET}`],
    ["two spaces after the scheme", `Bearer  ${SECRET}`],
    ["a wrong secret of the same length", `Bearer ${SECRET.slice(0, -1)}x`],
    ["a longer header", `${HEADER}x`],
    ["a shorter header", HEADER.slice(0, -1)],
    // As many characters as the header, twice its bytes: a length mismatch, never timingSafeEqual's RangeError.
    ["multibyte characters of the same .length", "é".repeat(HEADER.length)],
  ])("refuses %s", (_case, authorization) => {
    expect(isCronAuthorized(authorization)).toBe(false);
  });

  it.each<[string, string | undefined]>([
    ["unset", undefined],
    ["empty", ""],
  ])("refuses every header while CRON_SECRET is %s", (_case, secret) => {
    mocked.env.CRON_SECRET = secret;
    for (const authorization of [
      null,
      "",
      "Bearer",
      "Bearer ",
      "Bearer undefined",
      HEADER,
    ]) {
      expect(isCronAuthorized(authorization)).toBe(false);
    }
  });
});
