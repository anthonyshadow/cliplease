import { describe, expect, it } from "vitest";
import { POSTING_PLATFORMS, type PostingPlatform } from "../domain/values";
import { postingHostLabel, postingPlatformLabel } from "./labels";

/** 07 D67, 04 §9.16: one name per platform; Other without a label of its own reads "Other". */
const LABELS = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  x: "X",
  snapchat: "Snapchat",
  other: "Other",
  mock: "Demo",
} satisfies Record<PostingPlatform, string>;

describe("postingPlatformLabel (07 D67)", () => {
  it.each(
    POSTING_PLATFORMS.map((platform) => [platform, LABELS[platform]] as const),
  )("names %s %j", (platform, label) => {
    expect(postingPlatformLabel(platform, null)).toBe(label);
  });

  it("names Other by the creator's label, trimmed", () => {
    expect(postingPlatformLabel("other", "Vimeo")).toBe("Vimeo");
    expect(postingPlatformLabel("other", "  My blog \n")).toBe("My blog");
    expect(postingPlatformLabel("other", "   ")).toBe("Other");
  });

  it("ignores a label on every other platform", () => {
    expect(postingPlatformLabel("instagram", "Vimeo")).toBe("Instagram");
    expect(postingPlatformLabel("mock", "Vimeo")).toBe("Demo");
  });
});

describe("postingHostLabel", () => {
  it("names an Other site by its hostname, without www.", () => {
    expect(postingHostLabel("other", "https://www.vimeo.com/123?t=4")).toBe(
      "vimeo.com",
    );
    expect(postingHostLabel("other", "https://blog.example.org/a")).toBe(
      "blog.example.org",
    );
  });

  it("is null for another platform, no link or a url that doesn't parse", () => {
    expect(
      postingHostLabel("youtube", "https://www.youtube.com/watch?v=x"),
    ).toBe(null);
    expect(postingHostLabel("other", null)).toBe(null);
    expect(postingHostLabel("other", "not a url")).toBe(null);
  });
});
