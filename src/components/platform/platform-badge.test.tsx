// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { POSTING_PLATFORMS, type PostingPlatform } from "@/lib/domain/values";
import { PlatformBadge } from "./platform-badge";

afterEach(cleanup);

function badge(platform: PostingPlatform, otherLabel?: string | null) {
  const { container } = render(
    <PlatformBadge platform={platform} otherLabel={otherLabel} />,
  );
  const root = container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error("no badge");
  return root;
}

const LABELS: Record<PostingPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  x: "X",
  snapchat: "Snapchat",
  other: "Other",
  mock: "Demo",
};

describe("PlatformBadge (04 §9.16; 07 D67, D70)", () => {
  it.each(POSTING_PLATFORMS)("names %s as postingPlatformLabel does", (p) => {
    expect(badge(p).textContent).toBe(LABELS[p]);
  });

  it.each(["instagram", "tiktok", "youtube", "mock"] as const)(
    "keeps %s the bare word: no icon, no mark (posting rows never show the glyph)",
    (p) => {
      const root = badge(p);
      expect(root.tagName).toBe("SPAN");
      expect(root.children).toHaveLength(0);
      expect(root.querySelector("svg, img")).toBeNull();
    },
  );

  it.each(["facebook", "x", "snapchat", "other"] as const)(
    "leads %s with the 16 px lucide Link, hidden from assistive tech",
    (p) => {
      const icon = badge(p).querySelector("svg");
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      expect(icon?.getAttribute("width")).toBe("16");
      expect(icon?.getAttribute("class")).toContain("lucide-link");
    },
  );

  it("names Other by the creator's trimmed label, and 'Other' without one", () => {
    expect(badge("other", "  Vimeo ").textContent).toBe("Vimeo");
    expect(badge("other", "").textContent).toBe("Other");
    expect(badge("other", null).textContent).toBe("Other");
    // Only Other reads the label.
    expect(badge("facebook", "Vimeo").textContent).toBe("Facebook");
  });

  it("lets a 40-character unbroken Other name shrink and wrap, never widening a 320 px card (07 D153)", () => {
    const name = "A".repeat(40);
    const root = badge("other", name);
    expect(root.className).toContain("min-w-0");
    expect(root.className).toContain("max-w-full");
    const text = root.lastElementChild;
    expect(text?.textContent).toBe(name);
    expect(text?.className).toContain("min-w-0");
    expect(text?.className).toContain("wrap-anywhere");
  });
});
