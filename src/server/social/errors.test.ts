import { describe, expect, it } from "vitest";
import { MAX_RETRY_AFTER_SEC, SocialRateLimitError } from "./errors";

describe("SocialRateLimitError", () => {
  it.each([
    [900, 900],
    [1.2, 2],
    [-5, 0],
    [Number.NaN, 60],
    [Number.POSITIVE_INFINITY, 60],
    [99_999_999, MAX_RETRY_AFTER_SEC],
  ])("turns a wait of %d s into %d s", (given, want) => {
    expect(new SocialRateLimitError(given).retryAfterSec).toBe(want);
  });

  it("caps a wait at one day", () => {
    expect(MAX_RETRY_AFTER_SEC).toBe(86_400);
  });
});
