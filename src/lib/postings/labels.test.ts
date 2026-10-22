import { describe, expect, it } from "vitest";
import { POSTING_PLATFORMS, type PostingPlatform } from "../domain/values";
import { postingPlatformLabel } from "./labels";

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
