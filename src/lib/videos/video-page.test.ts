import { describe, expect, it } from "vitest";
import { VIDEO_STATUSES } from "@/lib/domain/values";
import { formatBytes } from "@/lib/format";
import {
  fromPriceLine,
  offersShareLink,
  originalLine,
  removedPostLine,
  requestsLine,
  rightsSummary,
  videoMenuAction,
} from "./video-page";

describe("the video page's lines (05 §6.7; owner answers Q-101, Q-102)", () => {
  it("counts requests and licenses, with one license singular", () => {
    expect(requestsLine(0, 0)).toBe("0 waiting · 0 licenses");
    expect(requestsLine(1, 1)).toBe("1 waiting · 1 license");
    expect(requestsLine(2, 2)).toBe("2 waiting · 2 licenses");
  });

  it("names the original with its duration, size in pixels and bytes, leaving out what isn't known", () => {
    const original = {
      originalFilename: "first-snow.mp4",
      durationMs: 14_000,
      width: 720,
      height: 1280,
      originalBytes: 166_229,
    };
    expect(originalLine(original)).toBe(
      `first-snow.mp4 · 0:14 · 720 × 1280 · ${formatBytes(166_229)}`,
    );
    expect(originalLine({ ...original, durationMs: null, width: null })).toBe(
      `first-snow.mp4 · ${formatBytes(166_229)}`,
    );
  });

  it("sums up the rights answers once both are given", () => {
    expect(rightsSummary(false, false)).toBe("Music: No · People: No");
    expect(rightsSummary(true, false)).toBe("Music: Yes · People: No");
    expect(rightsSummary(null, false)).toBeNull();
  });

  it("says where a From price comes from only when it is the rate card's", () => {
    expect(fromPriceLine(15_000, "cad", "rate_card")).toBe(
      "From CA$150.00 (your rate card)",
    );
    expect(fromPriceLine(20_000, "cad", "video")).toBe("From CA$200.00");
  });

  it("says the video stays live only while it is live", () => {
    const removedAt = new Date("2026-10-14T12:00:00Z");
    expect(removedPostLine("instagram", removedAt, "published")).toBe(
      "This post was removed from Instagram on 14 Oct 2026. Your video stays live.",
    );
    expect(removedPostLine("mock", removedAt, "unpublished")).toBe(
      "This post was removed from Demo on 14 Oct 2026.",
    );
  });
});

describe("videoMenuAction (05 §6.8 callout 4)", () => {
  it("gives Turn off while live, Turn on while off, Delete draft for a draft, nothing for a disabled video", () => {
    expect(
      Object.fromEntries(VIDEO_STATUSES.map((s) => [s, videoMenuAction(s)])),
    ).toEqual({
      draft: "delete_draft",
      published: "turn_off",
      unpublished: "turn_on",
      disabled: null,
    });
  });
});

describe("offersShareLink (05 §6.7, §6.8)", () => {
  it("offers the link while Live or Off only", () => {
    expect(VIDEO_STATUSES.filter(offersShareLink)).toEqual([
      "published",
      "unpublished",
    ]);
  });
});
