import { describe, expect, it } from "vitest";
import { durationMismatch, durationMismatchMessage } from "./duration";

describe("durationMismatch (01 J5.10)", () => {
  it("is false within 1 s either way", () => {
    expect(durationMismatch(14_000, 14)).toBe(false);
    expect(durationMismatch(14_033, 14)).toBe(false);
    expect(durationMismatch(15_000, 14)).toBe(false);
    expect(durationMismatch(13_000, 14)).toBe(false);
  });

  it("is true past 1 s either way", () => {
    expect(durationMismatch(15_001, 14)).toBe(true);
    expect(durationMismatch(12_999, 14)).toBe(true);
    expect(durationMismatch(14_000, 38)).toBe(true);
    expect(durationMismatch(38_000, 14)).toBe(true);
  });

  it("is false when either length is unknown", () => {
    for (const unknown of [null, undefined, 0, -1, Number.NaN, Infinity]) {
      expect(durationMismatch(unknown, 38)).toBe(false);
      expect(durationMismatch(14_000, unknown)).toBe(false);
    }
  });
});

describe("durationMismatchMessage (01 J5.10, 04 §11.10)", () => {
  it("names both lengths as m:ss", () => {
    expect(durationMismatchMessage(14_000, 38)).toBe(
      "This file is 0:14 but the post is 0:38. Make sure it's the same video.",
    );
    expect(durationMismatchMessage(14_967, 3_725)).toBe(
      "This file is 0:14 but the post is 1:02:05. Make sure it's the same video.",
    );
  });

  it("is null when the lengths match or one is unknown", () => {
    expect(durationMismatchMessage(14_033, 14)).toBeNull();
    expect(durationMismatchMessage(null, 38)).toBeNull();
    expect(durationMismatchMessage(14_000, null)).toBeNull();
    expect(durationMismatchMessage(14_033, 14, "Demo post")).toBeNull();
    expect(durationMismatchMessage(null, 38, "Demo post")).toBeNull();
  });

  it("names the post as given, whole (several verified posts; owner answers Q-76, Q-85 a)", () => {
    expect(durationMismatchMessage(14_000, 38, "Demo post")).toBe(
      "This file is 0:14 but the Demo post is 0:38. Make sure it's the same video.",
    );
    expect(
      durationMismatchMessage(14_000, 38, "TikTok post on @maya.films"),
    ).toBe(
      "This file is 0:14 but the TikTok post on @maya.films is 0:38. Make sure it's the same video.",
    );
    expect(durationMismatchMessage(14_000, 38, undefined)).toBe(
      "This file is 0:14 but the post is 0:38. Make sure it's the same video.",
    );
  });
});
