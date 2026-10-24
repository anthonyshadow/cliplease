import { describe, expect, it } from "vitest";
import { RIGHTS_COPY, rightsLockOf } from "./rights";

describe("the Rights step's words and lock (05 §6.5 callout 38; owner answer Q-96 a)", () => {
  it("names the uses music turns off in 05's words", () => {
    expect(RIGHTS_COPY.musicFootnote).toBe(
      "Paid social ads and TV / broadcast will be off for this video.",
    );
  });

  it("locks the answers for a license sold over a request waiting, and not otherwise", () => {
    expect(rightsLockOf({ licensed: true, openRequest: true })).toBe("license");
    expect(rightsLockOf({ licensed: false, openRequest: true })).toBe(
      "request",
    );
    expect(rightsLockOf({ licensed: false, openRequest: false })).toBeNull();
  });
});
