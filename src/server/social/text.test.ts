import { describe, expect, it } from "vitest";
import { hasNul, urlWithoutNul, withoutNul } from "./text";

describe("platform text and NUL bytes (03 DB1)", () => {
  it("drops every NUL from text and keeps null", () => {
    expect(withoutNul("a\u0000b\u0000")).toBe("ab");
    expect(withoutNul("plain")).toBe("plain");
    expect(withoutNul(null)).toBeNull();
  });

  it("tells a value with a NUL apart", () => {
    expect(hasNul("x\u0000")).toBe(true);
    expect(hasNul("x")).toBe(false);
    expect(hasNul(null)).toBe(false);
  });

  it("drops a URL that holds a NUL rather than mending it", () => {
    expect(urlWithoutNul("mock://avatar/\u000001")).toBeNull();
    expect(urlWithoutNul("mock://avatar/01")).toBe("mock://avatar/01");
    expect(urlWithoutNul(null)).toBeNull();
  });
});
