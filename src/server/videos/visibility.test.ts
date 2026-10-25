import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isPubliclyAvailable, posterSrc } from "./visibility";

const ID = "00000000-0000-4000-8000-000000000002";

describe("isPubliclyAvailable (07 D03, D51, D72)", () => {
  it("is true only for a published video", () => {
    for (const status of ["draft", "unpublished", "disabled"] as const) {
      expect(
        isPubliclyAvailable({ status, postingPlatforms: [] }, ["mock"]),
      ).toBe(false);
    }
    expect(
      isPubliclyAvailable({ status: "published", postingPlatforms: [] }, []),
    ).toBe(true);
  });

  it("hides a video with any Demo posting while Demo isn't enabled, and nothing else hides it", () => {
    const withDemo = {
      status: "published" as const,
      postingPlatforms: ["instagram", "mock"] as const,
    };
    expect(isPubliclyAvailable(withDemo, ["instagram"])).toBe(false);
    expect(isPubliclyAvailable(withDemo, ["mock"])).toBe(true);
    expect(
      isPubliclyAvailable(
        {
          status: "published",
          postingPlatforms: ["facebook", "other", "tiktok"],
        },
        [],
      ),
    ).toBe(true);
  });
});

describe("posterSrc (07 D19)", () => {
  it("names the video and a hash of the key, never the key; none without a poster", () => {
    const key = `posters/${ID}/${ID}.jpg`;
    const v = createHash("sha256").update(key).digest("hex").slice(0, 8);
    expect(posterSrc({ id: ID, posterObjectKey: key })).toBe(
      `/api/media/posters/${ID}?v=${v}`,
    );
    expect(posterSrc({ id: ID, posterObjectKey: key })).not.toContain(key);
    expect(posterSrc({ id: ID, posterObjectKey: null })).toBeNull();
  });
});
